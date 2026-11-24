/// <reference types="bun-types" />
// Telegram alerts self-test (offline). Runs src/lib/telegram.ts end to end
// against a local fake Telegram API — no real bot token, no network.
//   bun run selftest:telegram
// It only touches the TELEGRAM_* PlatformControl keys and restores them
// exactly as they were when it finishes (pass or fail).
export {};
const sent: Array<{ chat_id: number; text: string }> = [];
let startCode = "";
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const method = url.pathname.split("/").pop();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!url.pathname.startsWith("/botSELFTEST/")) return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
    if (method === "getMe") return Response.json({ ok: true, result: { username: "faida_selftest_bot" } });
    if (method === "getUpdates") {
      const off = Number(body.offset ?? 0);
      const all = [
        { update_id: 100, message: { text: "hello", chat: { id: 555 } } },
        { update_id: 101, message: { text: `/start ${startCode}`, chat: { id: 777, username: "selftest_user" } } },
        { update_id: 102, message: { text: "/start deadbeef00", chat: { id: 888 } } },
      ];
      return Response.json({ ok: true, result: all.filter((u) => u.update_id >= off) });
    }
    if (method === "sendMessage") {
      sent.push({ chat_id: Number(body.chat_id), text: String(body.text) });
      return Response.json({ ok: true, result: {} });
    }
    return Response.json({ ok: false, description: "unknown method" });
  },
});
process.env.TELEGRAM_BOT_TOKEN = "SELFTEST";
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${server.port}`;

const { db } = await import("../src/lib/db");
const tg = await import("../src/lib/telegram");
const KEYS = ["TELEGRAM_LINKS", "TELEGRAM_PENDING", "TELEGRAM_UPDATE_OFFSET"];
const saved = await db.platformControl.findMany({ where: { key: { in: KEYS } } });

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

try {
  await db.platformControl.deleteMany({ where: { key: { in: KEYS } } });
  const user = await db.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  check("configured from env", tg.telegramConfigured());
  check("bot username from getMe", (await tg.botUsername()) === "faida_selftest_bot");
  const { code, url } = await tg.startLink(user.id);
  startCode = code;
  check("one-time deep link", url === `https://t.me/faida_selftest_bot?start=${code}`, url ?? "none");
  const linked = await tg.checkLinks();
  const link = await tg.getLink(user.id);
  check("links exactly the chat that sent /start <code>", linked === 1 && link?.chatId === 777, `linked=${linked} chat=${link?.chatId}`);
  check("confirmation message sent", sent.some((m) => m.chat_id === 777 && m.text.includes("Connected")));
  check("unknown code is not linked", !Object.values(await tg.getLinks()).some((l) => l.chatId === 888));
  check("unknown code gets an 'expired' reply", sent.some((m) => m.chat_id === 888 && m.text.includes("expired")));
  check("re-check is idempotent (update offset advanced)", (await tg.checkLinks()) === 0);
  check("emergency stop alert", (await tg.telegramForEvent("x", "PLATFORM_PAUSED", JSON.stringify({ reason: "selftest" }))) === "SENT" && sent.at(-1)!.text.includes("Emergency stop"));
  check("risk pause alert", (await tg.telegramForEvent("r", "RISK_PAUSE", JSON.stringify({ userId: user.id, title: "Robot paused", body: "daily loss limit" }))) === "SENT");
  await tg.updateLink(user.id, { prefs: { problems: false } });
  check("'problems' switched off → skipped", (await tg.telegramForEvent("r", "RISK_PAUSE", JSON.stringify({ userId: user.id, title: "t" }))) === "SKIP");
  check("another user's event is not sent", (await tg.telegramForEvent("r", "RISK_PAUSE", JSON.stringify({ userId: "someone-else", title: "t" }))) === "SKIP");
  check("test message", await tg.sendTest(user.id));
  await tg.updateLink(user.id, { unlink: true });
  check("disconnect removes the link", (await tg.getLink(user.id)) === null);
  check("alerts only ever went to the linked chat (or the expired-code reply)", sent.every((m) => m.chat_id === 777 || m.chat_id === 888));
  check("bot token never appears in a message", sent.every((m) => !m.text.includes("SELFTEST")));
} finally {
  await db.platformControl.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of saved) await db.platformControl.create({ data: row });
  server.stop(true);
  await db.$disconnect();
}
console.log(failures === 0 ? "\nTELEGRAM SELFTEST PASS" : `\nTELEGRAM SELFTEST FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
