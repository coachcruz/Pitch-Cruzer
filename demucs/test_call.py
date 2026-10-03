"""Smoke-test the deployed Modal endpoint with a local audio file.

Usage:
  export PC_API_KEY=<same key you put in the modal secret>
  export PC_DEMUCS_URL=<endpoint URL printed by `modal deploy`>
  python test_call.py song.mp3
"""
import os
import sys
import urllib.request

url = os.environ["PC_DEMUCS_URL"]
key = os.environ["PC_API_KEY"]
path = sys.argv[1]

boundary = "----pcboundary1234"
with open(path, "rb") as f:
    audio = f.read()
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
    "Content-Type: audio/mpeg\r\n\r\n"
).encode() + audio + f"\r\n--{boundary}--\r\n".encode()

req = urllib.request.Request(
    url,
    data=body,
    headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {key}",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=1800) as r:
    out = r.read()
with open("stems.zip", "wb") as f:
    f.write(out)
print(f"OK: saved stems.zip ({len(out)/1e6:.1f} MB)")
