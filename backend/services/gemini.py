"""
Gemini service — file upload, transcription, clinical summary.
Isolated from HTTP layer so it can be called from any context.

Methods are split into individual steps so the job runner can
update status between each phase.
"""

import glob
import os
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional, Tuple

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
- NEVER output Malayalam script or romanised Malayalam words. Always render the
  meaning in natural English, even if you are unsure — translate, do not transliterate.
  (Proper nouns such as names and places may stay as-is.)

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

# The editable default. A therapist may override this per-account
# (clinicians.summary_format); when they haven't, this is used. The summarizer
# fills the ____ blanks from the transcript and marks anything absent as
# "Not discussed". Keep this as a pure Markdown skeleton — the clinical
# instructions live in SUMMARY_INSTRUCTIONS below, not here.
DEFAULT_SUMMARY_FORMAT = """# OP CASE SHEET
**MINDWORLD — Mental Health Clinic and Training Centre**

> Template for psychiatric outpatient case documentation / therapy notes.
> Fields marked with `____` are to be filled in. Option lists separated by `/` indicate
> select-one-or-more choices — strike through or delete the options that do not apply.

---

## Socio-Demographic Details

- **Date:** ____
- **Name:** ____
- **Age:** ____  **Sex:** ____  **DOB:** ____
- **Phone number:** ____  **Email id:** ____
- **Education:** ____  **Occupation:** ____
- **Marital Status:** ____
- **Language:** ____  **Religion:** ____
- **Monthly income:** ____
- **Socio-economic status:** ____  **Urban / Rural:** ____
- **Informant:** ____
- **Reliability and adequacy:** ____

## Complaints and Their Duration
____

## History of Present Illness
- **Onset:** ____
- **Duration:** ____
- **Precipitating factors:** ____

### Course of Illness
- **(a) Associated disturbance:** ____
- **(b) Negative history — Medical history:** DM / HT / IHD / epilepsy / head injury / fever and headache / CSOM / jaundice / thyroid / bronchial asthma / others. — ____
- **(c) Treatment history:** ____
- **(d) Past psychiatric and medical history:** ____
- **(e) Family History:** ____

### 3-Generation Genogram (should include consanguinity)
> Draw genogram. Note relationships and any psychological illness.
____

- **Medical illness in family:** HT / DM / asthma / allergy / blood dyscrasias / epilepsy. — ____
- **Psychiatric illness in family:** suicide / attempted suicide / DSH / whereabouts not known / living alone / alcoholism / substance abuse / divorce / separated / frequent change of job / frequent change of domicile / litiginous behavior / extremes of life style / psychiatric consultations / mental retardation. — ____

---

## Developmental and Social History

### Birth and Early Development
- **Antenatal:** wanted / planned / accidental / legitimate / natural / assisted / rejected / illegitimate / others. — ____
- **Perinatal:** natural / assisted / home / hospital / forceps / caesarian / complications / birth injury / jaundice / cried immediately / kept in incubator / full term / premature / fits / others. — ____
- **Postnatal:** ____
- **Developmental history (developmental milestones):** ____
- **Behavior during childhood:** ____

### Schooling
- **Initiation:** ____
- **Performance:** ____
- **Exit:** ____

### College
- **Initiation:** ____
- **Performance:** ____
- **Exit:** ____

### Occupation
- **Satisfied / not satisfied:** ____
- **Remuneration:** happy / unhappy — ____
- **Work culture:** ____
- **Work atmosphere:** ____
- **Any promotions:** ____
- **Any punishments:** ____
- **Change of jobs (if yes, why? how often?):** ____

### Menstrual History
- **Age of menarche:** ____
- **Age at menopause:** ____
- **Cycle length:** regular / irregular — ____
- **Flow:** normal / abnormal (explain) — ____
- **Last menstrual period:** ____
- **Any other abnormalities:** ____

### Sexual History
- **Knowledge, any complaints and practices:** ____

### Marital History
- **Marriage:** ____
- **Type:** ____
- **Familiarity:** familiar / unfamiliar / known / unknown — ____
- **Partner's age / reactions to marriage / any religious, cultural, communal conflicts:** ____
- **Spouse reaction:** ____
- **Any separation / divorce / others:** ____

### Family Size
- **Includes children:** ____

### Family Atmosphere and Life Situation
- **About the domicile:** own / rented / no. of rooms / others — ____
- **Family size:** ____
- **Head of the family:** ____
- **Family income:** ____
- **Dominant / submissive roles of family members:** ____
- **Deciding person:** ____
- **Contribution to family:** ____
- **Others' contribution:** ____
- **Interaction in the family:** ____
- **Any pathology in the family:** ____
- **Physical illness during childhood:** ____
- **Use and abuse of alcohol, tobacco, and drugs:** ____

### Premorbid Personality
1. **Attitude to others in social, family and sexual relationships:** ____
2. **Attitude to self:** ____
3. **Moral and religious attitudes and standards:** ____
4. **Mood:** ____
5. **Leisure activities and interests:** ____
6. **Fantasy life:** ____
7. **Reaction pattern to stress:** ____
8. **Biological functions and habits:** ____

- **Interests:** ____
- **Disposition:** social / friendly / lonely / alone / reserved — ____
- **Habits, fads, beliefs, cults:** ____
- **Initiative:** ____
- **Leadership:** ____
- **Follower:** ____
- **Risk taking:** ____
- **Sensation seeking:** ____
- **Risk avoidance:** ____
- **Leisure time activities:** ____
- **Hobbies:** ____
- **Religious:** ____
- **Values:** ____
- **Drugs:** ____
- **Traits:** ____
- **Daily routine:** ____
- **Others:** ____

---

## Mental Status Examination

### General Appearance
- **Personal Identification:** ____
- **How the patient entered the room:** ____
- **Conscious:** ____
- **Co-operative:** ____
- **Rapport:** ____
- **Eye-to-eye contact:** ____
- **Grooming:** kempt / moderately kempt / ill-kempt — ____

### Behavior and Psychomotor Activity
**Speech:**
- **Tone / tempo / volume:** ____
- **Reaction time:** ____
- **Relevancy:** ____

**Thought** (obtain a neutral speech sample): ____

**Disorder of Content of Thought**
- Depressive and anxious cognition, delusions and overvalued ideas, made act, affect impulse: ____

**Delusions**
- **Verbatim** (false, firm, fixed, shared / unshared, culturally unaccepted): ____
- **Primary / secondary:** ____
- **Single / multiple:** ____
- **Systematization:** ____
- **Elaboration:** ____
- **Bizarreness:** ____
- **Form:** ____
- **Mood congruous** (in primary mood disorder alone): ____
- **Acting out behavior:** ____

**Disorder of Form of Thought**
- Positive formal thought disorders: derailment, tangentiality, neologism, loosening of association
- Negative FTD: poverty of speech, poverty of content of speech
- Notes: ____

**Disorder of Stream of Thought**
- Flight of ideas, prolixity, slowness of thinking, circumstantiality, perseveration, thought blocking
- Notes: ____

**Disorder of Possession of Thought**
- Obsession, compulsion, thought broadcast, thought insertion, withdrawal
- Notes: ____

### Mood
- **Subjective mood:** ____
- **Objective mood:** ____
- **Quantify:** ____
- **Qualify** (range, reactivity, liability, appropriateness, and congruency): ____
- **Affect:** ____

### Perceptual Disturbance
(Illusion, hallucination, depersonalization, and congruency)

**Hallucinations**
- **Clear consciousness:** ____
- **Involuntary:** ____
- **Modality:** ____
- **Objective / subjective:** ____
- **Distance:** ____
- **Continuous with the surroundings:** ____
- **Clear as normal:** ____
- **I / II / III PAH (number of persons):** ____
- **Content:** ____
- **Acting out:** ____
- **Frequency:** ____
- **Distress:** ____
- **Special kinds:** ____

### Cognitive Functions
**A) Attention and Concentration**
- **Serial subtraction test:** ____
- **Telling the days of week backwards:** ____
- **Digit span test** — Forward: 5±2 → ____  Backward: 3±2 → ____

**B) Orientation**
- **Time, place, person:** ____

**C) Memory**
- **Immediate** (digit span): ____
- **Recent memory** (past few days): ____
  - Address test: ____
  - Delayed recall of 4 objects: ____
  - Recalling events in past 24 hrs: ____
- **Remote memory** — personal backgrounds (if no past details available to cross-check, ask important events of history in the past): ____

**General Information**
- **Intelligence:**
  - a) General Intelligence: ____
  - b) Comprehension: ____
  - c) Arithmetic: ____
- **Abstract ability:**
  - Similarities: ____
  - Differences: ____
  - Proverb test: ____

### Judgment
- **Personal judgment:** ____
- **Social:** ____
- **Test judgment:** ____

### Insight
- **Grading:** ____
- **Level of insight:** ____

---

## Diagnostic Formulation
- **Summary:** ____
- **Suggestion:** ____

---

**Assessed By:** ____
**Signature:** ____
"""

