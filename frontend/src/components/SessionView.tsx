import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useRecorder } from '../hooks/useRecorder';
import { submitSession } from '../api/sessions';
import type { Patient, SessionPhase } from '../types';

type Props = {
  patient: Patient;
  onBack: () => void;
  // Called once the audio has been submitted and the backend job is running.
  // The parent navigates back to patient-select and shows a "processing" notice.
  onProcessingStarted: () => void;
};

export function SessionView({ patient, onBack, onProcessingStarted }: Props) {
  const { state: recorderState, blob, start, stop, reset } = useRecorder();
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);
  // Used to avoid acting after the component unmounts mid-submit
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

  const runSubmit = useCallback(async (audioBlob: Blob) => {
    setError(null);
    try {
      // POST audio — returns in < 1s with a job_id; the backend processes
      // the transcription as a true background job from here on.
      const jobId = await submitSession(audioBlob, patient.id);
      console.log(`[session] Job submitted: ${jobId}`);
      if (!activeRef.current) return;
      onProcessingStarted();
    } catch (err) {
      if (!activeRef.current) return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(
        msg === 'quota_exceeded'
          ? 'Gemini API quota exceeded. Please enable billing or wait for daily reset.'
          : msg,
      );
      setPhase('ready');
      reset();
      setElapsed(0);
    }
  }, [patient.id, reset, onProcessingStarted]);

  // When recorder stops → submit audio for background processing
  useEffect(() => {
    if (recorderState === 'stopped' && blob) {
      setPhase('submitting');
      runSubmit(blob);
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

  const handleStop = () => { stop(); };

  const formatted = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Session header ── */}
      <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-border flex items-center justify-between gap-3 bg-card shrink-0 flex-wrap">
        {/* Patient name */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
            Patient
          </p>
          <h2 className="text-xl sm:text-2xl mt-0.5 truncate" style={{ fontFamily: 'var(--font-serif)' }}>
            {patient.name}
          </h2>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {phase === 'ready' && (
            <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
              ← Change
            </button>
          )}

          {phase === 'ready' && (
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
            >
              <Mic className="size-4" />
              Start Session
            </button>
          )}

          {phase === 'recording' && (
            <div className="flex items-center gap-2 sm:gap-3 bg-secondary border border-border rounded-xl px-2.5 sm:px-3 py-2">
              <div className="size-2.5 bg-red-500 rounded-full animate-pulse shrink-0" />
              {/* Waveform — desktop only */}
              <div className="hidden sm:flex gap-0.5 h-4 items-end">
                {[2, 4, 3, 4, 2, 3, 4, 3, 2, 4].map((h, i) => (
                  <div key={i} className="w-1 bg-accent rounded-full" style={{
                    height: `${h * 4}px`,
                    animation: `waveBar ${0.8 + (i % 3) * 0.2}s ease-in-out ${i * 0.08}s infinite`,
                  }} />
                ))}
              </div>
              <span className="text-xs font-medium tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatted}
              </span>
              <button onClick={handleStop} className="ml-1 px-2.5 sm:px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity">
                Stop
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 sm:mx-8 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Content */}
      {phase === 'submitting' ? (
        <SubmittingView patientName={patient.name} />
      ) : (
        <RecordingIdleView phase={phase} patientName={patient.name} onStart={handleStart} onStop={handleStop} />
      )}
    </div>
  );
}

function RecordingIdleView({
  phase, patientName, onStart, onStop,
}: { phase: SessionPhase; patientName: string; onStart: () => void; onStop: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 sm:px-8">
      <div className="text-center max-w-md">
        <button
          type="button"
          onClick={phase === 'ready' ? onStart : onStop}
          className={`group relative mx-auto size-20 sm:size-24 rounded-full flex items-center justify-center mb-6 sm:mb-8 transition-all hover:scale-105 active:scale-95 ${
            phase === 'recording' ? 'bg-red-500/10 hover:bg-red-500/20' : 'bg-accent/10 hover:bg-accent/20'
          }`}
        >
          {phase === 'recording' && <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />}
          <Mic className={`size-8 sm:size-10 relative ${phase === 'recording' ? 'text-red-500' : 'text-accent'}`} />
        </button>
        <h2 className="text-2xl sm:text-3xl mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
          {phase === 'recording' ? 'Listening…' : 'Ready when you are'}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base px-4">
          {phase === 'recording'
            ? 'Speak naturally. The session is being recorded privately.'
            : `Tap the microphone to start recording with ${patientName}.`}
        </p>
      </div>
    </div>
  );
}

function SubmittingView({ patientName }: { patientName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 sm:px-8">
      <div className="text-center max-w-sm">
        <svg className="size-8 animate-spin text-accent mx-auto mb-6" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <h2 className="text-2xl mb-2" style={{ fontFamily: 'var(--font-serif)' }}>Saving recording…</h2>
        <p className="text-sm text-muted-foreground">
          Securing {patientName}'s session. This only takes a moment.
        </p>
      </div>
    </div>
  );
}
