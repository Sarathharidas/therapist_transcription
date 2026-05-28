import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Lock, Search, UserPlus, ArrowRight, Mic, X, Check } from "lucide-react";

export const Route = createFileRoute("/")({
  component: SessionWorkspace,
});

type Patient = { id: string; name: string; lastSeen?: string };

const initialPatients: Patient[] = [
  { id: "p1", name: "Julianna Sterling", lastSeen: "14 MAR 2024" },
  { id: "p2", name: "Marcus Thorne", lastSeen: "12 MAR 2024" },
  { id: "p3", name: "Elena Rossi", lastSeen: "11 MAR 2024" },
  { id: "p4", name: "David Park", lastSeen: "08 MAR 2024" },
  { id: "p5", name: "Arthur Pemberton", lastSeen: "05 MAR 2024" },
];

const pastSessions = [
  { date: "14 MAR 2024", name: "Julianna Sterling", note: "Generalized anxiety follow-up..." },
  { date: "12 MAR 2024", name: "Marcus Thorne", note: "Initial intake: Sleep hygiene..." },
  { date: "11 MAR 2024", name: "Elena Rossi", note: "CBT Session 4: Reframing..." },
  { date: "08 MAR 2024", name: "David Park", note: "Grief processing — week 3..." },
  { date: "05 MAR 2024", name: "Arthur Pemberton", note: "Workplace transition anxiety..." },
];

const transcript = [
  { t: "00:00", speaker: "Dr. Aris", text: "Good morning. How are you feeling after our last conversation about the transition at work?" },
  { t: "00:14", speaker: "Patient", text: "Honestly, I felt lighter for a few days. But then the email from the board arrived on Tuesday, and that physical tightness in my chest returned. It's like I'm waiting for a shoe to drop that doesn't even exist." },
  { t: "02:45", speaker: "Dr. Aris", text: "Let's sit with that word \"wait.\" What are you waiting for, specifically?" },
  { t: "03:12", speaker: "Patient", text: "A grey fog. It doesn't have a face. It just... looms. I find myself checking my phone every six minutes, even though I know nothing has changed.", highlight: true },
  { t: "05:30", speaker: "Dr. Aris", text: "That checking behavior — when did you notice it starting? Is it tied to the email itself, or to the silence after it?" },
  { t: "05:58", speaker: "Patient", text: "The silence. Definitely the silence. The not-knowing is heavier than any answer could be." },
];

type View = "select" | "session";

