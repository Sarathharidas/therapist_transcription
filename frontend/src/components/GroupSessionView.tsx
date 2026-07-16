import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Lock, Mic, Users, Loader2, AlertCircle, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { useRecorder } from '../hooks/useRecorder';
import { submitSession, pollJobStatus } from '../api/sessions';
import type { Appointment, GroupMember, JobStatus, SegmentType, SessionPhase } from '../types';

type Props = {
  appointment: Appointment;
  onBack: () => void;
  // Called when the clinician finishes the visit — opens the appointment view.
  onFinish: (sessionId: string) => void;
};

// A segment the clinician has recorded during this appointment.
type RecordedSegment = {
  localId: string;
  jobId: string;
  label: string;
  segmentType: SegmentType;
  status: JobStatus['status'];
};

// The configuration currently selected for the next recording.
// 'joint' = everyone; otherwise a participant id for a 1:1.
type Config = { kind: 'joint' } | { kind: 'individual'; participant: GroupMember };

function configLabel(cfg: Config): string {
  return cfg.kind === 'joint' ? 'Joint — everyone' : `${cfg.participant.name} · 1:1`;
}

export function GroupSessionView({ appointment, onBack, onFinish }: Props) {
  const { state: recorderState, blob, start, stop, reset } = useRecorder();
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [config, setConfig] = useState<Config>({ kind: 'joint' });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<RecordedSegment[]>([]);
  const startedAt = useRef<number | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  // Recording timer
  useEffect(() => {
    if (phase !== 'recording') return;
    startedAt.current = Date.now();
    const id = setInterval(() => {
      if (startedAt.current != null) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  // Warn before leaving while the segment exists only in the browser (recording,
  // submitting, or a failed-but-retryable upload).
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'submitting' && phase !== 'failed') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // Poll non-terminal segment jobs so their status surfaces in the list.
  useEffect(() => {
    const pending = segments.filter((s) => s.status !== 'complete' && s.status !== 'failed');
    if (pending.length === 0) return;
    const id = setInterval(async () => {
      const updates = await Promise.all(
        pending.map(async (s) => {
          try {
            const js = await pollJobStatus(s.jobId);
            return { localId: s.localId, status: js.status };
          } catch {
            return null;
          }
        }),
      );
      if (!activeRef.current) return;
      setSegments((prev) =>
        prev.map((s) => {
          const u = updates.find((x) => x && x.localId === s.localId);
          return u ? { ...s, status: u.status } : s;
        }),
      );
    }, 4000);
    return () => clearInterval(id);
  }, [segments]);

  const runSubmit = useCallback(async (audioBlob: Blob, cfg: Config, durationSeconds?: number) => {
    setError(null);
    const participants = cfg.kind === 'joint' ? appointment.participants : [cfg.participant];
    const participantIds = participants.map((p) => p.id);
    const primaryId = participantIds[0];
    try {
      const jobId = await submitSession(audioBlob, primaryId, {
        sessionId: appointment.sessionId,
        segmentType: cfg.kind === 'joint' ? 'joint' : 'individual',
        participantIds,
      }, durationSeconds);
      if (!activeRef.current) return;
      setSegments((prev) => [
        ...prev,
        {
          localId: `${Date.now()}`,
          jobId,
          label: configLabel(cfg),
          segmentType: cfg.kind === 'joint' ? 'joint' : 'individual',
          status: 'transcribing',
        },
      ]);
      setPhase('ready');
      setElapsed(0);
      reset();
    } catch (err) {
      if (!activeRef.current) return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(
        msg === 'quota_exceeded'
          ? 'Gemini API quota exceeded. Please enable billing or wait for daily reset.'
          : msg === 'upload_failed'
          ? 'Upload failed — but this segment is safe. Check your connection and tap Retry.'
          : msg === 'trial_expired'
          ? 'Your free trial has ended — subscribe from “Plans & usage” to keep recording.'
          : msg === 'no_hours'
          ? 'You’re out of hours for this cycle — upgrade or wait for renewal in “Plans & usage”.'
          : msg === 'past_due' || msg === 'cancelled'
          ? 'Your subscription is inactive — reactivate it in “Plans & usage”.'
          : msg,
      );
      // Keep the recorded blob (and the current config) so the segment can be
      // retried instead of lost. The config chips are disabled while busy, so
      // `config` still holds the segment that was recorded.
      setPhase('failed');
    }
  }, [appointment, reset]);

  // Retry the failed segment upload with the same recording + config.
  const handleRetry = useCallback(() => {
    if (!blob) return;
    setPhase('submitting');
    runSubmit(blob, config, elapsed);
  }, [blob, config, runSubmit, elapsed]);

  // Discard the failed segment and return to ready (keeps already-saved segments).
  const handleDiscard = useCallback(() => {
    reset();
    setPhase('ready');
    setElapsed(0);
    setError(null);
  }, [reset]);

  // When recorder stops → submit the segment for background processing
  useEffect(() => {
    if (recorderState === 'stopped' && blob) {
      setPhase('submitting');
      runSubmit(blob, config, elapsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState, blob]);

  const handleStart = async () => {
    setElapsed(0);
    setError(null);
    try {
      await start();
      setPhase('recording');
    } catch {
      setError('Microphone access denied. Please allow mic permissions and reload.');
    }
  };

  const handleStop = () => stop();

  const formatted = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const busy = phase !== 'ready';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-border flex items-center justify-between gap-3 bg-card shrink-0 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
            <Users className="size-3" /> Group Appointment
          </p>
          <h2 className="text-xl sm:text-2xl mt-0.5 truncate" style={{ fontFamily: 'var(--font-serif)' }}>
            {appointment.label}
          </h2>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {!busy && (
            <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
              ← Change
            </button>
          )}
          {!busy && (
            <button
              onClick={() => onFinish(appointment.sessionId)}
              disabled={segments.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Finish appointment
              <ArrowRight className="size-3.5" />
            </button>
          )}
          {phase === 'recording' && (
            <div className="flex items-center gap-2 sm:gap-3 bg-secondary border border-border rounded-xl px-2.5 sm:px-3 py-2">
              <div className="size-2.5 bg-red-500 rounded-full animate-pulse shrink-0" />
              <span className="text-xs font-medium tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>{formatted}</span>
              <button onClick={handleStop} className="ml-1 px-2.5 sm:px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity">
                Stop
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-8 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 sm:py-8">
        <div className="max-w-2xl mx-auto">

          {/* Segment selector */}
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
            Who's in the room for this part?
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            <ConfigChip
              active={config.kind === 'joint'}
              disabled={busy}
              onClick={() => setConfig({ kind: 'joint' })}
              icon={<Users className="size-3.5" />}
              label="Joint — everyone"
            />
            {appointment.participants.map((p) => (
              <ConfigChip
                key={p.id}
                active={config.kind === 'individual' && config.participant.id === p.id}
                disabled={busy}
                onClick={() => setConfig({ kind: 'individual', participant: p })}
                icon={<Lock className="size-3.5" />}
                label={`${p.name} · 1:1`}
              />
            ))}
          </div>

          {/* Record control */}
          <div className="text-center py-6 sm:py-10 border border-border rounded-2xl bg-card">
            <button
              type="button"
              onClick={phase === 'ready' ? handleStart : phase === 'recording' ? handleStop : undefined}
              disabled={phase === 'submitting' || phase === 'failed'}
              className={`group relative mx-auto size-20 sm:size-24 rounded-full flex items-center justify-center mb-5 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 ${
                phase === 'recording' ? 'bg-red-500/10 hover:bg-red-500/20'
                  : phase === 'failed' ? 'bg-amber-500/10'
                  : 'bg-accent/10 hover:bg-accent/20'
              }`}
            >
              {phase === 'recording' && <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />}
              {phase === 'submitting'
                ? <Loader2 className="size-8 animate-spin text-accent relative" />
                : phase === 'failed'
                ? <AlertTriangle className="size-8 sm:size-10 relative text-amber-500" />
                : <Mic className={`size-8 sm:size-10 relative ${phase === 'recording' ? 'text-red-500' : 'text-accent'}`} />}
            </button>
            <h3 className="text-xl sm:text-2xl mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
              {phase === 'recording' ? 'Listening…'
                : phase === 'submitting' ? 'Saving segment…'
                : phase === 'failed' ? "Upload didn't go through"
                : 'Ready when you are'}
            </h3>
            <p className="text-sm text-muted-foreground px-6">
              {phase === 'recording'
                ? `Recording the ${config.kind === 'joint' ? 'joint' : config.participant.name + ' 1:1'} segment privately.`
                : phase === 'failed'
                ? 'This segment is still here — it wasn’t lost. See the message above, then try again.'
                : `Next segment: ${configLabel(config)}. Tap to start.`}
            </p>
            {phase === 'failed' && (
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
                >
                  <RefreshCw className="size-4" />
                  Retry upload
                </button>
                <button
                  onClick={handleDiscard}
                  className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Discard
                </button>
              </div>
            )}
            {config.kind === 'individual' && phase !== 'submitting' && phase !== 'failed' && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                <Lock className="size-3" /> Private to {config.participant.name} — not shared with the others
              </p>
            )}
          </div>

          {/* Recorded segments */}
          {segments.length > 0 && (
            <div className="mt-8">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
                This appointment · {segments.length} segment{segments.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {segments.map((s, i) => (
                  <div key={s.localId} className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl">
                    <div className="size-7 rounded-lg bg-secondary flex items-center justify-center text-xs font-mono shrink-0">{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        {s.segmentType === 'individual' && <Lock className="size-3 text-amber-600" />}
                        {s.label}
                      </div>
                    </div>
                    <SegmentStatus status={s.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigChip({ active, disabled, onClick, icon, label }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 ${
        active
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-card border-border hover:bg-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SegmentStatus({ status }: { status: JobStatus['status'] }) {
  if (status === 'complete') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-green-600 shrink-0"><Check className="size-3.5" /> Done</span>;
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-red-600 shrink-0"><AlertCircle className="size-3.5" /> Failed</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0"><Loader2 className="size-3.5 animate-spin" /> Processing</span>;
}
