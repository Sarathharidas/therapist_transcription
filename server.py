"""
Therapy Session Recorder — FastAPI backend
POST /process  → receives audio blob, returns transcript + clinical summary via Gemini
"""

import os
import tempfile
import time
import webbrowser
import threading
from pathlib import Path
from datetime import date

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import google.genai as genai
from google.genai.errors import ClientError
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set in .env")

client = genai.Client(api_key=GEMINI_API_KEY)
MODEL = "gemini-2.5-flash"

# ── Retry helper ───────────────────────────────────────────────────────────────

def _generate_with_retry(contents, max_retries=3):
    """Call generate_content with exponential backoff on 429s."""
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(model=MODEL, contents=contents)
        except ClientError as e:
            if e.code == 429 and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)   # 2s, 4s, 8s
                print(f"[server] Rate limited (429). Retrying in {wait}s… (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Unreachable")

# ── Prompts ────────────────────────────────────────────────────────────────────

TRANSCRIPT_PROMPT = """
You are transcribing a therapy session recording.

The speakers are:
- **Therapist** — the mental health professional
- **Patient** — the person receiving therapy

The audio may contain a mix of Malayalam and English (often called Manglish or code-switching).
Transcribe everything in English only:
- If spoken in English → transcribe verbatim
- If spoken in Malayalam → translate to natural English

Format each turn as:
Therapist: <text>
Patient: <text>

Rules:
- Label every turn with the correct speaker
- Include meaningful pauses as [pause] if noticeably long
- Do not skip or summarise anything — full verbatim transcription
- If a speaker is unclear, use "Unknown:"
- Output ONLY the transcript, no preamble or commentary
"""

SUMMARY_PROMPT_TEMPLATE = """
You are an experienced clinical psychologist writing session notes.

Based on the transcript below, produce structured clinical notes of the trascript below. Summary should be succinct



---
TRANSCRIPT:
{transcript}
"""

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Therapy Session Transcriber")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.post("/process")
async def process_audio(audio: UploadFile = File(...)):
    """Receive audio blob → transcribe → summarise → return JSON."""

    # 1. Save upload to a temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        size_kb = Path(tmp_path).stat().st_size // 1024
        print(f"[server] Received audio ({size_kb} KB). Uploading to Gemini Files API…")

        # 2. Upload to Gemini Files API
        audio_file = client.files.upload(
            file=tmp_path,
            config={"mime_type": "audio/webm", "display_name": "therapy_session"},
        )

        # Wait until file is ACTIVE
        for _ in range(30):
            info = client.files.get(name=audio_file.name)
            if info.state.name == "ACTIVE":
                break
            if info.state.name == "FAILED":
                raise HTTPException(500, "Gemini file processing failed")
            time.sleep(1)
        else:
            raise HTTPException(500, "Gemini file timed out waiting for ACTIVE state")

        print(f"[server] File ready — uri={audio_file.uri}. Transcribing…")

        try:
            # 3. Transcribe (with retry)
            transcript_resp = _generate_with_retry([
                TRANSCRIPT_PROMPT,
                genai.types.Part.from_uri(
                    file_uri=audio_file.uri,
                    mime_type="audio/webm",
                ),
            ])
            transcript = transcript_resp.text.strip()
            print(f"[server] Transcript: {len(transcript)} chars. Summarising…")

            # 4. Clinical summary (with retry)
            today = date.today().strftime("%B %d, %Y")
            summary_prompt = SUMMARY_PROMPT_TEMPLATE.format(
                date=today, transcript=transcript
            )
            summary_resp = _generate_with_retry(summary_prompt)
            summary = summary_resp.text.strip()
            print("[server] Summary done. Returning results.")

        except ClientError as e:
            print(f"[server] Gemini ClientError — code={e.code} status={e.status} message={e.message}")
            if e.code == 429:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        "Gemini API quota exceeded. "
                        "Please enable billing at aistudio.google.com or wait for your quota to reset."
                    ),
                )
            raise HTTPException(status_code=502, detail=f"Gemini API error ({e.code} {e.status}): {e.message}")

        finally:
            # Always clean up the remote file
            try:
                client.files.delete(name=audio_file.name)
            except Exception:
                pass

        return JSONResponse({"transcript": transcript, "summary": summary})

    finally:
        os.unlink(tmp_path)


# ── Launch ─────────────────────────────────────────────────────────────────────

def _open_browser():
    time.sleep(1.5)
    webbrowser.open("http://localhost:8000")


if __name__ == "__main__":
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
