"""
Gemini service — file upload, transcription, clinical summary.
Isolated from HTTP layer so it can be called from any context.

Methods are split into individual steps so the job runner can
update status between each phase.
"""

import os
import time
from pathlib import Path
from typing import Optional

import google.genai as genai
from google.genai.errors import ClientError

MODEL = "gemini-2.5-flash"

TRANSCRIPT_PROMPT = """
You are transcribing a therapy session recording.

The session has:
- 1 Therapist — the mental health professional
- 1 or more Patients — people receiving therapy

Speaker labelling rules:
- If there is only ONE patient voice, label them as "Patient:"
- If there are TWO OR MORE patient voices, label them as "Patient 1:", "Patient 2:", etc.
  Assign numbers by order of first speech — the first patient to speak is Patient 1.
- Keep speaker labels consistent throughout the entire transcript.
- The therapist is usually the one asking questions and guiding the session.

Language rules:
- The audio may contain a mix of Malayalam and English (Manglish / code-switching).
- Transcribe everything in English only.
- English speech → transcribe verbatim
- Malayalam speech → translate to natural English

Format every turn on its own line:
Therapist: <text>
Patient: <text>          ← single patient
Patient 1: <text>        ← multiple patients
Patient 2: <text>

Rules:
- Label every turn; never skip content
- Include long silences as [pause]
- Use "Unknown:" only when the speaker is genuinely unclear after careful listening
- Output ONLY the transcript — no preamble, no commentary, no explanation
"""

SUMMARY_TEMPLATE = """
You are an experienced clinical psychologist.

Read the therapy session transcript below and write a concise plain-language summary
of what was discussed. Write it as 2–4 flowing paragraphs — no headings, no bullet
points, no subheadings. Just a clear, natural summary of the session.

TRANSCRIPT:
{transcript}
"""


class GeminiService:
    def __init__(self, api_key: str) -> None:
        self.client = genai.Client(api_key=api_key)

    def _generate(self, contents: object, max_retries: int = 3) -> str:
        """Call generate_content with exponential backoff on 429s."""
        for attempt in range(max_retries):
            try:
                resp = self.client.models.generate_content(model=MODEL, contents=contents)
                return resp.text.strip()
            except ClientError as e:
                if e.code == 429 and attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1)
                    print(f"[gemini] Rate limited. Retrying in {wait}s…")
                    time.sleep(wait)
                else:
                    raise
        raise RuntimeError("Unreachable")

    # ── Individual pipeline steps ──────────────────────────────────────────

    def upload_file(self, audio_path: str, mime_type: str = "audio/webm") -> object:
        """
        Upload audio to Gemini Files API and wait for ACTIVE state.
        Returns the file object (has .name and .uri attributes).
        Raises RuntimeError if the file fails to process or times out.
        """
        size_kb = Path(audio_path).stat().st_size // 1024
        print(f"[gemini] Uploading {size_kb} KB ({mime_type})…")

        audio_file = self.client.files.upload(
            file=audio_path,
            config={"mime_type": mime_type, "display_name": "therapy_session"},
        )

        # Wait up to 60 seconds for ACTIVE state (large files may need more time)
        for _ in range(60):
            info = self.client.files.get(name=audio_file.name)
            if info.state.name == "ACTIVE":
                break
            if info.state.name == "FAILED":
                raise RuntimeError("Gemini file processing failed")
            time.sleep(1)
        else:
            raise RuntimeError("Gemini file timed out waiting for ACTIVE state")

        print(f"[gemini] File ready — {audio_file.uri}")
        return audio_file

    def transcribe(self, audio_file: object, mime_type: str = "audio/webm") -> str:
        """Generate transcript from an uploaded Gemini file."""
        print("[gemini] Transcribing…")
        transcript = self._generate([
            TRANSCRIPT_PROMPT,
            genai.types.Part.from_uri(
                file_uri=audio_file.uri,
                mime_type=mime_type,
            ),
        ])
        print(f"[gemini] Transcript: {len(transcript)} chars")
        return transcript

    def summarize(self, transcript: str) -> str:
        """Generate plain-language clinical summary from transcript text."""
        print("[gemini] Summarising…")
        summary = self._generate(SUMMARY_TEMPLATE.format(transcript=transcript))
        print("[gemini] Summary done.")
        return summary

    def delete_file(self, audio_file: object) -> None:
        """Delete a file from the Gemini Files API. Silently ignores errors."""
        try:
            self.client.files.delete(name=audio_file.name)
        except Exception:
            pass

    # ── Convenience one-shot wrapper ───────────────────────────────────────

    def process_audio(self, audio_path: str, mime_type: str = "audio/webm") -> tuple:
        """
        One-shot: upload → transcribe → summarise → delete Gemini file.
        Returns (transcript, summary).
        Used by the legacy synchronous path; the async job runner calls
        the individual methods directly to update status between steps.
        """
        audio_file = self.upload_file(audio_path, mime_type)
        try:
            transcript = self.transcribe(audio_file, mime_type)
            summary = self.summarize(transcript)
        finally:
            self.delete_file(audio_file)
        return transcript, summary


# Module-level singleton — initialised once at startup
_service: Optional[GeminiService] = None


def get_service() -> GeminiService:
    global _service
    if _service is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        _service = GeminiService(api_key)
    return _service
