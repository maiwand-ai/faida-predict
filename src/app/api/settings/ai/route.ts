// AI providers (A-06): any provider key makes the gateway work. Keys are
// write-only — GET returns masked hints only, never the key itself.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function mask(key: string | null): string | null {
  if (!key) return null;
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function GET() {
  const providers = await db.aiProvider.findMany({ orderBy: { priority: "asc" } });
  return NextResponse.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      model: p.model,
      enabled: p.enabled,
      priority: p.priority,
      hasKey: !!p.apiKey,
      keyMasked: mask(p.apiKey),
      baseUrl: p.baseUrl,
      monthlyBudgetCents: p.monthlyBudgetCents,
      spentCents: p.spentCents,
    })),
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    id?: string;
    apiKey?: string | null; // null clears the key
    model?: string;
    enabled?: boolean;
    baseUrl?: string | null;
    priority?: number;
    monthlyBudgetCents?: number;
  };
  if (!body.id) return NextResponse.json({ error: "provider id required" }, { status: 400 });
  const provider = await db.aiProvider.findUnique({ where: { id: body.id } });
  if (!provider) return NextResponse.json({ error: "provider not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.apiKey !== undefined) data.apiKey = body.apiKey && body.apiKey.length > 0 ? body.apiKey : null;
  if (body.model !== undefined) data.model = body.model;
  if (body.enabled !== undefined) {
    // GLM runs keyless inside the sandbox SDK; every other provider needs a key.
    const willHaveKey = body.apiKey !== undefined ? !!body.apiKey : !!provider.apiKey;
    if (body.enabled && !willHaveKey && provider.name !== "GLM") {
      return NextResponse.json({ error: "cannot enable a provider without an API key" }, { status: 400 });
    }
    data.enabled = body.enabled;
  }
  if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl || null;
  if (body.priority !== undefined) data.priority = Math.floor(body.priority);
  if (body.monthlyBudgetCents !== undefined) data.monthlyBudgetCents = Math.max(0, Math.floor(body.monthlyBudgetCents));

  const updated = await db.aiProvider.update({ where: { id: body.id }, data });
  return NextResponse.json({
    ok: true,
    provider: { id: updated.id, name: updated.name, enabled: updated.enabled, keyMasked: mask(updated.apiKey), hasKey: !!updated.apiKey },
  });
}
