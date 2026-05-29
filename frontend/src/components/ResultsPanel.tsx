import { useState } from 'react';
import { Copy, Check, Loader2 } from 'lucide-react';
import { saveNotes } from '../api/sessions';
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

function renderSummary(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text)
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p class="mb-4 last:mb-0">${p.replace(/\n/g, ' ').trim()}</p>`)
    .join('');
}

function renderTranscript(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text)
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

export function ResultsPanel({ result, durationSeconds, patientName, initialNotes = '', dateLabel }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  return (
    /**
     * Root: splits the available space.
     *
     * Mobile  (flex-col) — three stacked rows, each with a pinned header + independent scroll body.
     * Desktop (lg:flex-row) — left = Transcript column, right = Summary + Notes column.
     *
     * The `min-h-0` on every flex child is required: without it, flex items default to
     * `min-height: auto` and expand to fit content, breaking overflow-y-auto.
     */
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

      {/* ════════════════════════════════
          LEFT / TOP — TRANSCRIPT
          ════════════════════════════════ */}
      <section className="flex-1 min-h-0 lg:flex-[1.2] flex flex-col bg-card border-b lg:border-b-0 lg:border-r border-border animate-fade-in">

        {/* Pinned section header */}
        <div className="shrink-0 px-5 sm:px-8 lg:px-12 pt-5 sm:pt-8 lg:pt-10 pb-4 border-b border-border/50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span
                className="text-[11px] tracking-widest text-muted-foreground uppercase"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Full Transcript
              </span>
              <h2 className="text-xl sm:text-2xl lg:text-4xl mt-1 lg:mt-3" style={{ fontFamily: 'var(--font-serif)' }}>
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
        </div>

        {/* Independently scrollable transcript body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 lg:px-12 py-4 lg:py-8">
          <div
            className="max-w-[65ch] lg:mx-auto text-[15px] leading-relaxed whitespace-pre-wrap text-foreground/90"
            dangerouslySetInnerHTML={{ __html: renderTranscript(result.transcript) }}
          />
        </div>

      </section>

      {/* ════════════════════════════════
          RIGHT / BOTTOM — SUMMARY + NOTES
          This column itself is flex-col so that:
            • Summary header is pinned
            • Summary text scrolls independently
            • Clinician Notes card is always pinned at the bottom
          ════════════════════════════════ */}
      <div
        className="flex-1 min-h-0 flex flex-col bg-background animate-fade-in"
        style={{ animationDelay: '150ms' }}
      >

        {/* ── SESSION SUMMARY ── */}
        <div className="flex-1 min-h-0 flex flex-col border-b border-border">

          {/* Pinned summary header */}
          <div className="shrink-0 px-5 sm:px-8 lg:px-12 pt-5 sm:pt-8 lg:pt-10 pb-4 border-b border-border/50">
            <div className="inline-flex items-center gap-2 bg-accent/10 px-3 py-1 rounded-full mb-3">
              <div className="size-1.5 bg-accent rounded-full" />
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
                AI Synthesis
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base sm:text-lg font-semibold">Session Summary</h3>
              <CopyButton text={result.summary} />
            </div>
          </div>

          {/* Independently scrollable summary text */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 lg:px-12 py-4">
            <div
              className="text-sm leading-relaxed text-foreground/90"
              dangerouslySetInnerHTML={{ __html: renderSummary(result.summary) }}
            />
          </div>

        </div>

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
              <span className="text-[10px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                Private
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write your observations, reflections, or next steps…"
              className="w-full min-h-[72px] lg:min-h-[120px] bg-background border border-border rounded-lg p-3 text-sm leading-relaxed resize-none lg:resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder:text-muted-foreground/60"
            />
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
