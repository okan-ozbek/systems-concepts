"""Bounded compile-only API. Submitted code is never executed by this service."""
import base64
from collections import OrderedDict
import hashlib
import json
import os
import signal
import socket
import subprocess
import tempfile
import threading
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from instrument import validate_source, main_ast, instrument

CLANG = '/opt/wasi-sdk/bin/clang++'
SLOTS = threading.BoundedSemaphore(1)
FLAGS = ['-std=c++20', '-O0', '-fno-exceptions', '-fno-color-diagnostics', '-Wno-unused-value']
STAGE_TIMEOUT = 18
APP = Path(__file__).resolve().parent
# Keep exact source offsets; changes to the compiler/instrumentation invalidate results.
VERSION = hashlib.sha256(b'wasi-sdk-30/cache-v1' + json.dumps(FLAGS).encode() +
                        b''.join((APP / name).read_bytes() for name in ('instrument.py', 'trace.hpp', 'server.py', 'runner.py'))).digest()


class CompileCache:
    def __init__(self, max_bytes=16 * 1024 * 1024, max_entries=32, ttl=600):
        self.max_bytes, self.max_entries, self.ttl = max_bytes, max_entries, ttl
        self.entries = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                return None
            created, body = entry
            if time.monotonic() - created >= self.ttl:
                self.bytes -= len(body)
                del self.entries[key]
                return None
            self.entries.move_to_end(key)
            return body

    def put(self, key, body):
        if len(body) > self.max_bytes:
            return
        with self.lock:
            previous = self.entries.pop(key, None)
            if previous:
                self.bytes -= len(previous[1])
            self.entries[key] = (time.monotonic(), body)
            self.bytes += len(body)
            while self.bytes > self.max_bytes or len(self.entries) > self.max_entries:
                _, (_, removed) = self.entries.popitem(last=False)
                self.bytes -= len(removed)


CACHE = CompileCache()


def cache_key(source):
    return hashlib.sha256(VERSION + source.encode('utf-8')).digest()


def command(args, directory, output):
    with open(directory / output, 'wb') as stdout, open(directory / 'errors.txt', 'wb') as stderr:
        process = subprocess.Popen([sys.executable, str(APP / 'runner.py'), CLANG, *FLAGS, *args],
                                   cwd=directory, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   start_new_session=True,
                                   env={'PATH': '/opt/wasi-sdk/bin:/usr/bin', 'TMPDIR': str(directory)})
        try:
            process.wait(timeout=STAGE_TIMEOUT)
        finally:
            # Clang can spawn a linker: clean up the whole session, even on timeout.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    errors = (directory / 'errors.txt').read_text(errors='replace')[:12000].replace(str(directory) + '/', '')
    if process.returncode:
        raise ValueError(errors or 'Compilation exceeded its resource budget.')
    return errors


def compile_source(source):
    validate_source(source)
    with tempfile.TemporaryDirectory(prefix='cpp-', dir='/tmp') as name:
        directory = Path(name)
        (directory / 'main.cpp').write_text(source, encoding='utf-8')
        warnings = command(['-fsyntax-only', '-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=main', 'main.cpp'], directory, 'ast.json')
        transformed, checkpoints = instrument(source, main_ast((directory / 'ast.json').read_text()))
        (directory / 'traced.cpp').write_text(transformed, encoding='utf-8')
        warnings += command(['traced.cpp', '-Wl,--strip-debug', '-Wl,--threads=1', '-Wl,--export-memory', '-Wl,--max-memory=33554432', '-o', 'program.wasm'], directory, 'compile.txt')
        binary = (directory / 'program.wasm').read_bytes()
        if len(binary) > 4 * 1024 * 1024:
            raise ValueError('Compiled program exceeds the 4 MB lab limit.')
        return {'wasm': base64.b64encode(binary).decode(), 'warnings': warnings, 'checkpoints': checkpoints,
                'compiler': 'Clang / WASI SDK 30 · C++20 · -O0 · wasm32'}


class BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self.requests = threading.BoundedSemaphore(16)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.requests.acquire(blocking=False):
            self.shutdown_request(request)
            print(json.dumps({'event': 'connection_rejected', 'reason': 'connection_budget'}), flush=True)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.requests.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.requests.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'Compiler'
    sys_version = ''

    def setup(self):
        self.request.settimeout(5)  # Covers headers before a compile slot is reserved.
        self.started = time.monotonic()
        self.source_bytes = 0
        super().setup()

    def reply(self, status, data, cache=None):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        if cache:
            self.send_header('X-Compile-Cache', cache)
        self.end_headers()
        self.close_connection = True
        print(json.dumps({'event': 'request', 'status': status, 'cache': cache,
                          'source_bytes': self.source_bytes,
                          'duration_ms': round((time.monotonic() - self.started) * 1000)}), flush=True)
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'ready': True})
        else:
            self.reply(404, {'error': 'Unknown endpoint.'})

    def do_POST(self):
        if self.path != '/compile':
            return self.reply(404, {'error': 'Unknown endpoint.'})
        if self.headers.get_content_type() != 'application/json':
            return self.reply(415, {'error': 'Use application/json.'})
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
            return self.reply(400, {'error': 'Provide one Content-Length.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.reply(400, {'error': 'Invalid request size.'})
        if not 0 < length <= 24000:
            return self.reply(413, {'error': 'Source is limited to 16 KB.'})
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                return self.reply(400, {'error': 'Incomplete request.'})
            payload = json.loads(body)
            if not isinstance(payload, dict) or not isinstance(payload.get('source'), str):
                return self.reply(400, {'error': 'Provide C++ source text.'})
            source = payload['source']
            self.source_bytes = len(source.encode('utf-8'))
            validate_source(source)
        except socket.timeout:
            return self.reply(408, {'error': 'Request body timed out.'})
        except (ValueError, UnicodeError) as error:
            return self.reply(422, {'error': str(error)[:12000]})
        key = cache_key(source)
        cached = CACHE.get(key)
        if cached is not None:
            return self.reply(200, cached, 'HIT')
        if not SLOTS.acquire(blocking=False):
            return self.reply(429, {'error': 'Compiler is busy. Try again in a moment.'})
        try:
            cached = CACHE.get(key)
            if cached is not None:
                return self.reply(200, cached, 'HIT')
            result = json.dumps(compile_source(source)).encode()
            CACHE.put(key, result)
            self.reply(200, result, 'MISS')
        except subprocess.TimeoutExpired:
            self.reply(422, {'error': 'Compilation timed out (18 seconds per stage).'})
        except (ValueError, OSError) as error:
            self.reply(422, {'error': str(error)[:12000]})
        finally:
            SLOTS.release()

    def log_message(self, format, *args):
        pass  # Structured records omit source and request paths.


if __name__ == '__main__':
    BoundedHTTPServer(('0.0.0.0', 9000), Handler).serve_forever()
