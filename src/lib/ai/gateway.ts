// A-06 / A-07 — Provider-agnostic AI gateway.
// "Whatever key is added and it works": providers are rows in the DB with a
// priority order. The gateway tries each enabled provider in turn and falls
// back to the deterministic heuristic estimator when none is configured.
// Server-side only. Keys are never returned to the client (masked only).
// Phase 5 (A-07): every attempt is logged (AiCallLog: latency, cost, outcome)
// and crossing a provider budget raises an AI_BUDGET notification once.
import { db } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";

export interface EstimateResult {
  estimatePct: number;
  basis: string;
}

interface ProviderRow {
  id: string;
  name: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  priority: number;
  monthlyBudgetCents: number;
  spentCents: number;
}

export async function estimateWithAi(question: string, marketPct: number, cacheLabel: "NONE" | "MISS" = "NONE"): Promise<EstimateResult | null> {
  const prompt =
    `You are a calibrated probability forecaster. Question: "${question}". ` +
    `A prediction market currently implies ${marketPct}% probability for YES. ` +
    `Reply with ONLY a number 0-100: your estimate of the true probability. No explanation.`;
  const out = await runProviders(prompt, 16, cacheLabel, (text, p) => parseEstimate(text, `ai:${p.name}/${p.model}`));
  return out?.result ?? null;
}

// Ask FAIDA: an estimate WITH a short plain-language explanation. Same
// provider order, budget gate and call log as estimateWithAi. The model
// answers from its training knowledge; it does not browse, and the caller
// labels it that way. marketPct null = no market price exists for the question.
export interface ExplainResult { estimatePct: number; reasoning: string; provider: string; model: string }
export async function explainWithAi(question: string, marketPct: number | null): Promise<ExplainResult | null> {
  const prompt =
    `You are a careful, calibrated probability forecaster. Question: "${question}". ` +
    (marketPct != null ? `A prediction market currently implies ${marketPct}% for YES. ` : `There is no market price for this question. `) +
    `Give your own probability that the answer is YES, and explain briefly in plain language for a non-expert ` +
    `(at most 3 short sentences; say what would change your mind; admit uncertainty about recent events you may not know). ` +
    `Reply exactly in this format:\nPROBABILITY: <0-100>\nREASONING: <text>`;
  const out = await runProviders(prompt, 300, "NONE", (text, p) => {
    const pm = text.match(/PROBABILITY:\s*(\d{1,3})/i);
    const rm = text.match(/REASONING:\s*([\s\S]+)/i);
    if (!pm) return null;
    const pct = parseInt(pm[1], 10);
    if (pct < 0 || pct > 100) return null;
    return { estimatePct: pct, reasoning: (rm?.[1] ?? "").trim().slice(0, 900), provider: p.name, model: p.model };
  });
  return out?.result ?? null;
}

async function runProviders<T>(prompt: string, maxTokens: number, cacheLabel: "NONE" | "MISS", parse: (text: string, p: ProviderRow) => T | null): Promise<{ result: T } | null> {
  const providers = await db.aiProvider.findMany({
    where: { enabled: true, OR: [{ apiKey: { not: null } }, { name: "GLM" }] }, // GLM runs keyless via SDK
    orderBy: { priority: "asc" },
  });
  for (const p of providers) {
    if (p.spentCents >= p.monthlyBudgetCents) {
      // A-07: budget gate per provider — the blocked attempt is logged so the
      // governance card shows WHY an estimate came from the heuristic.
      await logCall({ provider: p.name, model: p.model, latencyMs: 0, costCents: 0, outcome: "BUDGET_BLOCKED", cache: "NONE" });
      continue;
    }
    const t0 = Date.now();
    try {
      const text = await callProvider(p, prompt, maxTokens);
      const latencyMs = Date.now() - t0;
      const result = text == null ? null : parse(text, p);
      if (text != null && result == null) console.error(`[ai-gateway] ${p.name} reply not parseable:`, text.slice(0, 120));
      if (result) {
        const before = p.spentCents;
        const after = await db.aiProvider.update({ where: { id: p.id }, data: { spentCents: { increment: 2 } }, select: { spentCents: true } }); // ~$0.02/call bookkeeping
        await logCall({ provider: p.name, model: p.model, latencyMs, costCents: 2, outcome: "OK", cache: cacheLabel });
        await maybeBudgetNotification(p, before, after.spentCents);
        return { result };
      }
      await logCall({ provider: p.name, model: p.model, latencyMs, costCents: 0, outcome: "FAILED", cache: cacheLabel });
    } catch (e) {
      await logCall({ provider: p.name, model: p.model, latencyMs: Date.now() - t0, costCents: 0, outcome: "FAILED", cache: cacheLabel });
      // try the next provider; failures are never silent in production logs
      console.error("[ai-gateway] provider attempt failed:", String(e).slice(0, 160));
    }
  }
  return null; // caller falls back to the heuristic estimator
}

