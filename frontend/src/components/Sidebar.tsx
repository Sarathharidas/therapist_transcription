import { useEffect, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { listRecentSessions } from '../api/sessions';
import type { Clinician, PastSession, Patient } from '../types';

const SAMPLE_SESSION: PastSession = {
  id: 'sample',
  patientName: 'Sample Patient',
  date: 'SAMPLE',
  noteSnippet: 'Your session notes will appear here after recording…',
};

type Props = {
  clinician: Clinician;
  selectedPatient: Patient | null;
  onNewSession: () => void;
  onSelectSession: (session: PastSession) => void;
  activeSummaryId?: string;
  onClose?: () => void;
  refreshKey?: number;
};

export function Sidebar({ clinician, onNewSession, onSelectSession, activeSummaryId, onClose, refreshKey }: Props) {
  const [sessions, setSessions] = useState<PastSession[]>([]);

  useEffect(() => {
    const load = () => listRecentSessions().then(setSessions).catch(() => setSessions([]));
    load(); // immediate fetch on mount / when a session is submitted
    // Poll periodically so background transcriptions surface here once they finish
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [refreshKey]);

  const displayed = sessions.length > 0 ? sessions : [SAMPLE_SESSION];

  return (
    <aside className="w-72 bg-sidebar border-r border-border flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <button
          onClick={onNewSession}
          className="flex items-center gap-3 hover:opacity-70 transition-opacity"
        >
          <img src="/aura-logo.png" alt="Aura Clinical" className="size-8 rounded-lg object-contain" />
          <span
            className="text-2xl italic"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Aura Clinical
          </span>
        </button>

        {/* Close button — only shown when rendered as mobile drawer */}
        {onClose && (
          <button
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <p
        className="px-6 pt-3 text-[10px] uppercase tracking-widest text-muted-foreground"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {clinician.name}
      </p>

      {/* Recent notes */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1 mt-2">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-4">
          Recent Notes
        </div>
        {displayed.map((s) => (
          <button
            key={s.id}
            disabled={s.id === 'sample'}
            onClick={() => s.id !== 'sample' && onSelectSession(s)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              s.id === 'sample'
                ? 'border-dashed border-border opacity-50 cursor-default'
                : activeSummaryId === s.id
                ? 'bg-card border-border'
                : 'border-transparent hover:bg-card/60'
            }`}
          >
            <div
              className="text-[10px] text-muted-foreground mb-1"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {s.date}
            </div>
            <div className="text-sm font-medium">{s.patientName}</div>
            <div className="text-xs text-muted-foreground truncate">{s.noteSnippet}</div>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-6 border-t border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Lock className="size-3.5" />
          <span>HIPAA Encrypted</span>
        </div>
      </div>
    </aside>
  );
}
