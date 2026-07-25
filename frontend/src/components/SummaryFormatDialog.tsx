import { useEffect, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, Code, GripVertical, Loader2,
  Plus, RotateCcw, Trash2, X,
} from 'lucide-react';
import { getSummaryFormat, saveSummaryFormat } from '../api/settings';
import {
  parseFormat, serializeFormat, newField, newText, newSection,
  type ParsedFormat, type Section, type Block,
} from '../lib/formatEditor';

type Props = { onClose: () => void };

/**
 * Structured editor for the therapist's case-sheet format. Each ## section is a
 * card of ordered blocks (labelled fields + free-text lines). An "Advanced"
 * toggle exposes the raw Markdown for power edits. Stored as the same Markdown
 * string as before (via saveSummaryFormat).
 */
export function SummaryFormatDialog({ onClose }: Props) {
  const [parsed, setParsed] = useState<ParsedFormat>({ preamble: '', sections: [] });
  const [defaultMd, setDefaultMd] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [mode, setMode] = useState<'structured' | 'advanced'>('structured');
  const [raw, setRaw] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSummaryFormat()
      .then((f) => {
        if (!alive) return;
        const p = parseFormat(f.format);
        setParsed(p);
        setDefaultMd(f.default);
        setIsDefault(f.isDefault);
        setOpenId(p.sections[0]?.id ?? null);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Failed to load format.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // Keep the two modes in sync when toggling.
  const toAdvanced = () => { setRaw(serializeFormat(parsed)); setMode('advanced'); };
  const toStructured = () => { setParsed(parseFormat(raw)); setMode('structured'); };

  const currentMarkdown = () => (mode === 'advanced' ? raw : serializeFormat(parsed));

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const f = await saveSummaryFormat(currentMarkdown());
      const p = parseFormat(f.format);
      setParsed(p);
      if (mode === 'advanced') setRaw(f.format);
      setIsDefault(f.isDefault);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save format.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const p = parseFormat(defaultMd);
    setParsed(p);
    setRaw(defaultMd);
    setOpenId(p.sections[0]?.id ?? null);
    setSaved(false);
  };

  // ── Section/block mutators (immutable by id) ──
  const updateSection = (id: string, patch: Partial<Section>) =>
    setParsed((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const updateBlock = (sid: string, bid: string, patch: Partial<Block>) =>
    updateSectionBlocks(sid, (bs) => bs.map((b) => (b.id === bid ? ({ ...b, ...patch } as Block) : b)));

  const updateSectionBlocks = (sid: string, fn: (bs: Block[]) => Block[]) =>
    setParsed((p) => ({ ...p, sections: p.sections.map((s) => (s.id === sid ? { ...s, blocks: fn(s.blocks) } : s)) }));

  const removeBlock = (sid: string, bid: string) =>
    updateSectionBlocks(sid, (bs) => bs.filter((b) => b.id !== bid));

  const moveBlock = (sid: string, bid: string, dir: -1 | 1) =>
    updateSectionBlocks(sid, (bs) => {
      const i = bs.findIndex((b) => b.id === bid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const copy = [...bs]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
    });

  const moveSection = (id: string, dir: -1 | 1) =>
    setParsed((p) => {
      const i = p.sections.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.sections.length) return p;
      const secs = [...p.sections]; [secs[i], secs[j]] = [secs[j], secs[i]]; return { ...p, sections: secs };
    });

  const removeSection = (id: string) =>
    setParsed((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) }));

  const addSection = () => {
    const s = newSection();
    setParsed((p) => ({ ...p, sections: [...p.sections, s] }));
    setOpenId(s.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col p-6 sm:p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 size-8 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground">
          <X className="size-4" />
        </button>

        <div className="flex items-start justify-between gap-4 mb-1 pr-8">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1" style={{ fontFamily: 'var(--font-mono)' }}>Summary Format</p>
            <h3 className="text-2xl" style={{ fontFamily: 'var(--font-serif)' }}>Edit case-sheet format</h3>
          </div>
          <button
            onClick={mode === 'structured' ? toAdvanced : toStructured}
            className="mt-1 shrink-0 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Code className="size-3.5" />
            {mode === 'structured' ? 'Advanced' : 'Simple editor'}
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Sections and fields the AI fills from each session. {isDefault
            ? 'You’re using the default format.'
            : <span className="text-accent">Using your custom format.</span>}
        </p>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16"><Loader2 className="size-5 animate-spin text-accent" /></div>
        ) : mode === 'advanced' ? (
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-[340px] w-full bg-background border border-border rounded-lg p-4 text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-accent/40"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-2">
            {parsed.sections.map((s, si) => (
              <SectionCard
                key={s.id}
                section={s}
                open={openId === s.id}
                isFirst={si === 0}
                isLast={si === parsed.sections.length - 1}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                onHeading={(h) => updateSection(s.id, { heading: h })}
                onBlock={(bid, patch) => updateBlock(s.id, bid, patch)}
                onRemoveBlock={(bid) => removeBlock(s.id, bid)}
                onMoveBlock={(bid, d) => moveBlock(s.id, bid, d)}
                onAddField={() => updateSectionBlocks(s.id, (bs) => [...bs, newField()])}
                onAddText={() => updateSectionBlocks(s.id, (bs) => [...bs, newText()])}
                onMoveSection={(d) => moveSection(s.id, d)}
                onRemoveSection={() => removeSection(s.id)}
              />
            ))}
            <button onClick={addSection} className="w-full mt-1 py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors inline-flex items-center justify-center gap-2">
              <Plus className="size-4" /> Add section
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ {error}</p>}

        <div className="flex items-center justify-between gap-3 mt-5">
          <button onClick={handleReset} disabled={loading || saving} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            <RotateCcw className="size-3.5" /> Reset to default
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button disabled={loading || saving} onClick={handleSave} className="inline-flex items-center gap-2 px-5 py-2 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
              {saved ? 'Saved' : 'Save format'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  section, open, isFirst, isLast, onToggle, onHeading, onBlock, onRemoveBlock,
  onMoveBlock, onAddField, onAddText, onMoveSection, onRemoveSection,
}: {
  section: Section; open: boolean; isFirst: boolean; isLast: boolean;
  onToggle: () => void; onHeading: (h: string) => void;
  onBlock: (bid: string, patch: Partial<Block>) => void;
  onRemoveBlock: (bid: string) => void; onMoveBlock: (bid: string, d: -1 | 1) => void;
  onAddField: () => void; onAddText: () => void;
  onMoveSection: (d: -1 | 1) => void; onRemoveSection: () => void;
}) {
  const fieldCount = section.blocks.filter((b) => b.type === 'field').length;
  return (
    <div className="border border-border rounded-xl bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onToggle} className="text-muted-foreground shrink-0">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <input
          value={section.heading}
          onChange={(e) => onHeading(e.target.value)}
          placeholder="Section title"
          className="flex-1 bg-transparent text-sm font-semibold focus:outline-none"
        />
        {!open && <span className="text-[11px] text-muted-foreground shrink-0">{fieldCount} field{fieldCount === 1 ? '' : 's'}</span>}
        <div className="flex items-center gap-0.5 shrink-0 text-muted-foreground">
          <button onClick={() => onMoveSection(-1)} disabled={isFirst} className="p-1 hover:text-foreground disabled:opacity-30" title="Move up">▲</button>
          <button onClick={() => onMoveSection(1)} disabled={isLast} className="p-1 hover:text-foreground disabled:opacity-30" title="Move down">▼</button>
          <button onClick={onRemoveSection} className="p-1 hover:text-red-600" title="Delete section"><Trash2 className="size-3.5" /></button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {section.blocks.map((b) => (
            <div key={b.id} className="group flex items-start gap-1.5">
              <GripVertical className="size-3.5 text-muted-foreground/40 mt-2 shrink-0" />
              {b.type === 'field' ? (
                <>
                  <input
                    value={b.label}
                    onChange={(e) => onBlock(b.id, { label: e.target.value })}
                    placeholder="Field label"
                    className="flex-1 min-w-0 bg-card border border-border rounded-md px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <input
                    value={b.hint}
                    onChange={(e) => onBlock(b.id, { hint: e.target.value })}
                    placeholder="____"
                    className="w-24 sm:w-32 shrink-0 bg-card border border-border rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                </>
              ) : (
                <textarea
                  value={b.text}
                  onChange={(e) => onBlock(b.id, { text: e.target.value })}
                  rows={Math.min(6, b.text.split('\n').length)}
                  placeholder="Sub-heading, guidance, or option list…"
                  className="flex-1 min-w-0 bg-secondary/40 border border-border rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-accent/40"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              )}
              <div className="flex flex-col shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onMoveBlock(b.id, -1)} className="text-[10px] hover:text-foreground leading-none">▲</button>
                <button onClick={() => onMoveBlock(b.id, 1)} className="text-[10px] hover:text-foreground leading-none">▼</button>
              </div>
              <button onClick={() => onRemoveBlock(b.id)} className="p-1 text-muted-foreground hover:text-red-600 shrink-0" title="Remove">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1 pl-5">
            <button onClick={onAddField} className="inline-flex items-center gap-1 text-xs text-accent hover:opacity-80"><Plus className="size-3.5" /> Field</button>
            <button onClick={onAddText} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /> Text / note</button>
          </div>
        </div>
      )}
    </div>
  );
}
