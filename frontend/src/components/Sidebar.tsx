import { Lock } from 'lucide-react';
import type { PastSession, Patient } from '../types';

const PAST_SESSIONS: PastSession[] = [
  { id: 's1', patientName: 'Julianna Sterling', date: '14 MAR 2025', noteSnippet: 'Generalised anxiety follow-up…' },
  { id: 's2', patientName: 'Marcus Thorne',     date: '12 MAR 2025', noteSnippet: 'Initial intake: Sleep hygiene…' },
  { id: 's3', patientName: 'Elena Rossi',        date: '11 MAR 2025', noteSnippet: 'CBT Session 4: Reframing…' },
  { id: 's4', patientName: 'David Park',         date: '08 MAR 2025', noteSnippet: 'Grief processing — week 3…' },
  { id: 's5', patientName: 'Arthur Pemberton',   date: '05 MAR 2025', noteSnippet: 'Workplace transition anxiety…' },
];

type Props = {
  selectedPatient: Patient | null;
  onNewSession: () => void;
};

export function Sidebar({ selectedPatient, onNewSession }: Props) {
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
          Authenticated / Dr. Aris
        </p>
      </div>

      {/* Recent notes */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-4">
          Recent Notes
        </div>
        {PAST_SESSIONS.map((s) => (
          <button
            key={s.id}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              selectedPatient?.name === s.patientName
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
