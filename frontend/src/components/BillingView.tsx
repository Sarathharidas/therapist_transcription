import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clock, Loader2, Minus, Plus, Sparkles } from 'lucide-react';
import { getHistory, loadRazorpay, subscribe, type HistoryItem, type Subscription } from '../api/billing';

type Props = {
  subscription: Subscription;
  clinicianName: string;
  onBack: () => void;
  onChanged: () => void; // refetch after a successful subscribe
};

/**
 * Billing dashboard + pricing. Shows the current plan / trial / hours, and the
 * plans to subscribe to via Razorpay Checkout.
 */
export function BillingView({ subscription: sub, clinicianName, onBack, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    getHistory().then(setHistory).catch(() => setHistory([]));
  }, [sub.hoursBalance, sub.status]);

  const handleSubscribe = async (tier: string) => {
    setBusy(tier);
    setError(null);
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error('Could not load the payment window. Check your connection.');
      const { subscriptionId, keyId } = await subscribe(tier);
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
      const rzp = new Razorpay({
        key: keyId,
        subscription_id: subscriptionId,
        name: 'Aura Clinical',
        description: sub.plans.find((p) => p.tier === tier)?.name ?? 'Subscription',
        prefill: { name: clinicianName },
        theme: { color: '#7c5cff' },
        handler: () => { onChanged(); },       // payment authorised → refresh status
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setBusy(null);
    }
  };

  // ── Status banner ──
  const statusBanner = () => {
    if (sub.status === 'trial') {
      return (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-accent/10 border border-accent/30">
          <Sparkles className="size-5 text-accent shrink-0" />
          <div>
            <p className="text-sm font-semibold">You're on a free trial</p>
            <p className="text-xs text-muted-foreground">
              {sub.trialDaysLeft != null ? `${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'} left` : 'Trial active'}
              {' '}· full access. Choose a plan below to continue after it ends.
            </p>
          </div>
        </div>
      );
    }
    if (sub.status === 'active') {
      return (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
          <Check className="size-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{sub.planName} plan · active</p>
            <p className="text-xs text-muted-foreground">
              {sub.hoursBalance.toFixed(1)} hours remaining
              {sub.currentPeriodEnd ? ` · renews ${new Date(sub.currentPeriodEnd).toLocaleDateString('en-IN')}` : ''}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <Clock className="size-5 text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold">
            {sub.status === 'past_due' ? 'Payment overdue' : sub.status === 'cancelled' ? 'Subscription cancelled' : 'No active plan'}
          </p>
          <p className="text-xs text-muted-foreground">Choose a plan below to keep recording sessions.</p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-8 sm:py-12">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          <ArrowLeft className="size-4" /> Back
        </button>

        <h1 className="text-3xl sm:text-4xl mb-2" style={{ fontFamily: 'var(--font-serif)' }}>Plans &amp; usage</h1>
        <p className="text-sm text-muted-foreground mb-6">Hours are pooled per month and unused hours carry forward.</p>

        {statusBanner()}

        {/* Usage snapshot (once subscribed) */}
        {sub.status === 'active' && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-4 bg-card border border-border rounded-xl">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>Hours remaining</p>
              <p className="text-2xl font-semibold mt-1">{sub.hoursBalance.toFixed(1)}</p>
            </div>
            <div className="p-4 bg-card border border-border rounded-xl">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>Hours used</p>
              <p className="text-2xl font-semibold mt-1">{sub.hoursUsed.toFixed(1)}</p>
            </div>
          </div>
        )}

        {/* Plans */}
        <h2 className="text-lg font-semibold mt-10 mb-4">Choose a plan</h2>
        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ {error}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          {sub.plans.map((p) => {
            const isCurrent = sub.status === 'active' && sub.plan === p.tier;
            return (
              <div key={p.tier} className={`p-5 rounded-2xl border ${isCurrent ? 'border-accent bg-accent/5' : 'border-border bg-card'}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <div className="text-right">
                    <span className="text-2xl font-semibold">₹{p.price.toLocaleString('en-IN')}</span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                <p className="text-[11px] text-muted-foreground mt-1">GST included</p>
                <button
                  onClick={() => handleSubscribe(p.tier)}
                  disabled={busy !== null || isCurrent || !p.configured}
                  className="w-full mt-4 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
                >
                  {busy === p.tier && <Loader2 className="size-4 animate-spin" />}
                  {isCurrent ? 'Current plan' : !p.configured ? 'Coming soon' : `Subscribe to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Recent activity — credit top-ups + session usage */}
        {history.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-card text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className={`size-6 rounded-full flex items-center justify-center ${h.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-secondary text-muted-foreground'}`}>
                      {h.type === 'credit' ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                    </span>
                    <span>{h.type === 'credit' ? 'Credit added' : 'Session'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-medium tabular-nums ${h.type === 'credit' ? 'text-green-700' : 'text-foreground'}`}>
                      {h.type === 'credit' ? '+' : '−'}{h.hours}h
                    </span>
                    <span className="text-xs text-muted-foreground">{h.at.slice(0, 10)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
