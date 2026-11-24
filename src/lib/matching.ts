// Plain-text matching between questions and markets. Used by Ask FAIDA (which
// market is this question about?) and by cross-venue price gaps (which
// markets on different venues are the same event?). Deliberately simple and
// explainable: content-word overlap, with numbers and years treated as hard
// requirements because "BTC above 100k" and "BTC above 120k" are different bets.

const STOP = new Set(
  ("a an the of in on at to for by with from and or not no yes will would be is are was were been being it its this that these those " +
    "do does did than then as if into over under about before after during between above below up down out off any all each " +
    "which who whom what when where why how there their they them he she his her we our you your i me my market price prediction " +
    "end ever win wins won get gets reach reaches hit hits become becomes vs versus").split(" "),
);

const MONTHS: Record<string, string> = {
  jan: "january", feb: "february", mar: "march", apr: "april", jun: "june", jul: "july",
  aug: "august", sep: "september", sept: "september", oct: "october", nov: "november", dec: "december",
};

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/(\d),(\d{3})\b/g, "$1$2") // 150,000 → 150000
    .replace(/\$?(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000))) // $150k → 150000
    .replace(/(\d)([a-z])/g, "$1 $2") // 25bps → 25 bps
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .map((w) => MONTHS[w] ?? w)
    .map((w) => (!/\d/.test(w) && w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)) // rates → rate
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const isNumberish = (w: string) => /\d/.test(w);

/** 0..1 similarity; any number/year present in one text must appear in the other. */
export function similarity(a: string, b: string): number {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  for (const w of A) if (isNumberish(w) && !B.has(w)) return 0;
  for (const w of B) if (isNumberish(w) && !A.has(w)) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** How well a free-text question is covered by a market title (recall of the question's words). */
export function coverage(question: string, market: string): number {
  const Q = contentWords(question);
  const M = new Set(contentWords(market));
  if (Q.length === 0) return 0;
  const nums = Q.filter(isNumberish);
  if (nums.some((n) => !M.has(n))) return 0;
  return Q.filter((w) => M.has(w)).length / Q.length;
}
