"""Run inside cpp-compiler: python3 - < scripts/test-server.py."""
import http.client
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import server


class CacheTests(unittest.TestCase):
    def test_lru_and_byte_budget(self):
        cache = server.CompileCache(max_bytes=6, max_entries=2)
        cache.put('a', b'123'); cache.put('b', b'456')
        self.assertEqual(cache.get('a'), b'123')
        cache.put('c', b'789')
        self.assertIsNone(cache.get('b'))
        cache.put('a', b'12')
        self.assertEqual(cache.bytes, 5)
        cache.put('oversize', b'1234567')
        self.assertIsNone(cache.get('oversize'))

    def test_expiry_and_exact_source_version(self):
        cache = server.CompileCache(ttl=10)
        with patch.object(server.time, 'monotonic', return_value=100):
            cache.put('a', b'123')
        with patch.object(server.time, 'monotonic', return_value=110):
            self.assertIsNone(cache.get('a'))
        self.assertEqual(cache.bytes, 0)
        key = server.cache_key('int main() {}')
        self.assertNotEqual(key, server.cache_key('int main() {}\n'))
        with patch.object(server, 'VERSION', b'another SDK/instrumentation version'):
            self.assertNotEqual(key, server.cache_key('int main() {}'))


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.cache = patch.object(server, 'CACHE', server.CompileCache()); self.cache.start()
        self.logs = patch('sys.stdout', new=io.StringIO()); self.logs.start()
        self.api = server.BoundedHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.api.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.api.shutdown(); self.api.server_close(); self.thread.join()
        self.cache.stop(); self.logs.stop()

    def request(self, body, headers=None):
        connection = http.client.HTTPConnection(*self.api.server_address, timeout=8)
        connection.request('POST', '/compile', body, headers or {'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_hit_reuses_result_and_failures_are_not_cached(self):
        body = json.dumps({'source': 'int main(){return 0;}'}).encode()
        with patch.object(server, 'compile_source', return_value={'wasm': 'test', 'checkpoints': []}) as compiler:
            first = self.request(body); second = self.request(body)
            self.assertEqual(first[0], 200); self.assertEqual(first[1]['X-Compile-Cache'], 'MISS')
            self.assertEqual(second[1]['X-Compile-Cache'], 'HIT'); self.assertEqual(first[2], second[2])
            self.assertEqual(compiler.call_count, 1)
        with patch.object(server, 'compile_source', side_effect=ValueError('Invalid code')) as compiler:
            bad = json.dumps({'source': 'int main(){ missing; }'}).encode()
            self.assertEqual(self.request(bad)[0], 422); self.assertEqual(self.request(bad)[0], 422)
            self.assertEqual(compiler.call_count, 2)

    def test_request_validation_happens_before_compilation(self):
        with patch.object(server, 'compile_source') as compiler:
            self.assertEqual(self.request(b'{}', {'Content-Type': 'text/plain'})[0], 415)
            self.assertEqual(self.request(b'{}')[0], 400)
            self.assertEqual(self.request(b'{bad')[0], 422)
            self.assertEqual(self.request(b'x'*24001)[0], 413)
            self.assertEqual(self.request(json.dumps({'source': '#include <fstream>\nint main() {}'}).encode())[0], 422)
            compiler.assert_not_called()

    def test_busy_and_timeout_release_slot(self):
        body = json.dumps({'source': 'int main() {}'}).encode()
        server.SLOTS.acquire()
        try:
            self.assertEqual(self.request(body)[0], 429)
        finally:
            server.SLOTS.release()
        with patch.object(server, 'compile_source', side_effect=subprocess.TimeoutExpired('clang', 18)):
            self.assertEqual(self.request(body)[0], 422)
        self.assertTrue(server.SLOTS.acquire(blocking=False)); server.SLOTS.release()

    def test_headers_are_timed_and_worker_threads_are_bounded(self):
        slow = socket.create_connection(self.api.server_address)
        try:
            slow.sendall(b'POST /compile HTTP/1.1\r\n')
            self.assertEqual(slow.recv(1), b'')  # Header timeout, no slot taken.
        finally:
            slow.close()
        for _ in range(16):
            self.assertTrue(self.api.requests.acquire(blocking=False))
        try:
            excess = socket.create_connection(self.api.server_address)
            excess.settimeout(2)
            self.assertEqual(excess.recv(1), b''); excess.close()
        finally:
            for _ in range(16): self.api.requests.release()
        self.assertTrue(server.SLOTS.acquire(blocking=False)); server.SLOTS.release()


class ProcessTests(unittest.TestCase):
    def test_timeout_kills_spawned_descendants(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            directory = Path(name)
            child = directory / 'fixture.py'
            child.write_text("import os,time\npid=os.fork()\nif pid: open('child.pid','w').write(str(pid))\ntime.sleep(60)\n")
            with patch.object(server, 'CLANG', sys.executable), patch.object(server, 'FLAGS', [str(child)]), patch.object(server, 'STAGE_TIMEOUT', 1):
                with self.assertRaises(subprocess.TimeoutExpired):
                    server.command([], directory, 'output.txt')
            pid = int((directory / 'child.pid').read_text())
            time.sleep(.1)
            stat = Path(f'/proc/{pid}/stat')
            self.assertTrue(not stat.exists() or stat.read_text().split()[2] == 'Z', 'compiler child still running')


unittest.main(verbosity=2)
