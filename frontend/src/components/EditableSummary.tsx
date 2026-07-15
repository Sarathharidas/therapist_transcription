import { useMemo, useState } from 'react';
import { Check, Loader2, Pencil } from 'lucide-react';
import { saveSummary } from '../api/sessions';
import { joinSummary, renderSummary, splitSummary } from '../lib/summary';

type Props = {
  summaryId: string;
  summary: string;
  onSaved: (full: string) => void;
};

/**
 * Renders the AI case-sheet summary with a per-section Edit button. The
 * therapist edits one section's Markdown at a time; on save the full summary is
 * reassembled and persisted (encrypted at rest) via saveSummary(). Falls back to
 * a single editable block for summaries with no "## " headings (e.g. legacy).
 */
export function EditableSummary({ summaryId, summary, onSaved }: Props) {
  const { preamble, sections } = useMemo(() => splitSummary(summary), [summary]);
  const hasHeadings = sections.length > 0;
  const blocks = hasHeadings ? sections : [summary];

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);

  const startEdit = (i: number) => {
    setEditing(i);
    setDraft(blocks[i]);
    setError(null);
  };

  const save = async (i: number) => {
    setSaving(true);
    setError(null);
    const next = [...blocks];
    next[i] = draft;
    const full = hasHeadings ? joinSummary(preamble, next) : draft.trim();
    try {
      await saveSummary(summaryId, full);
      onSaved(full);
      setEditing(null);
      setSavedIdx(i);
      setTimeout(() => setSavedIdx(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save section.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-sm leading-relaxed text-foreground/90">
      {hasHeadings && preamble && (
        <div className="mb-4" dangerouslySetInnerHTML={{ __html: renderSummary(preamble) }} />
      )}

      {blocks.map((block, i) => (
        <section key={i} className="mb-2">
          {editing === i ? (
            <div className="rounded-lg border border-accent/40 bg-card p-3 my-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full min-h-[160px] bg-background border border-border rounded-md p-3 text-[13px] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-accent/40"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              {error && <p className="mt-2 text-xs text-red-600">⚠️ {error}</p>}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => { setEditing(null); setError(null); }}
                  className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => save(i)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground text-xs font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="relative rounded-lg -mx-2 px-2 pt-1 pb-1 hover:bg-secondary/20 transition-colors">
              <button
                onClick={() => startEdit(i)}
                title="Edit this section"
                className="absolute top-1.5 right-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground bg-card/80 border border-border rounded px-1.5 py-0.5 transition-colors"
              >
                {savedIdx === i ? (
                  <><Check className="size-3 text-green-600" /> Saved</>
                ) : (
                  <><Pencil className="size-3" /> Edit</>
                )}
              </button>
              <div dangerouslySetInnerHTML={{ __html: renderSummary(block) }} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
