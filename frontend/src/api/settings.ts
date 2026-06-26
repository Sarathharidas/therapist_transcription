import { fetchWithAuth } from './base';

export type SummaryFormat = {
  format: string;     // effective format (custom if set, else the default)
  isDefault: boolean; // true when the therapist has not customised it
  default: string;    // the built-in default, for "Reset to default"
};

type SummaryFormatOut = {
  format: string;
  is_default: boolean;
  default: string;
};

function toSummaryFormat(o: SummaryFormatOut): SummaryFormat {
  return { format: o.format, isDefault: o.is_default, default: o.default };
}

export async function getSummaryFormat(): Promise<SummaryFormat> {
  const resp = await fetchWithAuth('/api/settings/summary-format');
  if (!resp.ok) throw new Error(`Failed to load summary format: ${resp.status}`);
  return toSummaryFormat((await resp.json()) as SummaryFormatOut);
}

// Save a custom format. Pass an empty string to reset to the built-in default.
export async function saveSummaryFormat(format: string): Promise<SummaryFormat> {
  const resp = await fetchWithAuth('/api/settings/summary-format', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });
  if (!resp.ok) throw new Error(`Failed to save summary format: ${resp.status}`);
  return toSummaryFormat((await resp.json()) as SummaryFormatOut);
}