async function logCall(row: { provider: string; model: string; latencyMs: number; costCents: number; outcome: string; cache: string }) {
  try {
    await db.aiCallLog.create({
      data: { providerName: row.provider, model: row.model, latencyMs: row.latencyMs, costCents: row.costCents, outcome: row.outcome, cache: row.cache },
    });
  } catch {
    // logging must never break estimation
  }
}

// A-07: crossing 100% of a provider budget raises ONE AI_BUDGET notification
// (guarded by the before/after comparison — no storms).
let budgetNotified = new Set<string>();
async function maybeBudgetNotification(p: ProviderRow, before: number, after: number): Promise<void> {
  if (before < p.monthlyBudgetCents && after >= p.monthlyBudgetCents && !budgetNotified.has(p.name)) {
    budgetNotified.add(p.name);
    const user = await db.user.findUnique({ where: { email: "founder@faida.local" }, select: { id: true } });
    if (user) {
      // P-04 taxonomy: AI_BUDGET — capped + digested; the in-process guard
      // stays as a second layer, the dedupe window as the durable one.
      await notifyUser(user.id, {
        family: "AI_BUDGET",
        severity: "WARNING",
        title: `AI provider ${p.name} hit its monthly budget`,
        body: `Spend ${after}¢ reached the ${p.monthlyBudgetCents}¢ budget — further AI estimates fall back to the heuristic baseline until the budget is raised or the month resets.`,
        dedupeKey: `budget:${p.name}`,
      });
    }
  }
}

export function resetBudgetNotificationGuard(): void {
  budgetNotified.clear();
}

// One provider call: returns the raw reply text (null = failed / no answer).
// Parsing is the caller's job so the same transport serves every prompt.
async function callProvider(p: ProviderRow, prompt: string, maxTokens: number): Promise<string | null> {

  if (p.name === "GLM") {
    // Z.ai GLM via the sandbox SDK — backend only.
    try {
      const mod = await import("z-ai-web-dev-sdk");
      const ZAI = mod.default;
      const zai = await ZAI.create();
      const completion = (await zai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const text = completion.choices?.[0]?.message?.content ?? "";
      return text ? String(text) : null;
    } catch (e) {
      console.error("[ai-gateway] GLM adapter failed, falling back:", String(e).slice(0, 200));
      return null;
    }
  }

  // OpenAI-compatible (OPENAI, OPENAI_COMPATIBLE) and ANTHROPIC via REST.
  const endpoint =
    p.name === "ANTHROPIC"
      ? `${p.baseUrl ?? "https://api.anthropic.com"}/v1/messages`
      : `${p.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
  const headers: Record<string, string> =
    p.name === "ANTHROPIC"
      ? { "x-api-key": p.apiKey ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" }
      : { Authorization: `Bearer ${p.apiKey ?? ""}`, "content-type": "application/json" };
  const body =
    p.name === "ANTHROPIC"
      ? { model: p.model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }
      : { model: p.model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(maxTokens > 64 ? 25000 : 12000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
  };
  const text = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";
  return text || null;
}

function parseEstimate(text: string, basis: string): EstimateResult | null {
  const m = text.match(/\d{1,3}/);
  if (!m) return null;
  const pct = parseInt(m[0], 10);
  if (pct < 0 || pct > 100) return null;
  return { estimatePct: pct, basis };
}

export function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
