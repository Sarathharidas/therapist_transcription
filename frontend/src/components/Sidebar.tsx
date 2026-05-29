import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
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
};

export function Sidebar({ clinician, selectedPatient, onNewSession }: Props) {
  const [sessions, setSessions] = useState<PastSession[]>([]);

  useEffect(() => {
    listRecentSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const displayed = sessions.length > 0 ? sessions : [SAMPLE_SESSION];

  return (
    <aside className="w-72 bg-sidebar border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <button
          onClick={onNewSession}
          className="text-2xl italic block text-left hover:opacity-70 transition-opacity"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Aura Clinical
        </button>
        <p
          className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {clinician.name}
        </p>
      </div>

      {/* Recent notes */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-4">
          Recent Notes
        </div>
        {displayed.map((s) => (
          <button
            key={s.id}
            disabled={s.id === 'sample'}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              s.id === 'sample'
                ? 'border-dashed border-border opacity-50 cursor-default'
                : selectedPatient?.name === s.patientName
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
