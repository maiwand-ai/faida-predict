// Ask FAIDA — type any question, get:
//   • the matching markets on every venue (with each venue's price)
//   • an estimate through the governed estimator path (AI when a provider is
//     enabled, otherwise the built-in estimator, labeled as such)
//   • when an AI provider is enabled: a short plain-language explanation
// Questions are screened (A-06) before they reach any model, AI spend goes
// through the gateway budgets, and asks are rate-limited per user. Asks are
// not robot decisions: nothing is traded and no decision trace is written.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/auth";
import { screenEvidence, sanitizeText } from "@/lib/probability/screening";
import { estimateForMarket } from "@/lib/probability/estimate";
import { explainWithAi } from "@/lib/ai/gateway";
import { coverage } from "@/lib/matching";

export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const recent = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = auth.ctx.user.id;
  const now = Date.now();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return NextResponse.json({ error: "You're asking very fast. Wait a moment and try again." }, { status: 429 });
  recent.set(uid, [...hits, now]);

  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = sanitizeText(String(body.q ?? "")).trim();
  if (q.length < 6) return NextResponse.json({ error: "Ask a full question, e.g. “Will Bitcoin be above $150k by the end of 2026?”" }, { status: 400 });
  if (q.length > 300) return NextResponse.json({ error: "Keep the question under 300 characters." }, { status: 400 });
  const screen = screenEvidence(q);
  if (screen.flagged) return NextResponse.json({ error: "That question can't be processed. Try rephrasing it as a plain yes/no question." }, { status: 422 });

  // markets: open, unambiguous, priced; ranked by how much of the question they cover
  const markets = await db.market.findMany({
    where: { resolvedAt: null, ambiguityFlag: false, yesPriceCents: { not: null } },
    select: { id: true, venue: true, question: true, yesPriceCents: true, noPriceCents: true, closeDate: true, dataSource: true, volumeCents: true },
    take: 5000,
  });
  const ranked = markets
    .map((m) => ({ m, score: coverage(q, m.question) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score || Number(b.m.volumeCents ?? 0) - Number(a.m.volumeCents ?? 0))
    .slice(0, 6);
  const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0].m : null;

  const aiProviders = await db.aiProvider.count({ where: { enabled: true, OR: [{ apiKey: { not: null } }, { name: "GLM" }] } });
  const aiAvailable = aiProviders > 0;

  let estimate: null | { pct: number; kind: "AI" | "BUILT_IN"; basis: string; reasoning: string | null; provider: string | null; aboutMarket: boolean } = null;
  if (best) {
    const est = await estimateForMarket({
      question: best.question, yesPriceCents: best.yesPriceCents, noPriceCents: best.noPriceCents,
      marketId: best.id, venue: best.venue, dataSource: best.dataSource, estimatorTiltPct: 25,
    });
    const explained = aiAvailable ? await explainWithAi(best.question, best.yesPriceCents) : null;
    estimate = explained
      ? { pct: explained.estimatePct, kind: "AI", basis: `ai:${explained.provider}/${explained.model}`, reasoning: explained.reasoning || null, provider: explained.provider, aboutMarket: true }
      : { pct: est.estimatePct, kind: est.provenance.kind === "AI" ? "AI" : "BUILT_IN", basis: est.basis, reasoning: null, provider: est.provenance.provider ?? null, aboutMarket: true };
  } else if (aiAvailable) {
    const explained = await explainWithAi(q, null);
    if (explained) estimate = { pct: explained.estimatePct, kind: "AI", basis: `ai:${explained.provider}/${explained.model}`, reasoning: explained.reasoning || null, provider: explained.provider, aboutMarket: false };
  }

  return NextResponse.json({
    question: q,
    matches: ranked.map(({ m, score }) => ({
      id: m.id, venue: m.venue, question: m.question, yesPriceCents: m.yesPriceCents, noPriceCents: m.noPriceCents,
      closeDate: m.closeDate?.toISOString() ?? null, match: Math.round(score * 100),
    })),
    bestMarketId: best?.id ?? null,
    estimate,
    aiAvailable,
  });
}
