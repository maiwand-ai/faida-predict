"use client";

// Settings › Notifications › Telegram. Connect a chat with a one-time link,
// choose what to hear about, send a test, disconnect. When the server has no
// bot token yet, the card explains the one-time setup instead.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { Badge, btn, Panel } from "./ds";

type Prefs = { trades: boolean; problems: boolean; resolving: boolean };
type State = { configured: boolean; bot: string | null; link: { username: string | null; linkedAt: string; prefs: Prefs } | null };

const PREF_TEXT: Array<[keyof Prefs, string, string]> = [
  ["trades", "Trades", "A robot opens or closes a bet, with the profit or loss."],
  ["problems", "Problems", "Emergency stop, a robot stopped by a safety limit, an order stuck or rejected."],
  ["resolving", "Resolving soon", "A market you hold closes within 24 hours."],
];

export function TelegramCard() {
  const [s, setS] = useState<State | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/telegram").then((r) => (r.ok ? r.json() : null)).then((j: State | null) => j && setS(j)).catch(() => undefined), []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; url?: string };
      if (action === "start" && j.url) { setLinkUrl(j.url); window.open(j.url, "_blank", "noopener"); }
      else if (!j.ok && j.error) setMsg({ ok: false, text: j.error });
      else if (action === "check") { setMsg({ ok: true, text: "Connected. Check Telegram for the confirmation." }); setLinkUrl(null); }
      else if (action === "test") setMsg({ ok: true, text: "Test alert sent. It should arrive in a few seconds." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Telegram alerts" icon={<Send size={18} />} subtitle="Get a Telegram message when something happens, even when FAIDA isn't open." action={s?.link ? <Badge tone="green" dot>Connected{s.link.username ? ` · @${s.link.username}` : ""}</Badge> : undefined}>
      {!s ? (
        <div className="h-16 animate-pulse rounded-2xl bg-[var(--fd-elevated)]" />
      ) : !s.configured ? (
        <div className="rounded-2xl bg-[var(--fd-bg2)] p-4 text-[14px] leading-relaxed text-[var(--fd-text-soft)]">
          <b className="text-[var(--fd-strong)]">One-time setup by the FAIDA operator:</b>
          <ol className="ml-5 mt-2 list-decimal space-y-1">
            <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, and pick a name. BotFather replies with a bot token.</li>
            <li>Add it to the server&apos;s environment as <code>TELEGRAM_BOT_TOKEN</code> (never paste it into the app) and restart.</li>
            <li>Come back here and press <b>Connect Telegram</b>.</li>
          </ol>
        </div>
      ) : !s.link ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-[var(--fd-text-soft)]">Connect in two steps: open the link to start a chat with <b>@{s.bot}</b> and press <b>Start</b>, then come back and confirm.</p>
          <div className="flex flex-wrap gap-2.5">
            <button className={btn.primary} disabled={busy} onClick={() => void act("start")}><Send size={16} /> Connect Telegram</button>
            {linkUrl && <button className={btn.secondary} disabled={busy} onClick={() => void act("check")}>I&apos;ve pressed Start</button>}
          </div>
          {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--fd-brand-text)] hover:underline">Open the link again <ExternalLink size={13} /></a>}
          <p className="text-[12.5px] text-[var(--fd-text3)]">The link works once and expires after 15 minutes.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1">
            {PREF_TEXT.map(([k, label, desc]) => (
              <li key={k}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-[color:var(--fd-ink)]/[0.04]">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--fd-brand-b)]" checked={s.link!.prefs[k]} disabled={busy} onChange={(e) => void act("prefs", { prefs: { [k]: e.target.checked } })} />
                  <span><span className="block text-[14.5px] font-medium text-[var(--fd-strong)]">{label}</span><span className="block text-[13px] text-[var(--fd-text2)]">{desc}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2.5">
            <button className={btn.secondary} disabled={busy} onClick={() => void act("test")}>Send a test</button>
            <button className={btn.ghost} disabled={busy} onClick={() => void act("unlink")}>Disconnect</button>
          </div>
          <p className="text-[12.5px] text-[var(--fd-text3)]">Connected {new Date(s.link.linkedAt).toLocaleString()}.</p>
        </div>
      )}
      {msg && <p className={`mt-3 text-[13.5px] ${msg.ok ? "text-[var(--fd-green-text)]" : "text-[var(--fd-red-text)]"}`}>{msg.text}</p>}
    </Panel>
  );
}
