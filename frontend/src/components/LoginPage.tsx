import { useState } from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Building2, ShieldCheck, User } from 'lucide-react';
import { googleLogin, type LoginMode } from '../api/auth';
import {
  authAttempt,
  authReference,
  reportAuthClientEvent,
  token,
} from '../api/base';
import { ClinicRegister } from './ClinicRegister';
import type { Clinician } from '../types';

type Props = {
  onLogin: (clinician: Clinician) => void;
  // Open the "How it works" / privacy page (available before sign-in).
  onHowItWorks: () => void;
};

type ClinicScreen = 'choose' | 'register' | 'login';

// Best-effort decode of the email from a Google ID token (display only)
function emailFromCredential(cred: string): string {
  try {
    const payload = cred.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).email ?? '';
  } catch {
    return '';
  }
}

export function LoginPage({ onLogin, onHowItWorks }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('individual');
  const [clinicScreen, setClinicScreen] = useState<ClinicScreen>('choose');
  const [clinicName, setClinicName] = useState('');
  // When set, we move to the registration form (admin already Google-authed)
  const [registerCredential, setRegisterCredential] = useState<{
    credential: string;
    attemptId: string;
  } | null>(null);

  // Individual sign-in (UNCHANGED behaviour) + clinic login both end here
  const completeLogin = async (
    credential: string,
    m: LoginMode,
    attemptId: string,
    name?: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const data = await googleLogin(credential, m, name, attemptId);
      try {
        token.set(data.accessToken);
      } catch {
        reportAuthClientEvent('jwt_storage_failure', attemptId, { mode: m });
        throw new Error(
          `Your browser blocked secure session storage. Reference: ${authReference(attemptId)}`,
        );
      }
      onLogin(data.clinician);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  const startAttempt = () => {
    const attemptId = authAttempt.create();
    authAttempt.set(attemptId);
    return attemptId;
  };

  const handleGoogleError = (m: LoginMode) => {
    const attemptId = startAttempt();
    reportAuthClientEvent('google_on_error', attemptId, { mode: m });
    setLoading(false);
    setError(`Google sign-in failed. Please try again. Reference: ${authReference(attemptId)}`);
  };

  const handleGoogleSuccess = (
    response: CredentialResponse,
    m: LoginMode,
    name?: string,
  ) => {
    const attemptId = startAttempt();
    if (!response.credential) {
      reportAuthClientEvent('google_credential_missing', attemptId, { mode: m });
      setError(`Google did not return a sign-in credential. Reference: ${authReference(attemptId)}`);
      return;
    }
    void completeLogin(response.credential, m, attemptId, name);
  };

  const handleRegisterGoogleSuccess = (response: CredentialResponse) => {
    const attemptId = startAttempt();
    if (!response.credential) {
      reportAuthClientEvent('google_credential_missing', attemptId, { mode: 'clinic' });
      setError(`Google did not return a sign-in credential. Reference: ${authReference(attemptId)}`);
      return;
    }
    setRegisterCredential({ credential: response.credential, attemptId });
  };

  const setPath = (m: LoginMode) => {
    setMode(m);
    setError(null);
    setClinicScreen('choose');
  };

  // ── Clinic registration form (after the admin's Google sign-in) ──
  if (registerCredential) {
    return (
      <ClinicRegister
        credential={registerCredential.credential}
        attemptId={registerCredential.attemptId}
        adminEmail={emailFromCredential(registerCredential.credential)}
        onLogin={onLogin}
        onBack={() => { setRegisterCredential(null); setError(null); }}
      />
    );
  }

  const tab = (m: LoginMode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setPath(m)}
      className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        mode === m ? 'bg-card border border-border shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const spinner = (
    <div className="flex items-center justify-center py-2">
      <svg className="size-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
            Aura Clinical
          </p>
          <h1 className="text-4xl leading-tight mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            Welcome back.
          </h1>
          <p className="text-muted-foreground text-sm">
            {mode === 'clinic'
              ? 'Register or sign in to your clinic.'
              : 'Sign in to access your sessions and patients.'}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          {/* Path selector — always available */}
          <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-6">
            {tab('individual', <User className="size-4" />, 'Individual')}
            {tab('clinic', <Building2 className="size-4" />, 'Clinic')}
          </div>

          {/* ── Individual practitioner (UNCHANGED) ── */}
          {mode === 'individual' && (
            <>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-6 text-center" style={{ fontFamily: 'var(--font-mono)' }}>
                Individual practitioner
              </p>
              {loading ? spinner : (
                <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={(r) => handleGoogleSuccess(r, 'individual')}
                    onError={() => handleGoogleError('individual')}
                    theme="outline" size="large" shape="rectangular" text="signin_with"
                  />
                </div>
              )}
            </>
          )}

          {/* ── Clinic ── */}
          {mode === 'clinic' && clinicScreen === 'choose' && (
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 text-center" style={{ fontFamily: 'var(--font-mono)' }}>
                Clinic access
              </p>
              <button
                onClick={() => { setClinicScreen('register'); setError(null); }}
                className="w-full px-4 py-3 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
              >
                Register a clinic
              </button>
              <button
                onClick={() => { setClinicScreen('login'); setError(null); }}
                className="w-full px-4 py-3 bg-secondary text-sm font-semibold rounded-lg hover:bg-secondary/70 transition-colors"
              >
                Sign in to my clinic
              </button>
            </div>
          )}

          {mode === 'clinic' && clinicScreen === 'register' && (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center" style={{ fontFamily: 'var(--font-mono)' }}>
                Register — sign in to continue
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Sign in with Google; you'll name the clinic and add therapists next.
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleRegisterGoogleSuccess}
                  onError={() => handleGoogleError('clinic')}
                  theme="outline" size="large" shape="rectangular" text="continue_with"
                />
              </div>
              <button onClick={() => setClinicScreen('choose')} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
                ← Back
              </button>
            </div>
          )}

          {mode === 'clinic' && clinicScreen === 'login' && (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center" style={{ fontFamily: 'var(--font-mono)' }}>
                Clinic sign-in
              </p>
              <div>
                <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                  Clinic name
                </label>
                <input
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Your clinic's name"
                  className="w-full bg-background border border-border px-4 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </div>
              {loading ? spinner : (
                <div className={`flex justify-center ${clinicName.trim() ? '' : 'opacity-40 pointer-events-none'}`}>
                  <GoogleLogin
                    onSuccess={(r) => handleGoogleSuccess(r, 'clinic', clinicName.trim())}
                    onError={() => handleGoogleError('clinic')}
                    theme="outline" size="large" shape="rectangular" text="signin_with"
                  />
                </div>
              )}
              {!clinicName.trim() && (
                <p className="text-xs text-muted-foreground text-center">Enter your clinic name to continue.</p>
              )}
              <button onClick={() => setClinicScreen('choose')} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
                ← Back
              </button>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
              ⚠️ {error}
            </p>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          {mode === 'clinic'
            ? 'Clinic access is invite-only — ask your admin if you need access.'
            : 'Your data is private and scoped to your account.'}
        </p>

        {/* Privacy / how-it-works — available before signing in */}
        <button
          onClick={onHowItWorks}
          className="mx-auto mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ShieldCheck className="size-3.5" /> How it works &amp; your privacy
        </button>
      </div>
    </div>
  );
}
