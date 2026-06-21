import { useMemo, useState } from 'react';
import { Lock, Users } from 'lucide-react';
import { ResultsPanel } from './ResultsPanel';
import type { AppointmentDetail, Segment } from '../types';

type Props = {
  appointment: AppointmentDetail;
};

function segmentTitle(s: Segment): string {
  if (s.segmentType === 'joint') return 'Joint';
  if (s.segmentType === 'individual') {
    const name = s.participants[0]?.name ?? 'Individual';
    return `${name} · 1:1`;
  }
  return 'Session';
}

export function AppointmentView({ appointment }: Props) {
  // filter: 'all' shows every segment; a patient id shows that person's view
  // (joint segments + their own 1:1, never a partner's private 1:1).
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    appointment.segments[0]?.summaryId ?? null,
  );

  const visible = useMemo(() => {
    if (filter === 'all') return appointment.segments;
    return appointment.segments.filter(
      (s) =>
        s.segmentType === 'joint' ||
        s.participants.some((p) => p.id === filter),
    );
  }, [appointment.segments, filter]);

  // Keep a valid selection as the filter changes
  const selected =
    visible.find((s) => s.summaryId === selectedId) ?? visible[0] ?? null;

  const chip = (value: string, label: string, icon?: React.ReactNode) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        filter === value
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-card border-border hover:bg-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Appointment header */}
      <div className="px-4 sm:px-8 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
              <Users className="size-3" /> Appointment · {appointment.date}
            </p>
            <h2 className="text-xl sm:text-2xl mt-0.5 truncate" style={{ fontFamily: 'var(--font-serif)' }}>
              {appointment.label}
            </h2>
          </div>
        </div>

        {/* Per-person confidentiality filter */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground mr-1" style={{ fontFamily: 'var(--font-mono)' }}>
            View as
          </span>
          {chip('all', 'Everyone', <Users className="size-3" />)}
          {appointment.participants.map((p) => chip(p.id, p.name, <Lock className="size-3" />))}
        </div>

        {/* Segment tabs */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {visible.map((s) => {
            const isPrivate = s.segmentType === 'individual';
            return (
              <button
                key={s.summaryId}
                onClick={() => setSelectedId(s.summaryId)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  selected?.summaryId === s.summaryId
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-secondary border-border hover:bg-secondary/70'
                }`}
              >
                {isPrivate && <Lock className="size-3 text-amber-500" />}
                {segmentTitle(s)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected segment detail */}
      {selected ? (
        <ResultsPanel
          key={selected.summaryId}
          result={{
            transcript: selected.transcript,
            summary: selected.summary,
            patient_id: selected.participants[0]?.id ?? '',
            summary_id: selected.summaryId,
          }}
          patientName={
            selected.segmentType === 'individual'
              ? `${selected.participants[0]?.name ?? ''} · 1:1`
              : `${appointment.label} · Joint`
          }
          initialNotes={selected.clinicianNotes ?? ''}
          dateLabel={selected.date}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No segments to show for this view.
        </div>
      )}
    </div>
  );
}
