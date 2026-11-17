// Phase 7 — custody (B1: SELF-CUSTODY, EIP-712) + signer handling (S-08).
// HARD INVARIANT (plan §6.3): the platform NEVER stores wallet private keys.
// The signer key arrives per-process via the environment (founder-injected,
// token-discipline style), lives only in this module's memory, and is used to
// sign CLOB orders. It is never written to the DB, never logged, never
// returned by an API. Every outbound string passes through redactKey().
//
// The Wallet table stores the ADDRESS only (schema note: "B1 decision").
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const SIGNER_ENV = "POLYMARKET_SIGNER_KEY";

let cached: { account: PrivateKeyAccount; fingerprint: string } | null = null;

function loadFromEnv(): PrivateKeyAccount | null {
  const raw = process.env[SIGNER_ENV]?.trim();
  if (!raw) return null;
  try {
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    // fingerprint = last 4 of the address — enough to confirm WHICH key is
    // loaded without ever exposing key material.
    cached = { account, fingerprint: account.address.slice(-4) };
    return account;
  } catch {
    return null; // malformed key in env — treated as absent, fail-closed
  }
}

/** The loaded signer account, or null when the founder injected no key. */
export function signerAccount(): PrivateKeyAccount | null {
  if (cached) return cached.account;
  return loadFromEnv();
}

export function signerAddress(): string | null {
  return signerAccount()?.address ?? null;
}

/** Honest custody state for UI + gates. No key material ever. */
export function custodyStatus(): {
  signerPresent: boolean;
  address: string | null;
  fingerprint: string | null;
  signingModel: "SELF_CUSTODY_EIP712";
  keyStored: false;
} {
  const acct = signerAccount();
  return {
    signerPresent: acct != null,
    address: acct?.address ?? null,
    fingerprint: cached?.fingerprint ?? null,
    signingModel: "SELF_CUSTODY_EIP712",
    keyStored: false, // structural: there is no column to store it in
  };
}

/** Defense-in-depth for logs/errors: replace anything key-shaped. */
export function redactKey(text: string): string {
  return text
    .replace(/0x[a-fA-F0-9]{64}/g, "0x***REDACTED_KEY***")
    .replace(/(POLYMARKET_SIGNER_KEY[=:]\s*)\S+/gi, "$1***REDACTED***");
}
