import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Building2, User } from 'lucide-react';
import { googleLogin, type LoginMode } from '../api/auth';
import { token } from '../api/base';
import type { Clinician } from '../types';

type Props = {
  onLogin: (clinician: Clinician) => void;
};

export function LoginPage({ onLogin }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('individual');

  const handleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) {
      setError('No credential received from Google.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await googleLogin(credentialResponse.credential, mode);
      token.set(data.accessToken);
      onLogin(data.clinician);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  const pathTab = (m: LoginMode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => { setMode(m); setError(null); }}
      className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        mode === m ? 'bg-card border border-border shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <p
            className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Aura Clinical
          </p>
          <h1 className="text-4xl leading-tight mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            Welcome back.
          </h1>
          <p className="text-muted-foreground text-sm">
            {mode === 'clinic'
              ? 'Sign in to your clinic with your work Google account.'
              : 'Sign in to access your sessions and patients.'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          {/* Path selector — always available */}
          <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-6">
            {pathTab('individual', <User className="size-4" />, 'Individual')}
            {pathTab('clinic', <Building2 className="size-4" />, 'Clinic')}
          </div>

          <p
            className="text-[11px] uppercase tracking-widest text-muted-foreground mb-6 text-center"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {mode === 'clinic' ? 'Clinic sign-in' : 'Individual practitioner'}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-2">
              <svg className="size-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleSuccess}
                onError={() => setError('Google sign-in failed. Please try again.')}
                theme="outline"
                size="large"
                shape="rectangular"
                text="signin_with"
              />
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
            ? 'Clinic access is invite-only — ask your admin if you need an invitation.'
            : 'Your data is private and scoped to your account.'}
        </p>
      </div>
    </div>
  );
}
