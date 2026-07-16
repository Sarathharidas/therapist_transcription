import { fetchWithAuth, withNetworkRetry } from './base';

export type Plan = {
  tier: string;
  name: string;
  hours: number;
  price: number;        // rupees, GST-inclusive
  description: string;
  configured: boolean;  // false until the Razorpay plan is set up
};

export type Subscription = {
  status: string;       // trial | active | past_due | cancelled | none
  plan: string | null;
  planName: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  hoursBalance: number;
  hoursUsed: number;
  currentPeriodEnd: string | null;
  plans: Plan[];
};

export async function getSubscription(): Promise<Subscription> {
  const resp = await withNetworkRetry(() => fetchWithAuth('/api/billing/subscription'));
  if (!resp.ok) throw new Error(`Failed to load subscription: ${resp.status}`);
  const d = (await resp.json()) as Record<string, unknown>;
  return {
    status: d.status as string,
    plan: (d.plan as string) ?? null,
    planName: (d.plan_name as string) ?? null,
    trialEndsAt: (d.trial_ends_at as string) ?? null,
    trialDaysLeft: (d.trial_days_left as number) ?? null,
    hoursBalance: (d.hours_balance as number) ?? 0,
    hoursUsed: (d.hours_used as number) ?? 0,
    currentPeriodEnd: (d.current_period_end as string) ?? null,
    plans: ((d.plans as Plan[]) ?? []).map((p) => ({
      tier: p.tier, name: p.name, hours: p.hours, price: p.price,
      description: p.description, configured: p.configured,
    })),
  };
}

export async function subscribe(tier: string): Promise<{ subscriptionId: string; keyId: string }> {
  const resp = await fetchWithAuth('/api/billing/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }
  const d = (await resp.json()) as { subscription_id: string; key_id: string };
  return { subscriptionId: d.subscription_id, keyId: d.key_id };
}

// Lazily load the Razorpay Checkout script.
export function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