function SessionWorkspace() {
  const [patients, setPatients] = useState<Patient[]>(initialPatients);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [view, setView] = useState<View>("select");
  const [addOpen, setAddOpen] = useState(false);

  const goToSession = (p: Patient) => {
    setSelected(p);
    setView("session");
  };

  const addPatient = (name: string) => {
    const p: Patient = { id: `p${Date.now()}`, name };
    setPatients((prev) => [p, ...prev]);
    setAddOpen(false);
    goToSession(p);
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground antialiased overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 bg-sidebar border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <button
            onClick={() => setView("select")}
            className="text-2xl italic block text-left"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Aura Clinical
          </button>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2" style={{ fontFamily: "var(--font-mono)" }}>
            Authenticated / Dr. Aris
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-4">
            Recent Notes
          </div>
          {pastSessions.map((s) => (
            <button
              key={s.name}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                selected?.name === s.name
                  ? "bg-card border-border"
                  : "border-transparent hover:bg-card/60"
              }`}
            >
              <div className="text-xs text-muted-foreground mb-1" style={{ fontFamily: "var(--font-mono)" }}>{s.date}</div>
              <div className="text-sm font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground truncate">{s.note}</div>
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-border">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Lock className="size-3.5" />
            <span>HIPAA Encrypted</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — Add new patient always available */}
        <header className="h-16 px-8 border-b border-border flex items-center justify-between bg-card/40">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
            {view === "select" ? "New Session" : `Session / ${selected?.name}`}
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus className="size-3.5" />
            Add New Patient
          </button>
        </header>

        {view === "select" ? (
          <PatientSelect
            patients={patients}
            onSelect={goToSession}
            onAddNew={() => setAddOpen(true)}
          />
        ) : (
          <SessionView patient={selected!} onBack={() => setView("select")} />
        )}
      </main>

      {addOpen && <AddPatientDialog onClose={() => setAddOpen(false)} onAdd={addPatient} />}
    </div>
  );
}

function PatientSelect({
  patients,
  onSelect,
  onAddNew,
}: {
  patients: Patient[];
  onSelect: (p: Patient) => void;
  onAddNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => patients.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [patients, query],
  );

  const exactMatch = patients.find((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="flex-1 flex items-center justify-center px-8">
      <div className="w-full max-w-xl">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-6" style={{ fontFamily: "var(--font-mono)" }}>
          Step 01 / Begin
        </div>
        <h1 className="text-5xl leading-tight mb-4" style={{ fontFamily: "var(--font-serif)" }}>
          Let's get started.
        </h1>
        <p className="text-muted-foreground text-lg mb-12">
          Add your patient's name to open a new session.
        </p>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: "var(--font-mono)" }}>
          Patient
        </label>

        <div className="relative">
          <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-2 pl-4 shadow-sm focus-within:border-accent/60 transition-colors">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) {
                  if (exactMatch) onSelect(exactMatch);
                  else if (filtered[0]) onSelect(filtered[0]);
                }
              }}
              placeholder="Select existing or type a new name…"
              className="flex-1 bg-transparent text-base focus:outline-none placeholder:text-muted-foreground/60"
            />
            <button
              disabled={!query.trim() && !exactMatch}
              onClick={() => {
                if (exactMatch) onSelect(exactMatch);
                else if (query.trim()) onSelect({ id: `tmp-${Date.now()}`, name: query.trim() });
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Continue
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          {open && (
            <div className="absolute z-10 left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
              {filtered.length > 0 ? (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(p);
                    }}
                    className="w-full flex items-center justify-between text-left px-4 py-3 hover:bg-secondary transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.lastSeen && (
                        <div className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-mono)" }}>
                          Last seen {p.lastSeen}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted-foreground">No matches.</div>
              )}
              {query.trim() && !exactMatch && (
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAddNew();
                  }}
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

        <p className="text-xs text-muted-foreground mt-6">
          Tip: press <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-[10px]">Enter</kbd> to continue.
        </p>
      </div>
    </div>
  );
}

function SessionView({ patient, onBack }: { patient: Patient; onBack: () => void }) {
  const [phase, setPhase] = useState<"ready" | "recording" | "done">("ready");
  const [notes, setNotes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "recording") return;
    startedAt.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      if (startedAt.current != null) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "ready") setElapsed(0);
  }, [phase]);

  const formatted = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;



  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Session header */}
      <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-card">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
            Patient
          </div>
          <h2 className="text-2xl mt-1" style={{ fontFamily: "var(--font-serif)" }}>
            {patient.name}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Change patient
          </button>
          {phase === "ready" && (
            <button
              onClick={() => setPhase("recording")}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
            >
              <Mic className="size-4" />
              Start Session
            </button>
          )}
          {phase === "recording" && (
            <div className="flex items-center gap-3 bg-secondary border border-border rounded-xl px-3 py-2">
              <div className="size-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                Recording
              </span>
              <div className="flex gap-0.5 h-4 items-end">
                {[2, 3, 4, 2, 3, 4, 2, 3, 4, 2].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-accent rounded-full"
                    style={{ height: `${h * 4}px`, opacity: i % 3 === 0 ? 0.5 : 1 }}
                  />
                ))}
              </div>
              <span className="text-xs font-medium tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{formatted}</span>
              <button
                onClick={() => setPhase("done")}
                className="ml-2 px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                Stop
              </button>
            </div>
          )}
          {phase === "done" && (
            <button
              onClick={() => setPhase("ready")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground text-xs font-medium rounded-lg hover:bg-secondary/70 transition-colors"
            >
              <Check className="size-3.5" />
              Session complete
            </button>
          )}
        </div>
      </div>

      {phase === "done" ? (
        <div className="flex-1 overflow-hidden flex">
          {/* Transcript */}
          <section className="flex-[1.2] overflow-y-auto p-12 bg-card border-r border-border animate-fade-in">
            <div className="max-w-[65ch] mx-auto">
              <div className="mb-12">
                <span className="text-[11px] tracking-widest text-muted-foreground uppercase" style={{ fontFamily: "var(--font-mono)" }}>
                  Full Transcript
                </span>
                <h2 className="text-4xl mt-4" style={{ fontFamily: "var(--font-serif)" }}>
                  {patient.name}
                </h2>
                <p className="text-muted-foreground mt-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                  Recorded today • 42 minutes
                </p>
              </div>

              <div className="space-y-8 text-pretty leading-relaxed text-[15px]">
                {transcript.map((line, i) => (
                  <div
                    key={i}
                    className={`flex gap-6 ${
                      line.highlight
                        ? "bg-accent/5 -mx-4 px-4 py-3 rounded-lg border-l-2 border-accent/30"
                        : ""
                    }`}
                  >
                    <span
                      className={`text-[10px] w-10 pt-1 ${line.highlight ? "text-accent" : "text-muted-foreground/60"}`}
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {line.t}
                    </span>
                    <div className="flex-1">
                      <p>
                        <strong className="font-medium">{line.speaker}:</strong> {line.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Summary + Notes */}
          <section className="flex-1 bg-background overflow-y-auto p-12 animate-fade-in" style={{ animationDelay: "200ms" }}>
            <div className="max-w-md">
              <div className="mb-10">
                <div className="inline-flex items-center gap-2 bg-accent/10 px-3 py-1 rounded-full">
                  <div className="size-1.5 bg-accent rounded-full" />
                  <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
                    AI Synthesis
                  </span>
                </div>
                <h3 className="text-xl font-semibold mt-4">Summary</h3>
              </div>

              <div className="space-y-8">
                <p className="text-sm leading-relaxed text-foreground/90">
                  Patient returned to discuss ongoing anticipatory anxiety connected to a recent board communication. They reported a brief
                  improvement followed by a return of somatic chest tightness, describing the threat as a faceless "grey fog." They identified
                  ambiguity and silence — rather than any specific outcome — as the primary source of distress, evidenced by a compulsive
                  phone-checking pattern occurring roughly every six minutes.
                </p>

                <div>
                  <h4 className="text-[11px] text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)" }}>
                    Key Moments
                  </h4>
                  <ul className="space-y-3">
                    <li className="text-sm border-l-2 border-border pl-4">
                      <span className="block font-medium">Chest tightness (00:14)</span>
                    </li>
                    <li className="text-sm border-l-2 border-border pl-4">
                      <span className="block font-medium">Fog metaphor (03:12)</span>
                    </li>
                    <li className="text-sm border-l-2 border-border pl-4">
                      <span className="block font-medium">Silence aversion (05:58)</span>
                    </li>
                  </ul>
                </div>

                <div className="p-6 bg-card border border-border rounded-xl shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[11px] text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)" }}>
                      Clinician Notes
                    </h4>
                    <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                      Private
                    </span>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Write your observations, reflections, or next steps for this session…"
                    className="w-full min-h-[160px] bg-background border border-border rounded-lg p-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder:text-muted-foreground/60"
                  />
                  <button className="w-full mt-3 py-2 bg-secondary hover:bg-secondary/70 text-xs font-semibold rounded-lg transition-colors">
                    Save Notes
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center max-w-md">
            <button
              type="button"
              onClick={() => {
                if (phase === "ready") setPhase("recording");
                else if (phase === "recording") setPhase("done");
              }}
              aria-label={phase === "recording" ? "Stop session" : "Start session"}
              className={`group relative mx-auto size-24 rounded-full flex items-center justify-center mb-8 transition-all hover:scale-105 active:scale-95 ${
                phase === "recording" ? "bg-red-500/10 hover:bg-red-500/20" : "bg-accent/10 hover:bg-accent/20"
              }`}
            >
              {phase === "recording" && (
                <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
              )}
              <Mic className={`size-10 relative ${phase === "recording" ? "text-red-500" : "text-accent"}`} />
            </button>
            <h2 className="text-3xl mb-3" style={{ fontFamily: "var(--font-serif)" }}>
              {phase === "recording" ? "Listening…" : "Ready when you are"}
            </h2>
            <p className="text-muted-foreground">
              {phase === "recording"
                ? "Speak naturally. The session is being transcribed privately."
                : `Tap the microphone to start recording with ${patient.name}.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPatientDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 size-8 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: "var(--font-mono)" }}>
          New Patient
        </div>
        <h3 className="text-2xl mb-6" style={{ fontFamily: "var(--font-serif)" }}>
          Add a patient
        </h3>

        <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: "var(--font-mono)" }}>
          Full name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onAdd(name.trim());
          }}
          placeholder="e.g. Arthur Pemberton"
          className="w-full bg-background border border-border px-4 py-3 text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40"
        />

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onAdd(name.trim())}
            className="inline-flex items-center gap-2 px-5 py-2 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            Add & Start Session
          </button>
        </div>
      </div>
    </div>
  );
}