# Fixed clinical wrapper around the (possibly customised) format. These rules are
# NOT therapist-editable so a bad format edit can't break summary quality.
SUMMARY_INSTRUCTIONS = """You are an experienced clinical psychologist completing a structured case sheet / therapy note from a therapy session transcript.

Read the transcript and fill in the TEMPLATE provided below, following its EXACT structure, headings, and order. This is a clinical document, not a narrative summary.

GROUND RULES — read carefully:
- Use ONLY information that is actually present in the transcript. Never invent, assume, or infer facts that were not stated (no fabricated dates, ages, diagnoses, test scores, or history).
- The template contains blank fields shown as "____". Replace each "____" with the relevant information drawn from the transcript.
- For any field the transcript does not cover, write exactly: Not discussed
- For option lists separated by "/" (e.g. "own / rented / others"), keep only the option(s) supported by the transcript and state the finding; if none are mentioned, write: Not discussed
- Reproduce EVERY section and field heading from the template, even when the value is "Not discussed", so the document stays complete for the clinician to finish.
- Be concise and clinical. Quote the patient's own words ("verbatim") for complaints, delusions, and mood where relevant.
- Output GitHub-flavoured Markdown ONLY, preserving the template's headings and structure.
- Do NOT keep the template's instructional blockquote lines (the "> Template for..." guidance). Do NOT add any preamble, closing remarks, or commentary outside the document.

TEMPLATE TO FILL:
<<<FORMAT>>>

TRANSCRIPT:
<<<TRANSCRIPT>>>
"""

