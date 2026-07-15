import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Loader2, Mic, Square } from 'lucide-react';
import { saveNotes, transcribeNote } from '../api/sessions';
import { useRecorder } from '../hooks/useRecorder';
import { EditableSummary } from './EditableSummary';
import type { SessionResult } from '../types';

type Props = {
  result: SessionResult;
  durationSeconds?: number;
  patientName: string;
  initialNotes?: string;
  dateLabel?: string;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function stripTimestamps(text: string): string {
  // Remove common Gemini timestamp formats: [00:01:23], [0:00], (00:01:23), (0:00)
  return text.replace(/[\[(]\d{1,2}:\d{2}(?::\d{2})?\s*[\])][\s]*/g, '');
}

function renderTranscript(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(stripTimestamps(text))
    .replace(/^(Therapist:)/gm, '<span class="font-medium text-violet-600">Therapist:</span>')
    .replace(/^(Patient \d+:)/gm, '<span class="font-medium text-teal-600">$1</span>')
    .replace(/^(Patient:)/gm, '<span class="font-medium text-sky-600">Patient:</span>')
    .replace(/^(Unknown:)/gm, '<span class="text-muted-foreground">Unknown:</span>');
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

// Which section is currently expanded to fill the space
type Focus = 'both' | 'transcript' | 'summary';

export function ResultsPanel({ result, durationSeconds, patientName, initialNotes = '', dateLabel }: Props) {
  const [summary, setSummary] = useState(result.summary);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('both');

  // Voice-note dictation → transcribed English text appended to the notes box.
  const { state: recState, blob: recBlob, start: startRec, stop: stopRec, reset: resetRec } = useRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // When the dictation recorder stops → transcribe and append to the notes.
  useEffect(() => {
    if (recState !== 'stopped' || !recBlob) return;
    let alive = true;
    (async () => {
      setTranscribing(true);
      setNoteError(null);
      try {
        const text = (await transcribeNote(recBlob)).trim();
        if (alive && text) {
          setNotes((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
        }
      } catch (err) {
        if (alive) setNoteError(err instanceof Error ? err.message : 'Could not transcribe the note.');
      } finally {
        if (alive) setTranscribing(false);
        resetRec();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState, recBlob]);

  const handleMic = async () => {
    if (recState === 'recording') { stopRec(); return; }
    setNoteError(null);
    try {
      await startRec();
    } catch {
      setNoteError('Microphone access denied. Please allow mic permissions.');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await saveNotes(result.summary_id, notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save notes.');
    } finally {
      setSaving(false);
    }
  };

  // Click transcript header → focus transcript (collapses summary)
  const onTranscriptHeaderClick = () =>
    setFocus((f) => (f === 'transcript' ? 'both' : 'transcript'));

  // Click summary header → focus summary (collapses transcript)
  const onSummaryHeaderClick = () =>
    setFocus((f) => (f === 'summary' ? 'both' : 'summary'));

  const transcriptVisible = focus !== 'summary';
  const summaryVisible = focus !== 'transcript';

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

      {/* ══════════════════════════════
          TRANSCRIPT
          ══════════════════════════════ */}
      {transcriptVisible && (
        <section className="flex-1 min-h-0 lg:flex-[1.2] flex flex-col bg-card border-b lg:border-b-0 lg:border-r border-border animate-fade-in">

          {/* Pinned, clickable header */}
          <button
            onClick={onTranscriptHeaderClick}
            className="shrink-0 w-full text-left px-5 sm:px-8 lg:px-12 pt-5 sm:pt-8 lg:pt-10 pb-4 border-b border-border/50 hover:bg-secondary/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] tracking-widest text-muted-foreground uppercase"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    Full Transcript
                  </span>
                  {/* Chevron — shows collapse direction */}
                  {focus === 'transcript'
                    ? <ChevronRight className="size-3.5 text-muted-foreground" />
                    : <ChevronDown className="size-3.5 text-muted-foreground" />}
                </div>
                <h2 className="text-xl sm:text-2xl lg:text-4xl mt-1 lg:mt-3 truncate" style={{ fontFamily: 'var(--font-serif)' }}>
                  {patientName}
                </h2>
                <p className="text-muted-foreground mt-1 text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
                  {dateLabel
                    ? dateLabel
                    : durationSeconds !== undefined
                    ? `Recorded today · ${formatDuration(durationSeconds)}`
                    : 'Past session'}
                </p>
              </div>
              <CopyButton text={result.transcript} />
            </div>
          </button>

          {/* Independently scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 lg:px-12 py-4 lg:py-8">
            <div
              className="max-w-[65ch] lg:mx-auto text-[15px] leading-relaxed whitespace-pre-wrap text-foreground/90"
              dangerouslySetInnerHTML={{ __html: renderTranscript(result.transcript) }}
            />
          </div>

        </section>
      )}

      {/* ══════════════════════════════
          RIGHT COLUMN — SUMMARY + NOTES
          ══════════════════════════════ */}
      <div
        className="flex-1 min-h-0 flex flex-col bg-background animate-fade-in"
        style={{ animationDelay: '150ms' }}
      >

        {/* ── SESSION SUMMARY ── */}
        {summaryVisible && (
          <div className="flex-1 min-h-0 flex flex-col border-b border-border">

            {/* Pinned, clickable header */}
            <button
              onClick={onSummaryHeaderClick}
              className="shrink-0 w-full text-left px-5 sm:px-8 lg:px-12 pt-5 sm:pt-8 lg:pt-10 pb-4 border-b border-border/50 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-semibold">Session Summary</h3>
                  {focus === 'summary'
                    ? <ChevronRight className="size-3.5 text-muted-foreground" />
                    : <ChevronDown className="size-3.5 text-muted-foreground" />}
                </div>
                <CopyButton text={summary} />
              </div>
            </button>

            {/* Independently scrollable summary — each section individually editable */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 lg:px-12 py-4">
              <EditableSummary
                summaryId={result.summary_id}
                summary={summary}
                onSaved={setSummary}
              />
            </div>

          </div>
        )}

        {/* ── CLINICIAN NOTES — always pinned at bottom ── */}
        <div className="shrink-0 px-5 sm:px-8 lg:px-12 py-4 sm:py-5 lg:py-8">
          <div className="p-4 sm:p-5 lg:p-6 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4
                className="text-[11px] text-muted-foreground uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Clinician Notes
              </h4>
              <div className="flex items-center gap-3">
                {/* Dictate a voice note → transcribed + appended (audio not stored) */}
                <button
                  onClick={handleMic}
                  disabled={transcribing}
                  title="Dictate a note (audio isn't stored)"
                  className={`inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                    recState === 'recording' ? 'text-red-600' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {transcribing ? (
                    <><Loader2 className="size-3.5 animate-spin" /> Transcribing…</>
                  ) : recState === 'recording' ? (
                    <><Square className="size-3 fill-current" /> Stop</>
                  ) : (
                    <><Mic className="size-3.5" /> Dictate</>
                  )}
                </button>
                <span className="text-[10px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                  Private
                </span>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write your observations, reflections, or next steps…"
              className="w-full min-h-[72px] lg:min-h-[120px] bg-background border border-border rounded-lg p-3 text-sm leading-relaxed resize-none lg:resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder:text-muted-foreground/60"
            />
            {noteError && (
              <p className="mt-2 text-xs text-red-600">⚠️ {noteError}</p>
            )}
            {saveError && (
              <p className="mt-2 text-xs text-red-600">⚠️ {saveError}</p>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full mt-2 lg:mt-3 py-2 bg-secondary hover:bg-secondary/70 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {saving ? (
                <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
              ) : saved ? (
                <><Check className="size-3.5 text-green-600" /> Saved</>
              ) : (
                'Save Notes'
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
