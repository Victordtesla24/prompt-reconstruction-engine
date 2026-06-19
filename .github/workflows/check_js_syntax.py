#!/usr/bin/env python3
"""Validate JS syntax for the engine: the inline <script> in index.html plus
the shared core and the backend. Runs in CI before deploy."""
import subprocess, sys, os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def check_node(path):
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"JS SYNTAX ERROR in {path}:\n{r.stderr}")
        sys.exit(1)
    print(f"OK — {os.path.relpath(path, ROOT)}")


# 1) Inline <script> block extracted from index.html
html_path = os.path.join(ROOT, "public", "index.html")
with open(html_path) as f:
    content = f.read()
start = content.find("<script>")
end = content.find("</script>", start)
if start == -1 or end == -1:
    print("ERROR: No inline <script> block found in index.html")
    sys.exit(1)
js = content[start + 8: end]
tmp = "/tmp/script_check.js"
with open(tmp, "w") as f:
    f.write(js)
check_node(tmp)
print(f"  inline script: {len(js)} chars validated")

# 2) Shared core + 3) backend
check_node(os.path.join(ROOT, "public", "engine.core.js"))
check_node(os.path.join(ROOT, "server", "reconstruct-server.cjs"))

print("All JS syntax checks passed.")
