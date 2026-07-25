// Parse / serialize the case-sheet format Markdown for the structured editor.
// Each section is an ORDERED list of blocks (field | text) so sub-headings,
// option-lists, and guidance stay inline where they belong — lossless round-trip.

export type FieldBlock = { id: string; type: 'field'; label: string; hint: string };
export type TextBlock = { id: string; type: 'text'; text: string };
export type Block = FieldBlock | TextBlock;
export type Section = { id: string; heading: string; blocks: Block[] };
export type ParsedFormat = { preamble: string; sections: Section[] };

let _id = 0;
const uid = () => `b${_id++}`;

// "- **Label:** hint"  (hint optional; tolerates "* " bullets).
const FIELD_RE = /^\s*[-*]\s+\*\*(.+?):\*\*\s?(.*)$/;

export function parseFormat(md: string): ParsedFormat {
  const lines = (md || '').split('\n');
  const preamble: string[] = [];
  const sections: Section[] = [];
  let cur: Section | null = null;
  let textBuf: string[] = [];

  const flushText = () => {
    if (!cur) return;
    // drop leading/trailing blank lines but keep internal structure
    while (textBuf.length && !textBuf[0].trim()) textBuf.shift();
    while (textBuf.length && !textBuf[textBuf.length - 1].trim()) textBuf.pop();
    if (textBuf.length) cur.blocks.push({ id: uid(), type: 'text', text: textBuf.join('\n') });
    textBuf = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flushText();
      cur = { id: uid(), heading: h2[1].trim(), blocks: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      preamble.push(line);
      continue;
    }
    const f = line.match(FIELD_RE);
    if (f) {
      flushText();
      cur.blocks.push({ id: uid(), type: 'field', label: f[1].trim(), hint: f[2].trim() });
    } else {
      textBuf.push(line);
    }
  }
  flushText();

  return { preamble: preamble.join('\n').replace(/\s+$/, ''), sections };
}

export function serializeFormat(parsed: ParsedFormat): string {
  const parts: string[] = [];
  const pre = parsed.preamble.trim();
  if (pre) parts.push(pre);

  for (const s of parsed.sections) {
    const block: string[] = [`## ${s.heading.trim()}`];
    for (const b of s.blocks) {
      if (b.type === 'field') {
        const label = b.label.trim();
        if (!label) continue;
        block.push(`- **${label}:** ${b.hint.trim()}`.replace(/\s+$/, ''));
      } else {
        const t = b.text.replace(/\s+$/, '');
        if (t.trim()) block.push(t);
      }
    }
    parts.push(block.join('\n'));
  }

  return parts.join('\n\n') + '\n';
}

export const newField = (): FieldBlock => ({ id: uid(), type: 'field', label: '', hint: '____' });
export const newText = (): TextBlock => ({ id: uid(), type: 'text', text: '' });
export const newSection = (): Section => ({ id: uid(), heading: 'New section', blocks: [newField()] });
