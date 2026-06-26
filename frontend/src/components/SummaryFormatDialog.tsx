import { useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { getSummaryFormat, saveSummaryFormat } from '../api/settings';

type Props = {
  onClose: () => void;
};

/**
 * Editor for the therapist's summary / case-sheet format. The AI fills this
 * skeleton from each transcript. Loads the current (custom or default) format,
 * lets the therapist edit it, save it, or reset to the built-in default.
 */
export function SummaryFormatDialog({ onClose }: Props) {
  const [text, setText] = useState('');
  const [defaultText, setDefaultText] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSummaryFormat()
      .then((f) => {
        if (!alive) return;
        setText(f.format);
        setDefaultText(f.default);
        setIsDefault(f.isDefault);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load format.');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const f = await saveSummaryFormat(text);
      setText(f.format);
      setIsDefault(f.isDefault);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save format.');
    } finally {
      setSaving(false);
    }
  };

  // Reset just loads the default text into the editor; saving an empty/default
  // value clears the override server-side.
  const handleReset = () => {
    setText(defaultText);
    setSaved(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col p-6 sm:p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 size-8 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="size-4" />
        </button>

        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2"
           style={{ fontFamily: 'var(--font-mono)' }}>
          Summary Format
        </p>
        <h3 className="text-2xl mb-2" style={{ fontFamily: 'var(--font-serif)' }}>
          Edit case-sheet format
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Every session transcript is summarised into this template. Edit the headings and
          fields to fit your notes — the AI fills the <code className="text-xs">____</code> blanks
          from the session and marks anything not discussed.
          {!isDefault && (
            <span className="ml-1 text-accent">Currently using your custom format.</span>
          )}
        </p>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-accent" />
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-[320px] w-full bg-background border border-border rounded-lg p-4 text-[13px] leading-relaxed font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 mt-6">
          <button
            onClick={handleReset}
            disabled={loading || saving}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
            Reset to default
          </button>

          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              disabled={loading || saving}
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-5 py-2 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : saved ? (
                <Check className="size-3.5" />
              ) : null}
              {saved ? 'Saved' : 'Save format'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
