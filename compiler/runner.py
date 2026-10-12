"""Apply compiler limits in a fresh process, avoiding preexec_fn in HTTP threads."""
import os
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
os.execve(sys.argv[1], sys.argv[1:], os.environ)
