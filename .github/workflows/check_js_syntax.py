#!/usr/bin/env python3
"""Extract inline JS from index.html and validate syntax with Node.js."""
import re, subprocess, sys, os

html_path = os.path.join(os.path.dirname(__file__), "..", "..", "public", "index.html")

with open(html_path) as f:
    content = f.read()

start = content.find("<script>")
end = content.find("</script>", start)
if start == -1 or end == -1:
    print("ERROR: No inline <script> block found in index.html")
    sys.exit(1)

js = content[start + 8 : end]
script_path = "/tmp/script_check.js"
with open(script_path, "w") as f:
    f.write(js)

r = subprocess.run(["node", "--check", script_path], capture_output=True, text=True)
if r.returncode != 0:
    print(f"JS SYNTAX ERROR:\n{r.stderr}")
    sys.exit(1)

print(f"JS syntax OK — {len(js)} chars validated")