# Used for each individual chunk in parallel transcription.
# Neutral voice-based labels (Speaker 1/2/3) — no role guessing within a single segment.
CHUNK_TRANSCRIPT_PROMPT = """
You are transcribing one segment of a therapy session recording.

Language rules:
- The audio may contain a mix of Malayalam and English (Manglish / code-switching).
- Transcribe everything in English only.
- English speech → transcribe verbatim
- Malayalam speech → translate to natural English
- NEVER output Malayalam script or romanised Malayalam words. Always render the
  meaning in natural English, even if you are unsure — translate, do not transliterate.
  (Proper nouns such as names and places may stay as-is.)

Speaker labelling rules:
- Label speakers by voice only — do NOT try to guess roles (therapist vs patient).
- Use neutral labels: Speaker 1, Speaker 2, Speaker 3, etc.
- Assign numbers by order of first speech in THIS segment — the first voice heard is Speaker 1.
- Be consistent within this segment.

Format every turn on its own line:
Speaker 1: <text>
Speaker 2: <text>

Rules:
- Label every turn; never skip content
- Include long silences as [pause]
- Use "Unknown:" only when the speaker is genuinely unclear after careful listening
- Output ONLY the transcript — no preamble, no commentary, no explanation
"""

# Used in the single text-only normalization pass after all chunks are transcribed.
NORMALIZATION_PROMPT = """
You are given transcript segments from a single therapy session.
Each segment was transcribed independently using neutral voice-based labels
(Speaker 1, Speaker 2, etc.) that may be inconsistent across segments.

LANGUAGE — mandatory, overrides everything else:
- The final unified transcript MUST be entirely in natural English.
- Some segments may still contain Malayalam (in Malayalam script or romanised) or
  other non-English text that slipped through. Translate ALL of it into natural
  English as you rewrite — translate the meaning, do not transliterate.
- Never output Malayalam script. Never leave any turn partly in Malayalam.
- Proper nouns (names, places) may stay as-is.

Your task — follow these steps in order:

STEP 1 — Determine the full speaker roster across ALL segments before assigning any labels.
  - How many distinct real-world voices are there across the entire session?
  - The same person may be labelled differently in different segments (e.g. Speaker 2 in
    segment 1 may be the same voice as Speaker 1 in segment 4).
  - Some segments may only have one patient speaking even if two patients exist in the session.

STEP 2 — Identify the Therapist:
  - The Therapist asks clinical questions, guides the session, and uses professional language.

STEP 3 — Number the patients by order of FIRST APPEARANCE across the entire session
  (not per segment). The first patient voice heard anywhere = Patient 1.
  - If only one patient exists, label them "Patient:" (no number).
  - If two or more patients exist, label them "Patient 1:", "Patient 2:", etc.

STEP 4 — Rewrite the full unified transcript with consistent labels throughout,
  ensuring every line is in natural English (translate any remaining Malayalam or
  other non-English text — never leave Malayalam script in the output).

Output format (one turn per line):
Therapist: <text>
Patient: <text>          ← single patient
Patient 1: <text>        ← multiple patients
Patient 2: <text>
Unknown: <text>          ← only when genuinely unclear

Output ONLY the unified transcript — no preamble, no step explanations, no commentary.

SEGMENTS:
{segments}
"""


