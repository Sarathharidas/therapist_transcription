import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Plus, Search, UserPlus, X } from 'lucide-react';
import { createPatient, listPatients } from '../api/patients';
import type { Patient } from '../types';

type Props = {
  onSelect: (patient: Patient) => void;
};

type DialogProps = {
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
};

function AddPatientDialog({ onClose, onAdd }: DialogProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await onAdd(name.trim());
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 size-8 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="size-4" />
        </button>

        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2"
           style={{ fontFamily: 'var(--font-mono)' }}>
          New Patient
        </p>
        <h3 className="text-2xl mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          Add a patient
        </h3>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2"
               style={{ fontFamily: 'var(--font-mono)' }}>
          Full name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleAdd(); }}
          placeholder="e.g. Arthur Pemberton"
          className="w-full bg-background border border-border px-4 py-3 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
        />

        <div className="flex justify-end gap-3 mt-8">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            disabled={!name.trim() || loading}
            onClick={handleAdd}
            className="inline-flex items-center gap-2 px-5 py-2 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add &amp; Start Session
          </button>
        </div>
      </div>
    </div>
  );
}

export function PatientSelect({ onSelect }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Load patients from DB on mount
  useEffect(() => {
    listPatients()
      .then(setPatients)
      .catch((e) => console.error('Failed to load patients:', e))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => patients.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [patients, query],
  );

  const exactMatch = patients.find(
    (p) => p.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const handleAddPatient = async (name: string) => {
    const newPatient = await createPatient(name);
    setPatients((prev) => [newPatient, ...prev]);
    setAddOpen(false);
    onSelect(newPatient);
  };

  const handleContinue = async () => {
    if (exactMatch) { onSelect(exactMatch); return; }
    if (filtered[0]) { onSelect(filtered[0]); return; }
    if (query.trim()) {
      await handleAddPatient(query.trim());
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-8">
      <div className="w-full max-w-xl">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-6"
           style={{ fontFamily: 'var(--font-mono)' }}>
          Step 01 / Begin
        </p>
        <h1 className="text-5xl leading-tight mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
          Let's get started.
        </h1>
        <p className="text-muted-foreground text-lg mb-12">
          Add your patient's name to open a new session.
        </p>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-3"
               style={{ fontFamily: 'var(--font-mono)' }}>
          Patient
        </label>

        <div className="relative">
          <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-2 pl-4 shadow-sm focus-within:border-accent/60 transition-colors">
            {loading
              ? <Loader2 className="size-4 text-muted-foreground shrink-0 animate-spin" />
              : <Search className="size-4 text-muted-foreground shrink-0" />
            }
            <input
              autoFocus
              value={query}
              disabled={loading}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) void handleContinue(); }}
              placeholder={loading ? 'Loading patients…' : 'Select existing or type a new name…'}
              className="flex-1 bg-transparent text-base focus:outline-none placeholder:text-muted-foreground/60 min-w-0 disabled:opacity-50"
            />
            <button
              disabled={!query.trim() || loading}
              onClick={() => void handleContinue()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              Continue
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          {open && !loading && (
            <div className="absolute z-10 left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
              {filtered.length > 0 ? (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(p); }}
                    className="w-full flex items-center justify-between text-left px-4 py-3 hover:bg-secondary transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.lastSeen && (
                        <div className="text-[10px] text-muted-foreground mt-0.5"
                             style={{ fontFamily: 'var(--font-mono)' }}>
                          Added {p.lastSeen}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted-foreground">No matches found.</div>
              )}
              {query.trim() && !exactMatch && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); setAddOpen(true); setOpen(false); }}
                  className="w-full flex items-center gap-3 text-left px-4 py-3 border-t border-border hover:bg-secondary transition-colors"
                >
                  <Plus className="size-3.5 text-accent" />
                  <span className="text-sm">
                    Add new patient: <strong>{query}</strong>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <p className="text-xs text-muted-foreground">
            Press{' '}
            <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-[10px]">
              Enter
            </kbd>{' '}
            to continue.
          </p>
          <button
            onClick={() => { setAddOpen(true); setOpen(false); }}
            className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus className="size-3.5" />
            Add New Patient
          </button>
        </div>
      </div>

      {addOpen && (
        <AddPatientDialog
          onClose={() => setAddOpen(false)}
          onAdd={handleAddPatient}
        />
      )}
    </div>
  );
}
