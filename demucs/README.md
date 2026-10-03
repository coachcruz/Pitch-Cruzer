# pitch-cruzer-demucs

Stem separation for Pitch-Cruzer on Modal serverless GPUs.

- `modal_demucs.py` — the Modal app. POST an audio file, get back a zip of
  4 stems (vocals/drums/bass/other). Input is wiped the moment separation
  finishes; nothing is retained.
- `test_call.py` — smoke-test the deployed endpoint.

Deploys automatically via GitHub Actions on push to `main`.
Secrets (`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `PC_API_KEY`) live in the
repo's Actions secrets.

Deploy retry after billing unlock.