# Matches any character in the Malayalam Unicode block (U+0D00–U+0D7F).
_MALAYALAM_RE = re.compile(r"[ഀ-ൿ]")

# Safety-net pass: re-translate a transcript that still contains Malayalam,
# preserving speaker labels and turn-by-turn layout. {transcript} is injected
# with .replace() so braces in the text don't break anything.
TRANSLATE_TO_ENGLISH_PROMPT = """The therapy session transcript below still contains some Malayalam (in Malayalam script or romanised). Rewrite it so it is ENTIRELY in natural English.

Rules:
- Translate every Malayalam word and phrase into natural English — translate the meaning, do not transliterate.
- Keep the speaker labels exactly as they are (Therapist:, Patient:, Patient 1:, etc.) and keep every turn on its own line.
- Do NOT add, remove, merge, reorder, or summarise turns — only translate.
- Keep proper nouns (names, places) as-is.
- Output ONLY the rewritten transcript — no preamble, no commentary.

TRANSCRIPT:
<<<TRANSCRIPT>>>
"""


def _names_hint(names: Optional[List[str]]) -> str:
    """
    Build a prompt fragment that tells Gemini who is in the room so it can use
    real names instead of generic Patient N labels. Returns "" if no names.

    - One name  → individual (1:1) segment: label every patient turn "Patient:".
    - 2+ names  → joint segment: attribute to real names where context makes the
      speaker clear; otherwise fall back to Patient 1 / Patient 2.
    """
    clean = [n.strip() for n in (names or []) if n and n.strip()]
    if not clean:
        return ""
    if len(clean) == 1:
        return (
            f"\n\nCONTEXT: There is exactly one patient in this segment, named "
            f"{clean[0]}. Label every one of their turns as \"Patient:\".\n"
        )
    listed = ", ".join(clean)
    return (
        f"\n\nCONTEXT: The patients present in this session are: {listed}. "
        f"Use a patient's real first name as the speaker label (e.g. \"{clean[0]}:\") "
        f"when context makes it clear who is speaking — for example when someone is "
        f"addressed by name. When you cannot tell which patient is speaking, fall back "
        f"to \"Patient 1:\", \"Patient 2:\", etc. Keep each person's label consistent.\n"
    )


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

    def transcribe(self, audio_file: object, mime_type: str = "audio/webm",
                   prompt: str = None) -> str:
        """Generate transcript from an uploaded Gemini file."""
        print("[gemini] Transcribing…")
        transcript = self._generate([
            prompt if prompt is not None else TRANSCRIPT_PROMPT,
            genai.types.Part.from_uri(
                file_uri=audio_file.uri,
                mime_type=mime_type,
            ),
        ])
        print(f"[gemini] Transcript: {len(transcript)} chars")
        return transcript

    def summarize(self, transcript: str, fmt: Optional[str] = None) -> str:
        """
        Generate a structured clinical case-sheet summary from transcript text.

        fmt: the therapist's custom format skeleton (Markdown). When None or blank,
        the built-in DEFAULT_SUMMARY_FORMAT is used. The fixed clinical instructions
        in SUMMARY_INSTRUCTIONS always wrap the format and are not editable.
        """
        template = fmt if (fmt and fmt.strip()) else DEFAULT_SUMMARY_FORMAT
        # Use .replace() (not .format()) so braces in the transcript/template don't break.
        prompt = (
            SUMMARY_INSTRUCTIONS
            .replace("<<<FORMAT>>>", template)
            .replace("<<<TRANSCRIPT>>>", transcript)
        )
        print("[gemini] Summarising…")
        summary = self._generate(prompt)
        print("[gemini] Summary done.")
        return summary

    def delete_file(self, audio_file: object) -> None:
        """Delete a file from the Gemini Files API. Silently ignores errors."""
        try:
            self.client.files.delete(name=audio_file.name)
        except Exception:
            pass

    # ── Chunked parallel transcription ────────────────────────────────────

    def _get_duration(self, audio_path: str) -> Optional[float]:
        """Return audio duration in seconds via ffprobe, or None if unavailable."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                return float(result.stdout.strip())
        except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
            pass
        return None

    def _split_into_chunks(self, audio_path: str, chunk_seconds: int = 300) -> Tuple[str, List[str]]:
        """
        Split audio into fixed-length chunks using ffmpeg stream copy (no re-encoding).
        Returns (tmp_dir, [chunk_paths]) — caller must delete tmp_dir when done.
        Raises RuntimeError if ffmpeg is unavailable or fails.
        """
        tmp_dir = tempfile.mkdtemp(prefix="aura_chunks_")
        pattern = os.path.join(tmp_dir, "chunk_%03d.webm")
        result = subprocess.run(
            ["ffmpeg", "-i", audio_path,
             "-f", "segment", "-segment_time", str(chunk_seconds),
             "-reset_timestamps", "1", "-c", "copy", "-y", pattern],
            capture_output=True, timeout=120,
        )
        if result.returncode != 0:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(f"ffmpeg split failed: {result.stderr.decode()[:300]}")
        chunks = sorted(glob.glob(os.path.join(tmp_dir, "chunk_*.webm")))
        print(f"[gemini] Split into {len(chunks)} chunks of ≤{chunk_seconds}s")
        return tmp_dir, chunks

    def _transcribe_chunk_neutral(self, chunk_path: str, index: int, total: int,
                                   mime_type: str) -> Tuple[int, str]:
        """Upload and transcribe one chunk using neutral Speaker N labels."""
        audio_file = self.upload_file(chunk_path, mime_type)
        try:
            text = self.transcribe(audio_file, mime_type, prompt=CHUNK_TRANSCRIPT_PROMPT)
            print(f"[gemini] Chunk {index + 1}/{total} → {len(text)} chars")
            return index, text
        finally:
            self.delete_file(audio_file)

    def normalize_transcript(self, chunk_transcripts: List[str],
                             names_hint: Optional[List[str]] = None) -> str:
        """
        Single text-only Gemini call that unifies speaker labels across all chunks.
        Determines the full speaker roster globally, assigns Therapist/Patient roles
        based on content, and handles the case where some chunks have fewer speakers
        than others (e.g. Patient 2 only appears in certain segments).

        When names_hint is provided, patient turns are labelled with real names
        where the speaker is clear. Falls back to raw stitched transcript on error.
        """
        segments = "\n\n".join(
            f"[SEGMENT {i + 1}]\n{text}"
            for i, text in enumerate(chunk_transcripts)
        )
        prompt = NORMALIZATION_PROMPT.format(segments=segments) + _names_hint(names_hint)
        print(f"[gemini] Normalizing transcript across {len(chunk_transcripts)} segments…")
        try:
            unified = self._generate(prompt)
            print(f"[gemini] Normalized: {len(unified)} chars")
            return unified
        except Exception as exc:
            print(f"[gemini] Normalization failed ({exc}), using raw stitched transcript")
            return "\n".join(chunk_transcripts)

    # ── English-only safety net ───────────────────────────────────────────

    def _has_malayalam(self, text: str) -> bool:
        """True if any Malayalam-script character is present."""
        return bool(text) and _MALAYALAM_RE.search(text) is not None

    def _ensure_english(self, transcript: str) -> str:
        """
        The transcription/normalization prompts ask for English only, but the model
        occasionally leaves Malayalam script in. As a guarantee, scan the final
        transcript and, only if Malayalam is found, run one targeted translation
        pass that preserves speaker labels and layout. No-op (and no API call) when
        the transcript is already clean.
        """
        if not self._has_malayalam(transcript):
            return transcript
        print("[gemini] Malayalam detected in transcript — running English translation pass")
        try:
            translated = self._generate(
                TRANSLATE_TO_ENGLISH_PROMPT.replace("<<<TRANSCRIPT>>>", transcript)
            )
            if not translated:
                return transcript
            if self._has_malayalam(translated):
                print("[gemini] Translation pass still contained Malayalam — keeping best effort")
            return translated
        except Exception as exc:
            print(f"[gemini] Translation pass failed ({exc}); returning original transcript")
            return transcript

    def transcribe_fast(self, audio_path: str, mime_type: str = "audio/webm",
                        chunk_seconds: int = 300, max_workers: int = 6,
                        names_hint: Optional[List[str]] = None) -> str:
        """
        Transcribe audio (chunking long files), then guarantee English-only output
        via _ensure_english(). See _transcribe_fast_raw() for the transcription flow.
        """
        transcript = self._transcribe_fast_raw(
            audio_path, mime_type, chunk_seconds, max_workers, names_hint
        )
        return self._ensure_english(transcript)

    def _transcribe_fast_raw(self, audio_path: str, mime_type: str = "audio/webm",
                             chunk_seconds: int = 300, max_workers: int = 6,
                             names_hint: Optional[List[str]] = None) -> str:
        """
        Transcribe audio, automatically chunking long files for parallel processing.

        Long sessions (> chunk_seconds):
          Phase 1 — parallel: each chunk transcribed with neutral Speaker N labels
          Phase 2 — single text call: normalize labels, assign Therapist/Patient roles

        Short sessions or ffmpeg unavailable → original single-file path.

        names_hint (optional): names of the patients present, used to label turns
        with real names instead of generic Patient N. See _names_hint().
        """
        # Single-file prompt with optional name hint appended
        single_prompt = TRANSCRIPT_PROMPT + _names_hint(names_hint)

        duration = self._get_duration(audio_path)
        print(f"[gemini] Audio duration: {duration}s")

        # Short sessions or no ffprobe → single-file path (unchanged behaviour)
        if duration is None or duration < chunk_seconds:
            audio_file = self.upload_file(audio_path, mime_type)
            try:
                return self.transcribe(audio_file, mime_type, prompt=single_prompt)
            finally:
                self.delete_file(audio_file)

        # Long session → split and transcribe in parallel
        try:
            tmp_dir, chunks = self._split_into_chunks(audio_path, chunk_seconds)
        except RuntimeError as e:
            print(f"[gemini] Chunking failed ({e}), falling back to single-file")
            audio_file = self.upload_file(audio_path, mime_type)
            try:
                return self.transcribe(audio_file, mime_type, prompt=single_prompt)
            finally:
                self.delete_file(audio_file)

        try:
            results: List[Optional[str]] = [None] * len(chunks)
            workers = min(max_workers, len(chunks))
            print(f"[gemini] Transcribing {len(chunks)} chunks with {workers} workers")

            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(self._transcribe_chunk_neutral, path, i, len(chunks), mime_type): i
                    for i, path in enumerate(chunks)
                }
                for future in as_completed(futures):
                    idx, text = future.result()
                    results[idx] = text

            # Phase 2: unify speaker labels across all chunks in one text-only call
            return self.normalize_transcript([t for t in results if t], names_hint=names_hint)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

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
