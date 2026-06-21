import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2, Plus, Search, User, Users, UserPlus, X } from 'lucide-react';
import { createPatient, listPatients } from '../api/patients';
import { createGroup, listGroups } from '../api/groups';
import { createAppointment } from '../api/sessions';
import type { Appointment, Group, Patient } from '../types';

type Props = {
  onSelect: (patient: Patient) => void;
  // Called once a group appointment has been started.
  onSelectGroup: (appointment: Appointment) => void;
};

type Mode = 'individual' | 'group';

type DialogProps = {
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
};

function AddPatientDialog({ onClose, onAdd }: DialogProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onAdd(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add patient. Is the backend running?');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 sm:p-8 relative">
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

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

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

export function PatientSelect({ onSelect, onSelectGroup }: Props) {
  const [mode, setMode] = useState<Mode>('individual');
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

  // Create a patient and add it to the list WITHOUT starting a session —
  // used by the group builder so members can be added inline.
  const addPatientToList = async (name: string): Promise<Patient> => {
    const newPatient = await createPatient(name);
    setPatients((prev) => [newPatient, ...prev]);
    return newPatient;
  };

  const handleContinue = async () => {
    if (exactMatch) { onSelect(exactMatch); return; }
    if (filtered[0]) { onSelect(filtered[0]); return; }
    if (query.trim()) {
      await handleAddPatient(query.trim());
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-8">
      <div className="w-full max-w-xl">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-4 sm:mb-6"
           style={{ fontFamily: 'var(--font-mono)' }}>
          Step 01 / Begin
        </p>
        <h1 className="text-4xl sm:text-5xl leading-tight mb-3 sm:mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
          Let's get started.
        </h1>
        <ModeTabs mode={mode} onChange={setMode} />

        {mode === 'individual' ? (
        <>
        <p className="text-muted-foreground text-base sm:text-lg mb-8 sm:mb-12">
          Add your patient's name to open a new session.
        </p>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-3"
               style={{ fontFamily: 'var(--font-mono)' }}>
          Patient
        </label>

        <div className="relative">
          <div className="flex items-center gap-2 sm:gap-3 bg-card border border-border rounded-xl p-2 pl-3 sm:pl-4 shadow-sm focus-within:border-accent/60 transition-colors">
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
              placeholder={loading ? 'Loading patients…' : 'Select or type a name…'}
              className="flex-1 bg-transparent text-base focus:outline-none placeholder:text-muted-foreground/60 min-w-0 disabled:opacity-50"
            />
            <button
              disabled={!query.trim() || loading}
              onClick={() => void handleContinue()}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-accent text-accent-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              <span className="hidden sm:inline">Continue</span>
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          {open && !loading && (
            <div className="absolute z-10 left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-60 sm:max-h-72 overflow-y-auto">
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

        <div className="flex items-center justify-between mt-5 sm:mt-6 gap-3">
          <p className="text-xs text-muted-foreground hidden sm:block">
            Press{' '}
            <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-[10px]">
              Enter
            </kbd>{' '}
            to continue.
          </p>
          <button
            onClick={() => { setAddOpen(true); setOpen(false); }}
            className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity ml-auto"
          >
            <UserPlus className="size-3.5" />
            Add New Patient
          </button>
        </div>
        </>
        ) : (
          <GroupPanel
            patients={patients}
            loading={loading}
            onAddPatient={addPatientToList}
            onSelectGroup={onSelectGroup}
          />
        )}
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

// ── Mode tabs: Individual vs Couple / Group ────────────────────────────────

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tab = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(m)}
      className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        mode === m ? 'bg-card border border-border shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-8">
      {tab('individual', <User className="size-4" />, 'Individual')}
      {tab('group', <Users className="size-4" />, 'Couple / Group')}
    </div>
  );
}

// ── Group panel: pick an existing group or build a new one ──────────────────

type GroupPanelProps = {
  patients: Patient[];
  loading: boolean;
  onAddPatient: (name: string) => Promise<Patient>;
  onSelectGroup: (appointment: Appointment) => void;
};

function GroupPanel({ patients, loading, onAddPatient, onSelectGroup }: GroupPanelProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [starting, setStarting] = useState<string | null>(null); // group id being started
  const [error, setError] = useState<string | null>(null);

  // Builder state
  const [label, setLabel] = useState('');
  const [labelDirty, setLabelDirty] = useState(false); // true once the doctor edits the name
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, []);

  // Suggested group name from the current selection, in pick order.
  // First names only, e.g. "Asha & Ravi" / "Asha, Ravi & Maya".
  const defaultLabel = useMemo(() => {
    const names = Array.from(selected)
      .map((id) => patients.find((p) => p.id === id)?.name?.trim().split(/\s+/)[0])
      .filter(Boolean) as string[];
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }, [selected, patients]);

  // Keep the name field in sync with the selection until the doctor types their own.
  useEffect(() => {
    if (!labelDirty) setLabel(defaultLabel);
  }, [defaultLabel, labelDirty]);

  const startFromGroup = async (groupId: string) => {
    setError(null);
    setStarting(groupId);
    try {
      const appt = await createAppointment({ groupId });
      onSelectGroup(appt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start appointment.');
      setStarting(null);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const quickAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const p = await onAddPatient(name);
      setSelected((prev) => new Set(prev).add(p.id));
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add patient.');
    }
  };

  const saveAndStart = async () => {
    setError(null);
    if (!label.trim()) { setError('Give the group a name.'); return; }
    if (selected.size < 2) { setError('Select at least two patients.'); return; }
    setSaving(true);
    try {
      const group = await createGroup(label.trim(), Array.from(selected));
      const appt = await createAppointment({ groupId: group.id });
      onSelectGroup(appt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
      setSaving(false);
    }
  };

  // ── Builder view ──
  if (building) {
    return (
      <div>
        <p className="text-muted-foreground text-base sm:text-lg mb-6">
          Name the group and pick who's in it.
        </p>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          Group name
        </label>
        <input
          autoFocus
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelDirty(e.target.value.trim() !== ''); }}
          placeholder="e.g. Asha & Ravi"
          className="w-full bg-card border border-border px-4 py-3 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 mb-6"
        />

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          Members ({selected.size} selected)
        </label>
        <div className="border border-border rounded-xl divide-y divide-border max-h-56 overflow-y-auto mb-3">
          {loading ? (
            <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>
          ) : patients.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No patients yet — add some below.</div>
          ) : (
            patients.map((p) => (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-secondary transition-colors"
              >
                <span className="text-sm">{p.name}</span>
                <span className={`size-5 rounded-md border flex items-center justify-center ${selected.has(p.id) ? 'bg-accent border-accent text-accent-foreground' : 'border-border'}`}>
                  {selected.has(p.id) && <Check className="size-3.5" />}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Quick add patient */}
        <div className="flex gap-2 mb-6">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void quickAdd(); }}
            placeholder="Add a new patient…"
            className="flex-1 bg-card border border-border px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <button onClick={() => void quickAdd()} disabled={!newName.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 bg-secondary text-sm font-medium rounded-lg hover:bg-secondary/70 transition-colors disabled:opacity-40">
            <Plus className="size-3.5" /> Add
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ {error}</p>}

        <div className="flex justify-between gap-3">
          <button onClick={() => { setBuilding(false); setError(null); }} className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back
          </button>
          <button
            onClick={() => void saveAndStart()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
            Create &amp; Start
          </button>
        </div>
      </div>
    );
  }

  // ── Group list view ──
  return (
    <div>
      <p className="text-muted-foreground text-base sm:text-lg mb-8">
        Select a couple or family to start a joint appointment.
      </p>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ {error}</p>}

      {groupsLoading ? (
        <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading groups…</div>
      ) : groups.length > 0 ? (
        <div className="space-y-2 mb-6">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => void startFromGroup(g.id)}
              disabled={starting !== null}
              className="w-full flex items-center justify-between text-left p-4 bg-card border border-border rounded-xl hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <div>
                <div className="text-sm font-medium flex items-center gap-2"><Users className="size-3.5 text-muted-foreground" /> {g.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{g.members.map((m) => m.name).join(', ')}</div>
              </div>
              {starting === g.id ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ArrowRight className="size-4 text-muted-foreground" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-6 mb-6 text-sm text-muted-foreground border border-dashed border-border rounded-xl text-center">
          No groups yet. Create one to get started.
        </div>
      )}

      <button
        onClick={() => { setBuilding(true); setError(null); setSelected(new Set()); setLabel(''); setLabelDirty(false); }}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-foreground text-background text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
      >
        <Plus className="size-4" /> New group
      </button>
    </div>
  );
}
