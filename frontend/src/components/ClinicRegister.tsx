import { useMemo, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { registerClinic } from '../api/auth';
import { authReference, reportAuthClientEvent, token } from '../api/base';
import type { Clinician } from '../types';

type Props = {
  credential: string;            // Google ID token captured at sign-in
  attemptId: string;             // privacy-safe correlation ID for Railway logs
  adminEmail: string;            // for display
  onLogin: (clinician: Clinician) => void;
  onBack: () => void;
};

export function ClinicRegister({ credential, attemptId, adminEmail, onLogin, onBack }: Props) {
  const [clinicName, setClinicName] = useState('');
  const [count, setCount] = useState(1);
  const [emails, setEmails] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the email fields in sync with the requested therapist count
  const setTherapistCount = (n: number) => {
    const safe = Math.max(0, Math.min(50, Number.isFinite(n) ? n : 0));
    setCount(safe);
    setEmails((prev) => {
      const next = prev.slice(0, safe);
      while (next.length < safe) next.push('');
      return next;
    });
  };

  const setEmailAt = (i: number, v: string) =>
    setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));

  const canSubmit = useMemo(() => clinicName.trim().length > 0 && !submitting, [clinicName, submitting]);

  const handleSubmit = async () => {
    setError(null);
    if (!clinicName.trim()) { setError('Enter a clinic name.'); return; }
    setSubmitting(true);
    try {
      const data = await registerClinic(
        credential,
        clinicName.trim(),
        emails.map((e) => e.trim()).filter(Boolean),
        attemptId,
      );
      try {
        token.set(data.accessToken);
      } catch {
        reportAuthClientEvent('jwt_storage_failure', attemptId, { mode: 'clinic' });
        throw new Error(
          `Your browser blocked secure session storage. Reference: ${authReference(attemptId)}`,
        );
      }
      onLogin(data.clinician);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register the clinic.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-12 rounded-xl bg-accent/10 mb-4">
            <Building2 className="size-6 text-accent" />
          </div>
          <h1 className="text-3xl leading-tight mb-2" style={{ fontFamily: 'var(--font-serif)' }}>
            Register your clinic
          </h1>
          <p className="text-muted-foreground text-sm">
            Signed in as {adminEmail} — you'll be the clinic admin.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-5">
          <div>
            <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              Clinic name
            </label>
            <input
              autoFocus
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              placeholder="e.g. Bright Minds Therapy"
              className="w-full bg-background border border-border px-4 py-3 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              Number of therapists (besides you)
            </label>
            <input
              type="number"
              min={0}
              max={50}
              value={count}
              onChange={(e) => setTherapistCount(parseInt(e.target.value, 10))}
              className="w-28 bg-background border border-border px-4 py-3 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>

          {count > 0 && (
            <div>
              <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                Therapist emails
              </label>
              <div className="space-y-2">
                {emails.map((e, i) => (
                  <input
                    key={i}
                    type="email"
                    value={e}
                    onChange={(ev) => setEmailAt(i, ev.target.value)}
                    placeholder={`therapist${i + 1}@clinic.com`}
                    className="w-full bg-background border border-border px-4 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                They join when they sign in via “Clinic → Login” with this email and clinic name.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ {error}</p>
          )}

          <div className="flex justify-between gap-3 pt-1">
            <button onClick={onBack} disabled={submitting} className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
              ← Back
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Building2 className="size-3.5" />}
              Create clinic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
