// F8 — Notification dispatcher status. Env-driven (Resend), so this is
// read-only: honest reporting of what email fan-out will actually do.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyEnvStatus } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = notifyEnvStatus();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sent, failed, noKey] = await Promise.all([
    db.outboxEvent.count({ where: { emailStatus: "SENT", createdAt: { gte: since } } }),
    db.outboxEvent.count({ where: { emailStatus: "FAILED", createdAt: { gte: since } } }),
    db.outboxEvent.count({ where: { emailStatus: "NO_KEY", createdAt: { gte: since } } }),
  ]);
  return NextResponse.json({
    ...status,
    last24h: { sent, failed, noKey },
    note: status.resendConfigured
      ? "Email fan-out active — RISK_PAUSE and reconciliation events page the user via Resend."
      : "Set RESEND_API_KEY (and optional NOTIFY_EMAIL_FROM) in the environment to enable email fan-out. The in-app notification feed works regardless.",
  });
}
