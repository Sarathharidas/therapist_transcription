import { useEffect, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { FileText, LogOut, Menu, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { PatientSelect } from './components/PatientSelect';
import { SessionView } from './components/SessionView';
import { LoginPage } from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getMe, logout } from './api/auth';
import { token } from './api/base';
import { getSession, getAppointment } from './api/sessions';
import { ResultsPanel } from './components/ResultsPanel';
import { GroupSessionView } from './components/GroupSessionView';
import { AppointmentView } from './components/AppointmentView';
import { TeamView } from './components/TeamView';
import { SummaryFormatDialog } from './components/SummaryFormatDialog';
import { HowItWorks } from './components/HowItWorks';
import { BillingView } from './components/BillingView';
import { getSubscription, type Subscription } from './api/billing';
import { Building2, Sparkles } from 'lucide-react';
import type {
  Appointment,
  AppointmentDetail,
  AppView,
  Clinician,
  Patient,
  PastSession,
  SessionDetail,
} from './types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

function AppInner() {
  const [authLoading, setAuthLoading] = useState(true);
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [view, setView] = useState<AppView>('select');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [pastSession, setPastSession] = useState<SessionDetail | null>(null);
  const [pastSessionLoading, setPastSessionLoading] = useState(false);
  // Group / couple therapy
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [appointmentDetail, setAppointmentDetail] = useState<AppointmentDetail | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Summary-format editor dialog (home screen)
  const [formatOpen, setFormatOpen] = useState(false);
  // "How it works" page shown pre-login (post-login it's a normal view)
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  // Sidebar refresh + active highlight
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [activeSummaryId, setActiveSummaryId] = useState<string | undefined>();

  // Subscription/trial status (drives the top-bar badge + billing view)
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const refreshSubscription = () => {
    getSubscription().then(setSubscription).catch(() => setSubscription(null));
  };
  // Load subscription on login (also lazily starts the trial) + poll every 45s so
  // the hours badge stays fresh as sessions are used and on renewal.
  useEffect(() => {
    if (!clinician) return;
    refreshSubscription();
    const id = setInterval(refreshSubscription, 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinician]);
  // Also refetch right after a session is submitted/finished (sidebar refresh signal).
  useEffect(() => {
    if (clinician) refreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarRefreshKey]);

  // Transient "processing in background" notice shown after a recording is submitted
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);

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
    setActiveSummaryId(undefined);
  };

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setView('session');
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  const handleOpenTeam = () => {
    setView('team');
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  const handleOpenHowItWorks = () => {
    setView('how-it-works');
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  const handleOpenBilling = () => {
    setView('billing');
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  const handleNewSession = () => {
    setView('select');
    setSelectedPatient(null);
    setPastSession(null);
    setAppointment(null);
    setAppointmentDetail(null);
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  // A group appointment has been started from PatientSelect
  const handleSelectGroup = (appt: Appointment) => {
    setAppointment(appt);
    setView('group-session');
    setActiveSummaryId(undefined);
    setSidebarOpen(false);
  };

  // The clinician finished a group appointment — open its results view
  const handleFinishAppointment = async (sessionId: string) => {
    setAppointmentLoading(true);
    setAppointmentDetail(null);
    setView('appointment');
    setActiveSummaryId(undefined);
    setSidebarRefreshKey((k) => k + 1);
    try {
      setAppointmentDetail(await getAppointment(sessionId));
    } catch {
      handleNewSession();
    } finally {
      setAppointmentLoading(false);
    }
  };

  // Called by SessionView once audio is submitted — the backend transcribes in the
  // background. Free the clinician: return to patient-select and show a brief notice.
  // The finished note appears in Recent Notes on the sidebar's interval refresh.
  const handleProcessingStarted = () => {
    const name = selectedPatient?.name ?? 'the session';
    setProcessingNotice(
      `Transcription for ${name} is processing in the background — it'll appear in Recent Notes shortly.`,
    );
    setSidebarRefreshKey((k) => k + 1);
    handleNewSession();
  };

  // Auto-dismiss the processing notice after a few seconds
  useEffect(() => {
    if (!processingNotice) return;
    const id = setTimeout(() => setProcessingNotice(null), 8000);
    return () => clearTimeout(id);
  }, [processingNotice]);

  const handleSelectSession = async (session: PastSession) => {
    setSidebarOpen(false);

    // Grouped appointment → open the appointment view (all segments)
    if (session.sessionId) {
      setActiveSummaryId(session.sessionId);
      setAppointmentLoading(true);
      setAppointmentDetail(null);
      setView('appointment');
      try {
        setAppointmentDetail(await getAppointment(session.sessionId));
      } catch {
        setView('select');
        setActiveSummaryId(undefined);
      } finally {
        setAppointmentLoading(false);
      }
      return;
    }

    // Solo session → single summary detail
    await handleOpenSummary(session.id);
  };

  // Open a single session's full summary by id (used by the sidebar's solo path
  // and the "Previous sessions" links on the recording screen).
  const handleOpenSummary = async (summaryId: string) => {
    setSidebarOpen(false);
    setPastSessionLoading(true);
    setPastSession(null);
    setView('past-session');
    setActiveSummaryId(summaryId);
    try {
      setPastSession(await getSession(summaryId));
    } catch {
      setView('select');
      setActiveSummaryId(undefined);
    } finally {
      setPastSessionLoading(false);
    }
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

  // Not authenticated — show the privacy page (if opened) or the login screen
  if (!clinician) {
    if (howItWorksOpen) {
      return (
        <div className="h-dvh flex flex-col bg-background">
          <HowItWorks onBack={() => setHowItWorksOpen(false)} backLabel="Back to sign in" />
        </div>
      );
    }
    return <LoginPage onLogin={setClinician} onHowItWorks={() => setHowItWorksOpen(true)} />;
  }

  // Shared sidebar props
  const sidebarProps = {
    clinician,
    selectedPatient,
    onNewSession: handleNewSession,
    onSelectSession: handleSelectSession,
    activeSummaryId,
    refreshKey: sidebarRefreshKey,
  };

  // Authenticated — show main app
  return (
    <div className="flex h-dvh w-full bg-background text-foreground antialiased overflow-hidden">

      {/* ── Desktop sidebar (always visible on md+) ── */}
      <div className="hidden md:flex shrink-0">
        <Sidebar {...sidebarProps} />
      </div>

      {/* ── Mobile sidebar drawer ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" />
          {/* Drawer panel */}
          <div
            className="absolute left-0 top-0 bottom-0 w-72 flex flex-col z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar {...sidebarProps} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-14 px-4 sm:px-8 border-b border-border flex items-center justify-between bg-card/40 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden inline-flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </button>

            <div
              className="text-[11px] uppercase tracking-widest text-muted-foreground truncate"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {view === 'select'
                ? 'New Session'
                : view === 'how-it-works'
                ? 'How it works'
                : view === 'billing'
                ? 'Plans & usage'
                : view === 'team'
                ? `Clinic / ${clinician.clinicName ?? ''}`
                : view === 'group-session'
                ? `Appointment / ${appointment?.label ?? ''}`
                : view === 'appointment'
                ? `Appointment / ${appointmentDetail?.label ?? ''}`
                : `Session / ${selectedPatient?.name ?? ''}`}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Subscription / trial badge — clickable → plans & usage */}
            {subscription && view !== 'billing' && (
              <button
                onClick={handleOpenBilling}
                title="Plans & usage"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  subscription.status === 'active'
                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                    : subscription.status === 'trial'
                    ? 'bg-accent/10 text-accent hover:bg-accent/20'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <Sparkles className="size-3" />
                {subscription.status === 'active'
                  ? `${subscription.planName ?? 'Plan'} · ${subscription.hoursBalance.toFixed(0)}h`
                  : subscription.status === 'trial'
                  ? `Free trial · ${subscription.trialDaysLeft ?? 0}d`
                  : 'Upgrade'}
              </button>
            )}

            {/* Clinician name */}
            <span
              className="text-[11px] text-muted-foreground hidden sm:block"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {clinician.name}
            </span>

            {/* How it works / privacy — home screen */}
            {view === 'select' && (
              <button
                onClick={handleOpenHowItWorks}
                title="How it works & your privacy"
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <ShieldCheck className="size-3.5" />
                <span className="hidden sm:inline">How it works</span>
              </button>
            )}

            {/* Summary format editor — sits just left of Add on the home screen */}
            {view === 'select' && (
              <button
                onClick={() => setFormatOpen(true)}
                title="Edit summary format"
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <FileText className="size-3.5" />
                <span className="hidden sm:inline">Format</span>
              </button>
            )}

            {view === 'select' && (
              <button
                onClick={() => {/* handled inside PatientSelect */}}
                className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                <UserPlus className="size-3.5" />
                <span className="hidden sm:inline">Add New Patient</span>
                <span className="sm:hidden">Add</span>
              </button>
            )}

            {/* Clinic / Team — only for clinic members */}
            {clinician.clinicId && view !== 'team' && (
              <button
                onClick={handleOpenTeam}
                title={clinician.clinicName ?? 'Clinic'}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <Building2 className="size-3.5" />
                <span className="hidden sm:inline">{clinician.role === 'admin' ? 'Manage clinic' : 'Clinic'}</span>
              </button>
            )}

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sign out"
              className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Background-processing notice */}
        {processingNotice && (
          <div className="mx-4 sm:mx-8 mt-4 p-3 sm:p-4 bg-accent/10 border border-accent/30 rounded-xl flex items-start justify-between gap-3 animate-fade-in">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="size-1.5 bg-accent rounded-full mt-1.5 shrink-0 animate-pulse" />
              <p className="text-sm text-foreground/80">{processingNotice}</p>
            </div>
            <button
              onClick={() => setProcessingNotice(null)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {view === 'select' && (
          <PatientSelect onSelect={handleSelectPatient} onSelectGroup={handleSelectGroup} />
        )}
        {view === 'session' && (
          <SessionView
            patient={selectedPatient!}
            onBack={handleNewSession}
            onProcessingStarted={handleProcessingStarted}
            onOpenSession={handleOpenSummary}
          />
        )}
        {view === 'group-session' && appointment && (
          <GroupSessionView
            appointment={appointment}
            onBack={handleNewSession}
            onFinish={handleFinishAppointment}
          />
        )}
        {view === 'team' && (
          <TeamView clinician={clinician} />
        )}
        {view === 'how-it-works' && (
          <HowItWorks onBack={handleNewSession} />
        )}
        {view === 'billing' && subscription && (
          <BillingView
            subscription={subscription}
            clinicianName={clinician.name}
            onBack={handleNewSession}
            onChanged={refreshSubscription}
          />
        )}
        {view === 'appointment' && (
          appointmentLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <svg className="size-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : appointmentDetail ? (
            <AppointmentView appointment={appointmentDetail} />
          ) : null
        )}
        {view === 'past-session' && (
          pastSessionLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <svg className="size-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : pastSession ? (
            <ResultsPanel
              result={{
                transcript: pastSession.transcript,
                summary: pastSession.summary,
                patient_id: pastSession.patient_id,
                summary_id: pastSession.summary_id,
              }}
              patientName={pastSession.patient_name}
              initialNotes={pastSession.clinician_notes ?? ''}
              dateLabel={pastSession.date}
              onOpenSession={handleOpenSummary}
            />
          ) : null
        )}
      </main>

      {/* Summary-format editor dialog */}
      {formatOpen && <SummaryFormatDialog onClose={() => setFormatOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <AppInner />
      </GoogleOAuthProvider>
    </ErrorBoundary>
  );
}
