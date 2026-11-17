// A-06 — Evidence integrity + prompt-injection screening.
// Market text is UNTRUSTED input: venue questions and descriptions are written
// by third parties and flow straight into AI prompts. Before any estimator
// consumes evidence it must pass this screen; flagged evidence never reaches a
// prompt (fail-closed → the deterministic baseline estimates instead) and the
// flag is recorded in the trace provenance so the edge gate can see it.
// Integrity: the evidence hash binds the trace to the exact input that
// produced the estimate — re-hashing at consumption detects tampering.
import { createHash } from "crypto";

export interface ScreenResult {
  flagged: boolean;
  reasons: string[];
  sanitized: string;
}

// Patterns that indicate an attempt to steer the estimator instead of stating
// a resolvable question. Conservative by design: a false flag only costs the
// market its AI estimate (baseline still works); a false pass poisons it.
const INJECTION_PATTERNS: Array<{ id: string; re: RegExp; why: string }> = [
  { id: "INSTRUCT_OVERRIDE", re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules?)/i, why: "instruction-override phrase" },
  { id: "INSTRUCT_OVERRIDE", re: /disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions|prompts?|rules?)/i, why: "instruction-override phrase" },
  { id: "SYSTEM_IMPERSONATION", re: /(^|\n)\s*system\s*[:\-]/i, why: "fake system-role marker" },
  { id: "SYSTEM_IMPERSONATION", re: /(^|\n)\s*assistant\s*[:\-]/i, why: "fake assistant-role marker" },
  { id: "ROLE_WRAP", re: /[<>]\|?(im_start|im_end|endoftext|system|assistant|user)\|?[<>]/i, why: "chat-template control tokens" },
  { id: "PROMPT_LEAK", re: /(reveal|show|print|repeat)\s+(your\s+)?(system\s+prompt|instructions|prompt)/i, why: "prompt-leak request" },
  { id: "PROMPT_LEAK", re: /(what\s+is|what\s+are)\s+your\s+(instructions|system\s+prompt)/i, why: "prompt-leak request" },
  { id: "OUTPUT_CONTRACT", re: /respond\s+(only\s+)?with\s+(a\s+single\s+)?(number|digit|the\s+word)/i, why: "output-contract steering" },
  { id: "OUTPUT_CONTRACT", re: /you\s+are\s+now\s+(a|an|the)\s+/i, why: "role-reassignment attempt" },
  { id: "JSON_DIRECTIVE", re: /\{\s*["']?(instruction|system|task|override)["']?\s*:/i, why: "JSON directive smuggling" },
  { id: "CONTROL_CHARS", re: /[\u0000-\u0008\u000E-\u001F\u007F]/, why: "control characters in text" },
];

// Upper bound on the text a market may contribute to a prompt — evidence is
// trimmed to the sanitized slice so a 50 kB question cannot dominate context.
const MAX_EVIDENCE_CHARS = 600;

export function screenEvidence(raw: string): ScreenResult {
  const reasons: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(raw)) reasons.push(`${p.id}:${p.why}`);
  }
  return {
    flagged: reasons.length > 0,
    reasons,
    sanitized: sanitizeText(raw),
  };
}

export function sanitizeText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EVIDENCE_CHARS);
}

// A-02: the evidence hash binds the estimate to its exact inputs. Any later
// edit of the market question or book state changes the hash and the edge
// gate's integrity sample detects the mismatch.
export function evidenceHash(parts: Array<string | number | null | undefined>): string {
  return "ev_" + createHash("sha256").update(parts.map((p) => (p == null ? "-" : String(p))).join("|")).digest("hex").slice(0, 24);
}

export function promptHash(prompt: string): string {
  return "pm_" + createHash("sha256").update(prompt).digest("hex").slice(0, 24);
}

export function cacheKeyFor(parts: Array<string | number | null | undefined>): string {
  return "ck_" + createHash("sha256").update(parts.map((p) => (p == null ? "-" : String(p))).join("|")).digest("hex").slice(0, 32);
}
