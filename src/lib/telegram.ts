// Telegram alerts. Best-effort side channel, like email: the outbox and the
// in-app feed stay the source of truth, and a Telegram failure never fails
// or blocks an event.
//
// Secrets: TELEGRAM_BOT_TOKEN lives in the server environment only (never in
// the database, never returned by an API) — same discipline as the venue keys.
//
// Linking (works without a public URL): the user gets a one-time code and a
// t.me/<bot>?start=<code> link; after sending /start to the bot they press
// "I've sent it" and FAIDA reads the bot's recent updates to find their chat.
// Links + preferences are stored per user in PlatformControl.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getControl, setControl } from "@/lib/control";

// TELEGRAM_API_BASE is for tests only (a local fake server); production uses Telegram.
const API = process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org";
const LINKS_KEY = "TELEGRAM_LINKS";
const PENDING_KEY = "TELEGRAM_PENDING";
const OFFSET_KEY = "TELEGRAM_UPDATE_OFFSET";
const CODE_TTL_MS = 15 * 60_000;

export interface TelegramPrefs { trades: boolean; problems: boolean; resolving: boolean }
export interface TelegramLink { chatId: number; username: string | null; linkedAt: string; prefs: TelegramPrefs; resolvingSent: string[] }
type Links = Record<string, TelegramLink>;
type Pending = Record<string, { userId: string; exp: number }>;

export const DEFAULT_PREFS: TelegramPrefs = { trades: true, problems: true, resolving: true };

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
export const telegramConfigured = () => !!token();

async function tg<T>(method: string, body?: Record<string, unknown>): Promise<T | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!json?.ok) {
      console.error(`[telegram] ${method} failed: ${json?.description ?? res.status}`); // token never logged
      return null;
    }
    return json.result ?? null;
  } catch (e) {
    console.error(`[telegram] ${method} error:`, String(e).slice(0, 120));
    return null;
  }
}

let botName: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (botName) return botName;
  const me = await tg<{ username?: string }>("getMe");
  botName = me?.username ?? null;
  return botName;
}

export const getLinks = () => getControl<Links>(LINKS_KEY, {});
export async function getLink(userId: string): Promise<TelegramLink | null> {
  return (await getLinks())[userId] ?? null;
}

export async function startLink(userId: string): Promise<{ code: string; url: string | null }> {
  const code = randomBytes(5).toString("hex");
  const pending = await getControl<Pending>(PENDING_KEY, {});
  const now = Date.now();
  const fresh: Pending = Object.fromEntries(Object.entries(pending).filter(([, p]) => p.exp > now && p.userId !== userId));
  fresh[code] = { userId, exp: now + CODE_TTL_MS };
  await setControl(PENDING_KEY, fresh);
  const name = await botUsername();
  return { code, url: name ? `https://t.me/${name}?start=${code}` : null };
}

/** Read the bot's recent messages for "/start <code>" and link matching chats. */
export async function checkLinks(): Promise<number> {
  const offset = await getControl<number>(OFFSET_KEY, 0);
  const updates = await tg<Array<{ update_id: number; message?: { text?: string; chat?: { id: number; username?: string } } }>>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
  if (!updates || updates.length === 0) return 0;
  const pending = await getControl<Pending>(PENDING_KEY, {});
  const links = await getLinks();
  let linked = 0;
  for (const u of updates) {
    const m = u.message?.text?.match(/^\/start\s+([a-f0-9]{10})\b/);
    const chat = u.message?.chat;
    if (!m || !chat) continue;
    const p = pending[m[1]];
    if (!p || p.exp < Date.now()) {
      await sendTo(chat.id, "That code has expired. Open FAIDA Predict › Settings › Notifications and connect Telegram again.");
      continue;
    }
    links[p.userId] = { chatId: chat.id, username: chat.username ?? null, linkedAt: new Date().toISOString(), prefs: links[p.userId]?.prefs ?? DEFAULT_PREFS, resolvingSent: [] };
    delete pending[m[1]];
    linked++;
    await sendTo(chat.id, "✅ Connected to FAIDA Predict. You'll get alerts here for trades, problems, and markets you hold that resolve soon. Change this anytime in Settings › Notifications.");
  }
  await setControl(OFFSET_KEY, updates[updates.length - 1].update_id + 1);
  await setControl(PENDING_KEY, pending);
  await setControl(LINKS_KEY, links);
  return linked;
}

export async function updateLink(userId: string, patch: { prefs?: Partial<TelegramPrefs>; unlink?: boolean }): Promise<TelegramLink | null> {
  const links = await getLinks();
  const cur = links[userId];
  if (!cur) return null;
  if (patch.unlink) {
    delete links[userId];
    await setControl(LINKS_KEY, links);
    await sendTo(cur.chatId, "FAIDA Predict alerts are now off for this chat.");
    return null;
  }
  links[userId] = { ...cur, prefs: { ...cur.prefs, ...(patch.prefs ?? {}) } };
  await setControl(LINKS_KEY, links);
  return links[userId];
}

