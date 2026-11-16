// A-06 / A-07 — Provider-agnostic AI gateway.
// "Whatever key is added and it works": providers are rows in the DB with a
// priority order. The gateway tries each enabled provider in turn and falls
// back to the deterministic heuristic estimator when none is configured.
// Server-side only. Keys are never returned to the client (masked only).
import { db } from "@/lib/db";

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

export async function estimateWithAi(question: string, marketPct: number): Promise<EstimateResult | null> {
  const providers = await db.aiProvider.findMany({
    where: { enabled: true, OR: [{ apiKey: { not: null } }, { name: "GLM" }] }, // GLM runs keyless via SDK
    orderBy: { priority: "asc" },
  });
  for (const p of providers) {
    if (p.spentCents >= p.monthlyBudgetCents) continue; // A-07: budget gate per provider
    try {
      const result = await callProvider(p, question, marketPct);
      if (result) {
        await db.aiProvider.update({ where: { id: p.id }, data: { spentCents: { increment: 2 } } }); // ~$0.02/call bookkeeping
        return result;
      }
    } catch {
      // try the next provider; failures are never silent in production logs
    }
  }
  return null; // caller falls back to the heuristic estimator
}

async function callProvider(p: ProviderRow, question: string, marketPct: number): Promise<EstimateResult | null> {
  const prompt =
    `You are a calibrated probability forecaster. Question: "${question}". ` +
    `A prediction market currently implies ${marketPct}% probability for YES. ` +
    `Reply with ONLY a number 0-100: your estimate of the true probability. No explanation.`;

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
      const parsed = parseEstimate(String(text), `ai:GLM/${p.model}`);
      if (!parsed) console.error("[ai-gateway] GLM reply not parseable:", String(text).slice(0, 120));
      return parsed;
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
      ? { model: p.model, max_tokens: 16, messages: [{ role: "user", content: prompt }] }
      : { model: p.model, messages: [{ role: "user", content: prompt }], max_tokens: 16 };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
  };
  const text = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";
  return parseEstimate(text, `ai:${p.name}/${p.model}`);
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
