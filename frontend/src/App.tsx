import { useEffect, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { UserPlus, LogOut } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { PatientSelect } from './components/PatientSelect';
import { SessionView } from './components/SessionView';
import { LoginPage } from './components/LoginPage';
import { getMe, logout } from './api/auth';
import { token } from './api/base';
import type { AppView, Clinician, Patient } from './types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

function AppInner() {
  const [authLoading, setAuthLoading] = useState(true);
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [view, setView] = useState<AppView>('select');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Check for existing valid token on mount — skip entirely if no token stored
  useEffect(() => {
    if (!token.get()) {
      setAuthLoading(false);
      return;
    }
    getMe()
      .then(setClinician)
      .catch(() => {
        token.clear();
        setClinician(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = () => {
    logout();
    setClinician(null);
    setView('select');
    setSelectedPatient(null);
  };

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setView('session');
  };

  const handleNewSession = () => {
    setView('select');
    setSelectedPatient(null);
  };

  // Loading state while checking token
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <svg className="size-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // Not authenticated — show login
  if (!clinician) {
    return <LoginPage onLogin={setClinician} />;
  }

  // Authenticated — show main app
  return (
    <div className="flex h-screen w-full bg-background text-foreground antialiased overflow-hidden">
      <Sidebar selectedPatient={selectedPatient} onNewSession={handleNewSession} />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-14 px-8 border-b border-border flex items-center justify-between bg-card/40 shrink-0">
          <div
            className="text-[11px] uppercase tracking-widest text-muted-foreground"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {view === 'select'
              ? 'New Session'
              : `Session / ${selectedPatient?.name}`}
          </div>

          <div className="flex items-center gap-3">
            {/* Clinician name */}
            <span
              className="text-[11px] text-muted-foreground hidden sm:block"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {clinician.name}
            </span>

            {view === 'select' && (
              <button
                onClick={() => {/* handled inside PatientSelect */}}
                className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                <UserPlus className="size-3.5" />
                Add New Patient
              </button>
            )}

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sign out"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {view === 'select' ? (
          <PatientSelect onSelect={handleSelectPatient} />
        ) : (
          <SessionView patient={selectedPatient!} onBack={handleNewSession} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppInner />
    </GoogleOAuthProvider>
  );
}
