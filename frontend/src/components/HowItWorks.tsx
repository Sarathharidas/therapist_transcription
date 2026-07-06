import { ArrowLeft, FileText, Lock, MicOff, Mic, ShieldCheck, Trash2, UserCheck, Check, X } from 'lucide-react';

type Props = {
  onBack: () => void;
};

/**
 * "How it works" — a privacy / trust page. Reassures clinicians that sessions
 * are private and, above all, that no audio is ever stored. Every claim here
 * reflects the actual implementation (audio deleted after transcription;
 * transcripts/summaries/notes encrypted at rest; TLS in transit; per-therapist
 * data isolation).
 */
export function HowItWorks({ onBack }: Props) {
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-8 sm:py-14">

        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-4" /> Back
        </button>

        {/* ── Hero ── */}
        <p className="text-[11px] uppercase tracking-widest text-accent mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
          Privacy, by design
        </p>
        <h1 className="text-3xl sm:text-5xl leading-[1.1] mb-5" style={{ fontFamily: 'var(--font-serif)' }}>
          Your sessions stay yours.
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-12">
          The conversation between you and your client is the most sensitive thing there is.
          So Aura is built around a simple promise: the recording is never kept. Here's exactly
          how every session is protected.
        </p>

        {/* ── The headline promise ── */}
        <div className="p-6 sm:p-8 bg-card border border-border rounded-2xl mb-14 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <MicOff className="size-6 text-accent" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl mb-2" style={{ fontFamily: 'var(--font-serif)' }}>
                We never keep your audio.
              </h2>
              <p className="text-sm sm:text-[15px] text-foreground/80 leading-relaxed">
                The moment your words become a transcript, the recording is permanently and
                irreversibly deleted — not archived on your device, not saved on our servers,
                not stored anywhere. There is no recording to leak, to lose, or to be handed
                over. It simply stops existing.
              </p>
            </div>
          </div>
        </div>

        {/* ── How a session works ── */}
        <h2 className="text-xl sm:text-2xl mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          How a session works
        </h2>
        <ol className="space-y-4 mb-14">
          {[
            { icon: Mic, title: 'You speak', body: 'Audio is captured live in your browser — only while you’re recording, and only to be turned into text.' },
            { icon: FileText, title: 'It becomes text', body: 'Your session is transcribed and distilled into clear clinical notes.' },
            { icon: Trash2, title: 'The audio is destroyed', body: 'The instant the transcript exists, the recording is permanently deleted. This step is not optional and cannot be turned off.' },
            { icon: Lock, title: 'Your notes are locked away', body: 'The transcript, summary, and your private notes are encrypted and stored for your eyes only.' },
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-4 p-4 sm:p-5 bg-card border border-border rounded-xl">
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-mono text-muted-foreground w-4 text-right" style={{ fontFamily: 'var(--font-mono)' }}>{i + 1}</span>
                <div className="size-9 rounded-lg bg-secondary flex items-center justify-center">
                  <step.icon className="size-4 text-accent" />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-0.5">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* ── Safeguards grid ── */}
        <h2 className="text-xl sm:text-2xl mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          What keeps it private
        </h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-14">
          {[
            { icon: Lock, title: 'Encrypted at rest', body: 'Every transcript, summary, and note is encrypted in our database. Even a breach would reveal only unreadable ciphertext.' },
            { icon: ShieldCheck, title: 'Encrypted in transit', body: 'Your data travels over the same bank-grade encrypted connections (TLS) at every step.' },
            { icon: UserCheck, title: 'Yours, and yours alone', body: 'Your patients and sessions are visible only to you — never shared with other therapists, even inside a clinic.' },
            { icon: MicOff, title: 'No recordings, ever', body: 'We don’t store audio. Full stop. The one thing that can never leak is the thing that doesn’t exist.' },
          ].map((card, i) => (
            <div key={i} className="p-5 bg-card border border-border rounded-xl">
              <div className="size-9 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
                <card.icon className="size-4 text-accent" />
              </div>
              <h3 className="text-sm font-semibold mb-1">{card.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>

        {/* ── What we keep vs. never keep ── */}
        <div className="grid sm:grid-cols-2 gap-3 mb-14">
          <div className="p-5 bg-card border border-border rounded-xl">
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
              What we keep (encrypted)
            </h3>
            <ul className="space-y-2 text-sm text-foreground/80">
              {['The written transcript', 'The clinical summary', 'Your private notes'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="size-4 text-green-600 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-5 bg-card border border-border rounded-xl">
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3" style={{ fontFamily: 'var(--font-mono)' }}>
              What we never keep
            </h3>
            <ul className="space-y-2 text-sm text-foreground/80">
              <li className="flex items-center gap-2">
                <X className="size-4 text-red-500 shrink-0" /> Your audio recording. Period.
              </li>
            </ul>
          </div>
        </div>

        {/* ── Close ── */}
        <div className="p-6 sm:p-8 bg-secondary/40 border border-border rounded-2xl text-center">
          <p className="text-base sm:text-lg text-foreground/90 leading-relaxed mb-5" style={{ fontFamily: 'var(--font-serif)' }}>
            Privacy isn't a setting you switch on. It's how Aura is built — so you can focus on
            your client, not on what happens to their words.
          </p>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
          >
            Back to sessions
          </button>
        </div>

      </div>
    </div>
  );
}
