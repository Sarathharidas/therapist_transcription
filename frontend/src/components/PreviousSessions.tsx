import { ChevronRight, History } from 'lucide-react';
import type { PatientHistory } from '../api/patients';

type Props = {
  history: PatientHistory;
  onOpen: (summaryId: string) => void;
  // Hide this session from the list (e.g. the one currently open).
  excludeSummaryId?: string;
  showHeader?: boolean;
};

/**
 * A patient's previous sessions — the precomputed history overview plus clickable
 * links to every past summary. Shared by the recording screen (SessionView) and
 * the reopened-note view (ResultsPanel).
 */
export function PreviousSessions({ history, onOpen, excludeSummaryId, showHeader = true }: Props) {
  const sessions = history.sessions.filter((s) => s.summaryId !== excludeSummaryId);
  if (!history.overview && sessions.length === 0) return null;

  return (
    <div>
      {showHeader && (
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
          <History className="size-3" /> Previous sessions
        </p>
      )}

      {history.overview && (
        <div className="p-4 bg-accent/5 border border-accent/20 rounded-xl mb-5">
          <p className="text-[11px] uppercase tracking-widest text-accent mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
            History overview
          </p>
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{history.overview}</p>
        </div>
      )}

      <div className="space-y-2">
        {sessions.map((s) => (
          <button
            key={s.summaryId}
            onClick={() => onOpen(s.summaryId)}
            className="w-full text-left flex items-center justify-between gap-3 p-3 bg-card border border-border rounded-xl hover:bg-secondary/40 transition-colors"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>{s.date}</div>
              <div className="text-sm truncate text-foreground/90">{s.snippet || 'Session summary'}</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
