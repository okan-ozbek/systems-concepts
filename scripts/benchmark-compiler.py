"""Run in the compiler container to compare the old debug build with this build."""
import base64
import json
from unittest.mock import patch
import server

source = '''#include <iostream>
#include <vector>
int main() {
    std::vector<int> values{1,2,3,4};
    values.push_back(5);
    int total=0;
    for(std::size_t i=0;i<values.size();++i) {total+=values[i];}
    std::cout << total << '\\n';
    return 0;
}'''
command = server.command
def old_command(args, directory, output):
    return command([arg for arg in args if arg != '-Wl,--strip-debug'], directory, output)
with patch.object(server, 'FLAGS', [*server.FLAGS, '-g']), patch.object(server, 'command', old_command):
    before = server.compile_source(source)
after = server.compile_source(source)
old_bytes, new_bytes = (len(base64.b64decode(result['wasm'])) for result in (before, after))
assert before['checkpoints'] == after['checkpoints']
assert new_bytes < old_bytes
print(json.dumps({'example': 'vector iteration', 'before_bytes': old_bytes, 'after_bytes': new_bytes,
                  'reduction_percent': round((1-new_bytes/old_bytes)*100, 1), 'checkpoints': after['checkpoints']}))