async function sendTo(chatId: number, text: string): Promise<boolean> {
  const r = await tg("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true });
  return r != null;
}

export async function sendTest(userId: string): Promise<boolean> {
  const link = await getLink(userId);
  return link ? sendTo(link.chatId, "🔔 Test alert from FAIDA Predict. Alerts are working.") : false;
}

const usd = (cents: number) => `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Outbox hook: turn one platform event into a Telegram message for its owner. */
export async function telegramForEvent(aggregateId: string, eventType: string, payload: string): Promise<"SENT" | "SKIP"> {
  if (!telegramConfigured()) return "SKIP";
  let data: Record<string, unknown>;
  try { data = JSON.parse(payload) as Record<string, unknown>; } catch { return "SKIP"; }
  const links = await getLinks();
  if (Object.keys(links).length === 0) return "SKIP";

  // platform-wide: everyone linked hears about an emergency stop
  if (eventType === "PLATFORM_PAUSED") {
    let any = false;
    for (const l of Object.values(links)) if (l.prefs.problems) any = (await sendTo(l.chatId, `⛔ Emergency stop is ON. Robots won't open new trades.\nReason: ${String(data.reason ?? "manual stop")}`)) || any;
    return any ? "SENT" : "SKIP";
  }

  const userId = String(data.userId ?? "");
  const link = userId ? links[userId] : undefined;
  if (!link) return "SKIP";

  if (eventType === "ORDER_STATE_CHANGED" && data.to === "FILLED" && link.prefs.trades) {
    const o = await db.order.findUnique({ where: { id: aggregateId }, select: { side: true, priceCents: true, sizeCents: true, robot: { select: { name: true } }, market: { select: { question: true, venue: true } } } });
    if (!o || !o.side.startsWith("BUY")) return "SKIP"; // exits are reported by POSITION_CLOSED
    const side = o.side === "BUY_YES" ? "YES" : "NO";
    return (await sendTo(link.chatId, `🟢 ${o.robot?.name ?? "Manual"} bought ${side} at ${o.priceCents}¢ ($${(o.sizeCents / 100).toFixed(2)})\n${o.market.question}\n${o.market.venue} · practice money`)) ? "SENT" : "SKIP";
  }
  if (eventType === "POSITION_CLOSED" && link.prefs.trades) {
    const o = await db.order.findUnique({ where: { id: aggregateId }, select: { robot: { select: { name: true } }, market: { select: { question: true } } } });
    const pnl = Number(data.pnl ?? 0);
    return (await sendTo(link.chatId, `${pnl >= 0 ? "✅" : "🔻"} ${o?.robot?.name ?? "Trade"} closed a bet: ${usd(pnl)}\n${o?.market.question ?? ""}\nReason: ${String(data.reason ?? "")}`)) ? "SENT" : "SKIP";
  }
  if ((eventType === "RECONCILIATION_OPENED" || eventType === "LIVE_ORDER_REJECTED" || eventType === "LIVE_ORDER_ACK_LOST") && link.prefs.problems) {
    const what = eventType === "LIVE_ORDER_REJECTED" ? "An order was rejected by the venue" : "An order is waiting for the venue to confirm";
    return (await sendTo(link.chatId, `⚠️ ${what}.\n${String(data.reason ?? "")}\nOpen FAIDA › Portfolio › Needs attention.`)) ? "SENT" : "SKIP";
  }
  if (eventType === "RISK_PAUSE" && link.prefs.problems) {
    return (await sendTo(link.chatId, `⚠️ ${String(data.title ?? "A robot was paused by a safety limit")}\n${String(data.body ?? "")}`)) ? "SENT" : "SKIP";
  }
  if (eventType === "ROBOT_STATE_CHANGED" && (data.to === "PAUSED_BY_RISK" || data.to === "ERROR") && link.prefs.problems) {
    const r = await db.robot.findUnique({ where: { id: aggregateId }, select: { name: true, statusReason: true } });
    return (await sendTo(link.chatId, `⚠️ ${r?.name ?? "A robot"} was stopped ${data.to === "ERROR" ? "by an error" : "by a safety limit"}.\n${r?.statusReason ?? ""}\nReview it in FAIDA › Robots before resuming.`)) ? "SENT" : "SKIP";
  }
  return "SKIP";
}

/** Scheduled: warn once per position when a held market closes within 24 h. */
export async function telegramResolvingSoon(): Promise<number> {
  if (!telegramConfigured()) return 0;
  const links = await getLinks();
  const entries = Object.entries(links).filter(([, l]) => l.prefs.resolving);
  if (entries.length === 0) return 0;
  const soon = new Date(Date.now() + 24 * 3_600_000);
  let sent = 0;
  let changed = false;
  for (const [userId, link] of entries) {
    const positions = await db.position.findMany({
      where: { status: "OPEN", OR: [{ userId }, { robot: { userId } }], market: { closeDate: { lte: soon, gte: new Date() } } },
      select: { id: true, side: true, sizeCents: true, market: { select: { question: true, closeDate: true } } },
    });
    for (const p of positions) {
      if (link.resolvingSent.includes(p.id)) continue;
      const hrs = Math.max(1, Math.round(((p.market.closeDate?.getTime() ?? Date.now()) - Date.now()) / 3_600_000));
      if (await sendTo(link.chatId, `⏳ A market you hold closes in about ${hrs} h:\n${p.market.question}\nYour bet: ${p.side} · $${(p.sizeCents / 100).toFixed(2)}`)) {
        link.resolvingSent = [...link.resolvingSent, p.id].slice(-200);
        sent++;
        changed = true;
      }
    }
  }
  if (changed) await setControl(LINKS_KEY, links);
  return sent;
}
