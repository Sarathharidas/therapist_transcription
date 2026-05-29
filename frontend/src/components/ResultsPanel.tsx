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
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function renderSummary(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Wrap each paragraph in a <p> tag
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
    // On mobile: single column, scrollable. On large screens: two columns, each scrollable.
    <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">

      {/* ── Transcript ── */}
      <section className="lg:flex-[1.2] lg:overflow-y-auto p-6 sm:p-10 lg:p-12 bg-card border-b lg:border-b-0 lg:border-r border-border animate-fade-in">
        <div className="max-w-[65ch] mx-auto">
          <div className="mb-8 lg:mb-10 flex items-start justify-between">
            <div>
              <span
                className="text-[11px] tracking-widest text-muted-foreground uppercase"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Full Transcript
              </span>
              <h2 className="text-3xl lg:text-4xl mt-3" style={{ fontFamily: 'var(--font-serif)' }}>
                {patientName}
              </h2>
              <p
                className="text-muted-foreground mt-2 text-xs"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {dateLabel
                  ? dateLabel
                  : durationSeconds !== undefined
                  ? `Recorded today · ${formatDuration(durationSeconds)}`
                  : 'Past session'}
              </p>
            </div>
            <CopyButton text={result.transcript} />
          </div>

          <div
            className="text-[15px] leading-relaxed whitespace-pre-wrap text-foreground/90"
            dangerouslySetInnerHTML={{ __html: renderTranscript(result.transcript) }}
          />
        </div>
      </section>

      {/* ── Summary + Notes ── */}
      <section
        className="lg:flex-1 bg-background lg:overflow-y-auto p-6 sm:p-10 lg:p-12 animate-fade-in"
        style={{ animationDelay: '200ms' }}
      >
        <div className="max-w-md mx-auto lg:mx-0">
          {/* AI badge */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 bg-accent/10 px-3 py-1 rounded-full mb-4">
              <div className="size-1.5 bg-accent rounded-full" />
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
                AI Synthesis
              </span>
            </div>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Session Summary</h3>
              <CopyButton text={result.summary} />
            </div>
          </div>

          {/* Summary */}
          <div
            className="text-sm leading-relaxed text-foreground/90 mb-10"
            dangerouslySetInnerHTML={{ __html: renderSummary(result.summary) }}
          />

          {/* Clinician notes */}
          <div className="p-6 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4
                className="text-[11px] text-muted-foreground uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Clinician Notes
              </h4>
              <span
                className="text-[10px] text-muted-foreground"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Private
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write your observations, reflections, or next steps…"
              className="w-full min-h-[140px] bg-background border border-border rounded-lg p-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder:text-muted-foreground/60"
            />
            {saveError && (
              <p className="mt-2 text-xs text-red-600">⚠️ {saveError}</p>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full mt-3 py-2 bg-secondary hover:bg-secondary/70 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
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
      </section>
    </div>
  );
}
