"""Pitch-Cruzer stem separation on Modal serverless GPUs.

What this is:
  - A Modal app that runs Demucs (htdemucs, open-source, MIT) on a serverless
    T4 GPU. You POST an audio file, you get back a zip of 4 stems
    (vocals/drums/bass/other). The input file is deleted the moment separation
    finishes; nothing is retained.

Why Modal:
  - Billed per second, scales to zero. ~1-3 cents per song. $30/mo free credit.
  - You control the code and the retention policy -- no third party holds audio.

Deploy (the only steps that need Anthony):
  1. Sign up at https://modal.com, then:  pip install modal && modal setup
  2. Create the API secret (pick a long random key):
       modal secret create pc-demucs PC_API_KEY=<your-long-random-key>
  3. Deploy:  modal deploy modal_demucs.py
  4. Test:    python test_call.py <song.mp3>   (uses PC_API_KEY env var)

After deploy, Modal prints the endpoint URL. That URL + key go into the
Pitch-Cruzer Netlify function that will call it (next step, when ready).
"""

import modal

app = modal.App("pitch-cruzer-demucs")


def _download_model():
    # Baked into the image at build time so cold starts don't re-download.
    from demucs.pretrained import get_model

    get_model("htdemucs")


image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch",
        "demucs",
        "soundfile",
        "fastapi[standard]",
        "python-multipart",
        "lameenc",
    )
    .run_function(_download_model)
)


@app.function(
    image=image,
    gpu="T4",
    timeout=1800,  # billed per second actually used; long timeout costs nothing idle
    secrets=[modal.Secret.from_name("pc-demucs")],
)
@modal.fastapi_endpoint(method="POST")
async def separate_song(request):
    """POST multipart form with field `file` = audio. Returns zip of stems."""
    import io
    import os
    import shutil
    import subprocess
    import tempfile
    import zipfile

    from fastapi.responses import Response

    expected = f"Bearer {os.environ['PC_API_KEY']}"
    if request.headers.get("authorization") != expected:
        return Response("unauthorized", status_code=401)

    form = await request.form()
    upload = form["file"]
    data = await upload.read()
    if not data:
        return Response("empty file", status_code=400)

    tmp = tempfile.mkdtemp(prefix="pc-demucs-")
    try:
        ext = os.path.splitext(getattr(upload, "filename", "") or "")[1] or ".mp3"
        in_path = os.path.join(tmp, "input" + ext)
        with open(in_path, "wb") as f:
            f.write(data)
        del data  # free the upload buffer ASAP

        out_dir = os.path.join(tmp, "out")
        proc = subprocess.run(
            [
                "python", "-m", "demucs",
                "-n", "htdemucs",
                "--mp3", "--mp3-bitrate", "320",
                "-o", out_dir,
                in_path,
            ],
            capture_output=True,
            text=True,
        )
        # The input is wiped the moment separation finishes -- nothing retained.
        if os.path.exists(in_path):
            os.remove(in_path)
        if proc.returncode != 0:
            return Response(f"separation failed: {proc.stderr[-2000:]}", status_code=500)

        track = os.path.splitext(os.path.basename(in_path))[0]
        stem_dir = os.path.join(out_dir, "htdemucs", track)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for stem in ("vocals", "drums", "bass", "other"):
                p = os.path.join(stem_dir, stem + ".mp3")
                if not os.path.exists(p):
                    return Response(f"missing stem: {stem}", status_code=500)
                z.write(p, stem + ".mp3")
        return Response(
            buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=stems.zip"},
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
