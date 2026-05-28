import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { PatientSelect } from './components/PatientSelect';
import { SessionView } from './components/SessionView';
import type { AppView, Patient } from './types';

export default function App() {
  const [view, setView] = useState<AppView>('select');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setView('session');
  };

  const handleNewSession = () => {
    setView('select');
    setSelectedPatient(null);
  };

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
          {view === 'select' && (
            <button
              onClick={() => {/* handled inside PatientSelect */}}
              className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <UserPlus className="size-3.5" />
              Add New Patient
            </button>
          )}
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
