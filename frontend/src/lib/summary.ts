// Rendering + section-splitting for the AI case-sheet summary (Markdown).
// Shared by ResultsPanel (display) and EditableSummary (per-section editing).

// Lightweight Markdown → HTML for the summary: ## / ### headings, **bold**,
// - bullet lists. "Not discussed" is dimmed so filled fields stand out.
export function renderSummary(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
      .replace(/Not discussed/g, '<span class="text-muted-foreground/60 italic">Not discussed</span>');

  const lines = text.split('\n');
  const html: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      closeList();
      const cls =
        h[1].length === 2
          ? 'text-sm font-semibold text-foreground mt-5 mb-2 first:mt-0 pb-1 border-b border-border/50'
          : 'text-[13px] font-semibold text-foreground mt-3 mb-1';
      html.push(`<h4 class="${cls}">${inline(h[2])}</h4>`);
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push('<ul class="space-y-1 mb-3">');
        inList = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p class="mb-3 last:mb-0">${inline(line)}</p>`);
  }
  closeList();
  return html.join('');
}

// Split the summary into a preamble (anything before the first "## " heading —
// e.g. the "# OP CASE SHEET" title) and the list of top-level (##) sections.
// Each section string starts with its "## Heading" line.
export function splitSummary(md: string): { preamble: string; sections: string[] } {
  const lines = md.split('\n');
  const preamble: string[] = [];
  const sections: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      // Start of a new top-level (H2) section — "### " does not match (no space after ##).
      if (current) sections.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current.join('\n').trimEnd());
  return { preamble: preamble.join('\n').trim(), sections };
}

// Reassemble a full summary from an (optional) preamble + edited sections.
export function joinSummary(preamble: string, sections: string[]): string {
  return [preamble.trim(), ...sections.map((s) => s.trim())].filter(Boolean).join('\n\n');
}
