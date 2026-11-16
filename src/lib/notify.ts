// S-02/F8 — Email fan-out via Resend. The outbox remains the source of truth:
// the in-app notification feed is written by consume(), and email is a
// best-effort channel recorded per-event (emailStatus) — never a dual-write
// dependency. No SDK dependency; the Resend HTTPS API needs only fetch.
const RESEND_API = "https://api.resend.com/emails";

export interface NotifyEnvStatus {
  resendConfigured: boolean;
  from: string | null;
}

const DEFAULT_FROM = "FAIDA Predict <onboarding@resend.dev>";

export function notifyEnvStatus(): NotifyEnvStatus {
  const key = process.env.RESEND_API_KEY;
  return {
    resendConfigured: Boolean(key && key.startsWith("re_")),
    from: process.env.NOTIFY_EMAIL_FROM ?? (key ? DEFAULT_FROM : null),
  };
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not configured" };
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM ?? DEFAULT_FROM,
        to: [to],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Event types that page the user by email (severity-mapped in drainOutbox).
export const EMAIL_EVENT_TYPES = new Set(["RISK_PAUSE", "RECONCILIATION_OPENED", "RECONCILIATION_RESOLVED"]);

export function emailSubjectFor(eventType: string): string {
  if (eventType === "RISK_PAUSE") return "FAIDA — robot paused by risk";
  if (eventType === "RECONCILIATION_OPENED") return "FAIDA — order entered reconciliation (venue state unconfirmed)";
  return "FAIDA — reconciliation resolved";
}
