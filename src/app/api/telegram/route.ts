// Telegram alerts for the signed-in user.
// GET  → { configured, bot, link: { username, linkedAt, prefs } | null }
// POST → { action: "start" | "check" | "prefs" | "test" | "unlink", prefs? }
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { botUsername, checkLinks, getLink, sendTest, startLink, telegramConfigured, updateLink, type TelegramPrefs } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const view = (l: Awaited<ReturnType<typeof getLink>>) => (l ? { username: l.username, linkedAt: l.linkedAt, prefs: l.prefs } : null);

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const configured = telegramConfigured();
  return NextResponse.json({ configured, bot: configured ? await botUsername() : null, link: view(await getLink(auth.ctx.user.id)) });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!telegramConfigured()) return NextResponse.json({ error: "Telegram isn't set up on this server yet (TELEGRAM_BOT_TOKEN missing)." }, { status: 503 });
  const uid = auth.ctx.user.id;
  const body = (await req.json().catch(() => ({}))) as { action?: string; prefs?: Partial<TelegramPrefs> };
  switch (body.action) {
    case "start": {
      const { url } = await startLink(uid);
      if (!url) return NextResponse.json({ error: "Couldn't reach the Telegram bot. Check TELEGRAM_BOT_TOKEN." }, { status: 502 });
      return NextResponse.json({ ok: true, url });
    }
    case "check": {
      await checkLinks();
      const link = await getLink(uid);
      return NextResponse.json({ ok: !!link, link: view(link), error: link ? undefined : "Not connected yet. Open the link, press Start in Telegram, then try again." });
    }
    case "prefs": {
      const prefs = Object.fromEntries(Object.entries(body.prefs ?? {}).filter(([k, v]) => ["trades", "problems", "resolving"].includes(k) && typeof v === "boolean"));
      const link = await updateLink(uid, { prefs });
      return link ? NextResponse.json({ ok: true, link: view(link) }) : NextResponse.json({ error: "Telegram isn't connected." }, { status: 400 });
    }
    case "test": {
      const ok = await sendTest(uid);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't send. Is Telegram connected?" }, { status: 400 });
    }
    case "unlink": {
      await updateLink(uid, { unlink: true });
      return NextResponse.json({ ok: true, link: null });
    }
    default:
      return NextResponse.json({ error: "action must be start, check, prefs, test or unlink" }, { status: 400 });
  }
}
