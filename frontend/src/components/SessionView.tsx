import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Mic, UserPlus } from 'lucide-react';
import { useRecorder } from '../hooks/useRecorder';
import { getSession, pollJobStatus, submitSession } from '../api/sessions';
import { ResultsPanel } from './ResultsPanel';
import type { JobStatus, Patient, SessionPhase, SessionResult } from '../types';

type Props = {
  patient: Patient;
  onBack: () => void;
  onSessionComplete?: (result: SessionResult) => void;
};

type ProcessingStageState = 'pending' | 'active' | 'done';

const STAGES = [
  { id: 1, label: 'Uploading audio' },
  { id: 2, label: 'Transcribing — Malayalam & English' },
  { id: 3, label: 'Writing clinical notes' },
];

// Map backend job status → which UI stage should be active
const STATUS_TO_STAGE: Partial<Record<JobStatus['status'], number>> = {
  pending:      1,
  uploading:    1,
  transcribing: 2,
  summarizing:  3,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function SessionView({ patient, onBack, onSessionComplete }: Props) {
  const { state: recorderState, blob, start, stop, reset } = useRecorder();
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageStates, setStageStates] = useState<ProcessingStageState[]>(['pending', 'pending', 'pending']);
  const startedAt = useRef<number | null>(null);
  const durationRef = useRef(0);
  // Used to stop polling if the component unmounts mid-job
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

  // When recorder stops → kick off async processing
  useEffect(() => {
    if (recorderState === 'stopped' && blob) {
      durationRef.current = elapsed;
      setPhase('processing');
      runProcessing(blob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState, blob]);

  const activateStage = useCallback((n: number) => {
    setStageStates((_prev) => [
      n > 1 ? 'done'    : n === 1 ? 'active' : 'pending',
      n > 2 ? 'done'    : n === 2 ? 'active' : 'pending',
      n > 3 ? 'done'    : n === 3 ? 'active' : 'pending',
    ] as ProcessingStageState[]);
  }, []);

  const runProcessing = useCallback(async (audioBlob: Blob) => {
    setError(null);
    activateStage(1);  // show "Uploading" immediately

    try {
      // ── Step 1: POST audio — returns in < 1 second with a job_id ──────
      const jobId = await submitSession(audioBlob, patient.id);
      console.log(`[session] Job submitted: ${jobId}`);

      // ── Step 2: Poll every 4 seconds until complete or failed ─────────
      let consecutiveErrors = 0;

      while (true) {
        await sleep(4000);

        if (!activeRef.current) return; // component unmounted — stop quietly

        let job: JobStatus;
        try {
          job = await pollJobStatus(jobId);
          consecutiveErrors = 0;
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            throw new Error('Lost connection to server. Please check your network and try again.');
          }
          console.warn(`[session] Poll error ${consecutiveErrors}/3, retrying…`);
          continue;
        }

        // Advance the UI stage indicator based on real backend status
        const stage = STATUS_TO_STAGE[job.status];
        if (stage !== undefined) activateStage(stage);

        if (job.status === 'complete' && job.summary_id) {
          setStageStates(['done', 'done', 'done']);

          // Fetch full session detail to display in ResultsPanel
          const detail = await getSession(job.summary_id);
          const sessionResult: SessionResult = {
            transcript: detail.transcript,
            summary:    detail.summary,
            patient_id: detail.patient_id,
            summary_id: detail.summary_id,
          };

          if (!activeRef.current) return;
          setResult(sessionResult);
          setPhase('done');
          onSessionComplete?.(sessionResult);
          return;
        }

        if (job.status === 'failed') {
          throw new Error(job.error ?? 'Processing failed. Please try again.');
        }
      }

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
  }, [activateStage, patient.id, reset, onSessionComplete]);

  const handleStart = async () => {
    setElapsed(0);
    setResult(null);
    setError(null);
    setStageStates(['pending', 'pending', 'pending']);
    try {
      await start();
      setPhase('recording');
    } catch {
      setError('Microphone access denied. Please allow mic permissions and reload.');
    }
  };

  const handleStop = () => { stop(); };

  const handleNewSession = () => {
    reset();
    setPhase('ready');
    setElapsed(0);
    setResult(null);
    setError(null);
    setStageStates(['pending', 'pending', 'pending']);
  };

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
          {phase !== 'processing' && (
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

          {phase === 'done' && (
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={handleNewSession}
                className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-secondary text-foreground text-xs font-medium rounded-lg hover:bg-secondary/70 transition-colors"
              >
                <Check className="size-3.5" />
                <span className="hidden sm:inline">Session complete</span>
                <span className="sm:hidden">Done</span>
              </button>
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-accent text-accent-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity"
              >
                <UserPlus className="size-3.5" />
                <span className="hidden sm:inline">New recording</span>
                <span className="sm:hidden">New</span>
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
      {phase === 'done' && result ? (
        <ResultsPanel result={result} durationSeconds={durationRef.current} patientName={patient.name} />
      ) : phase === 'processing' ? (
        <ProcessingView stageStates={stageStates} patientName={patient.name} />
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

function ProcessingView({
  stageStates, patientName,
}: { stageStates: ProcessingStageState[]; patientName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 sm:px-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-accent/10 px-3 py-1 rounded-full mb-4">
            <div className="size-1.5 bg-accent rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Processing</span>
          </div>
          <h2 className="text-2xl" style={{ fontFamily: 'var(--font-serif)' }}>{patientName}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            This usually takes 1–5 minutes depending on session length.
          </p>
        </div>

        <div className="space-y-4">
          {STAGES.map((stage, i) => {
            const state = stageStates[i];
            return (
              <div key={stage.id} className="flex items-center gap-4">
                <div className={`size-8 rounded-full flex items-center justify-center shrink-0 text-sm transition-colors ${
                  state === 'done'   ? 'bg-green-100 text-green-700' :
                  state === 'active' ? 'bg-accent/10 text-accent'    :
                                       'bg-secondary text-muted-foreground'
                }`}>
                  {state === 'done' ? (
                    <Check className="size-4" />
                  ) : state === 'active' ? (
                    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{stage.id}</span>
                  )}
                </div>
                <span className={`text-sm transition-colors ${
                  state === 'active' ? 'text-foreground font-medium' :
                  state === 'done'   ? 'text-green-700'              :
                                       'text-muted-foreground'
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-8 text-center">
          You can safely leave this page — processing continues in the background.
        </p>
      </div>
    </div>
  );
}
