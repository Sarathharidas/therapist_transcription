import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Loader2, Mail, Plus, Shield, Trash2, UserMinus } from 'lucide-react';
import { createInvite, getClinic, removeMember, revokeInvite, updateMemberRole } from '../api/clinic';
import type { Clinic, Clinician, ClinicianRole } from '../types';

type Props = {
  clinician: Clinician;
};

export function TeamView({ clinician }: Props) {
  const isAdmin = clinician.role === 'admin';
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClinicianRole>('therapist');
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClinic(await getClinic());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clinic.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setInviting(true);
    setError(null);
    try {
      await createInvite(e, role);
      setEmail('');
      setRole('therapist');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setInviting(false);
    }
  };

  const runMemberAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        {error ?? 'No clinic to show.'}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-border bg-card shrink-0">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
          <Building2 className="size-3" /> Clinic
        </p>
        <h2 className="text-xl sm:text-2xl mt-0.5" style={{ fontFamily: 'var(--font-serif)' }}>
          {clinic.name}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {clinic.members.length} member{clinic.members.length !== 1 ? 's' : ''}
          {isAdmin ? ' · You are an admin' : ' · You are a therapist'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-8">

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">⚠️ {error}</div>
          )}

          {/* Invite form — admins only */}
          {isAdmin && (
            <section>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
                Invite a therapist
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleInvite(); }}
                  type="email"
                  placeholder="teammate@yourclinic.com"
                  className="flex-1 bg-card border border-border px-4 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as ClinicianRole)}
                  className="bg-card border border-border px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
                >
                  <option value="therapist">Therapist</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => void handleInvite()}
                  disabled={!email.trim() || inviting}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Invite
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                They join when they sign in with this Google email via the “My clinic” path.
              </p>
            </section>
          )}

          {/* Pending invites */}
          {clinic.pendingInvites.length > 0 && (
            <section>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
                Pending invites
              </p>
              <div className="space-y-2">
                {clinic.pendingInvites.map((inv) => (
                  <div key={inv.inviteId} className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl">
                    <Mail className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{inv.email}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>{inv.role}</div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => void runMemberAction(inv.inviteId, () => revokeInvite(inv.inviteId))}
                        disabled={busyId === inv.inviteId}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        {busyId === inv.inviteId ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Members */}
          <section>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
              Members
            </p>
            <div className="space-y-2">
              {clinic.members.map((m) => {
                const isSelf = m.id === clinician.id;
                return (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl">
                    <div className="size-8 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">
                      {m.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {m.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-1 rounded-md ${m.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-secondary text-muted-foreground'}`} style={{ fontFamily: 'var(--font-mono)' }}>
                      {m.role === 'admin' && <Shield className="size-3" />}{m.role}
                    </span>
                    {isAdmin && !isSelf && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void runMemberAction(m.id, () => updateMemberRole(m.id, m.role === 'admin' ? 'therapist' : 'admin'))}
                          disabled={busyId === m.id}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                        >
                          {m.role === 'admin' ? 'Make therapist' : 'Make admin'}
                        </button>
                        <button
                          onClick={() => void runMemberAction(m.id, () => removeMember(m.id))}
                          disabled={busyId === m.id}
                          title="Remove from clinic"
                          className="text-muted-foreground hover:text-red-600 transition-colors"
                        >
                          {busyId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <UserMinus className="size-3.5" />}
                        </button>
                      </div>
                    )}
                    {isSelf && !isAdmin && <Check className="size-4 text-green-600 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
