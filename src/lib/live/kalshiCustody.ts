// Phase 9 — Kalshi credential kind (carry-forward register: "RSA key auth ≠
// wallet signing — adapter + settings must support it").
//
// Kalshi's trading auth is an ASYMMETRIC API KEY, not a wallet:
//   • key types: RSA 2048 (RSA-PSS with SHA-256, salt = digest length) or
//     Ed25519 (signs the message directly) — Kalshi picks the verifier from
//     the registered public key; we sign with the matching algorithm.
//   • pre-sign text: "{timestamp_ms}{HTTP_METHOD}{path}" where path is the
//     full path from the API root WITHOUT query parameters
//     (e.g. "1703123456789GET/trade-api/v2/portfolio/balance").
//   • headers: KALSHI-ACCESS-KEY (key id), KALSHI-ACCESS-TIMESTAMP (ms),
//     KALSHI-ACCESS-SIGNATURE (base64 signature).
//   (Contract source: docs.kalshi.com/getting_started/quick_start_authenticated_requests.md
//   + api_keys.md, fetched 2026-11-18 — [VERIFY] evidence in the S-05 row.)
//
// HARD INVARIANT (same posture as S-08 custody, B1): the platform NEVER
// stores key material. The private key arrives per-process via the
// environment (founder-injected), lives only in this module's memory, is
// never written to the DB, never logged, never returned by an API. Every
// outbound string passes through redactKalshiKey(). There is no column to
// store it in — keyStored is structurally false.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  constants as cryptoConstants,
  type KeyObject,
} from "node:crypto";

export const KALSHI_KEY_ENV = "KALSHI_PRIVATE_KEY"; // PEM (PKCS#8 RSA / PKCS#1 RSA / Ed25519)
export const KALSHI_KEY_ID_ENV = "KALSHI_API_KEY_ID";

export type KalshiKeyType = "RSA_PSS_SHA256" | "ED25519";

interface LoadedKey {
  keyObject: KeyObject;
  keyType: KalshiKeyType;
  fingerprint: string; // last 4 of the SHA-256 of the public key DER — never the material
}

let cached: LoadedKey | null = null;

function loadFromEnv(): LoadedKey | null {
  const pem = process.env[KALSHI_KEY_ENV]?.trim();
  const keyId = process.env[KALSHI_KEY_ID_ENV]?.trim();
  if (!pem || !keyId) return null;
  try {
    const keyObject = createPrivateKey(pem);
    const pub = createPublicKey(keyObject);
    const keyType: KalshiKeyType = pub.asymmetricKeyType === "ed25519" ? "ED25519" : "RSA_PSS_SHA256";
    cached = { keyObject, keyType, fingerprint: keyId.slice(-4) };
    return cached;
  } catch {
    return null; // malformed key in env — treated as absent, fail-closed
  }
}

/** The loaded Kalshi key, or null when the founder injected none. */
export function kalshiKey(): LoadedKey | null {
  if (cached) return cached;
  return loadFromEnv();
}

/** Sign the documented pre-sign text with an explicit PEM (self-test path). */
export function signKalshiWithPem(privateKeyPem: string, timestampMs: string, method: string, path: string): string {
  const keyObject = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(keyObject);
  const keyType: KalshiKeyType = pub.asymmetricKeyType === "ed25519" ? "ED25519" : "RSA_PSS_SHA256";
  return signMessage({ keyObject, keyType }, timestampMs, method, path);
}

/** Sign the documented pre-sign text. Throws when no key is loaded. */
export function signKalshiRequest(timestampMs: string, method: string, path: string): string {
  const loaded = kalshiKey();
  if (!loaded) throw new Error("KALSHI_CREDENTIAL_ABSENT: no env-injected Kalshi API key");
  return signMessage(loaded, timestampMs, method, path);
}

function signMessage(loaded: { keyObject: KeyObject; keyType: KalshiKeyType }, timestampMs: string, method: string, path: string): string {
  // path = full path from the API root, WITHOUT query parameters
  const pathNoQuery = path.split("?")[0];
  const message = Buffer.from(`${timestampMs}${method.toUpperCase()}${pathNoQuery}`, "utf8");
  if (loaded.keyType === "ED25519") {
    return cryptoSign(null, message, loaded.keyObject).toString("base64");
  }
  return cryptoSign("sha256", message, {
    key: loaded.keyObject,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST, // PSS.DIGEST_LENGTH per the docs
  }).toString("base64");
}

/** The three authenticated-request headers — values derived, never the key. */
export function kalshiAuthHeaders(method: string, path: string): Record<string, string> {
  const loaded = kalshiKey();
  if (!loaded) throw new Error("KALSHI_CREDENTIAL_ABSENT: no env-injected Kalshi API key");
  const keyId = (process.env[KALSHI_KEY_ID_ENV] as string).trim();
  const ts = String(Date.now());
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signKalshiRequest(ts, method, path),
  };
}

/** Honest credential-kind state for UI + gates. No key material ever. */
export function kalshiCredentialStatus(): {
  keyPresent: boolean;
  keyIdFingerprint: string | null;
  keyType: KalshiKeyType | null;
  credentialModel: "KALSHI_ASYMMETRIC_API_KEY";
  keyStored: false;
} {
  const loaded = kalshiKey();
  return {
    keyPresent: loaded != null,
    keyIdFingerprint: loaded?.fingerprint ?? null,
    keyType: loaded?.keyType ?? null,
    credentialModel: "KALSHI_ASYMMETRIC_API_KEY",
    keyStored: false, // structural: there is no column to store it in
  };
}

/** Defense-in-depth for logs/errors: replace anything key-shaped. */
export function redactKalshiKey(text: string): string {
  return text
    .replace(/-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA )?PRIVATE KEY-----/g, "***REDACTED_PEM***")
    .replace(/(KALSHI_PRIVATE_KEY[=:]\s*)[\s\S]*/gi, "$1***REDACTED***");
}

// ── Self-test primitives (exercised offline by scripts/kalshi_selftest.ts) ──
// generate + sign + verify round-trip for BOTH key types, using freshly
// generated pairs — proves the signing chain without any founder credential.

export interface GeneratedPair {
  privateKeyPem: string;
  publicKeyPem: string;
  keyType: KalshiKeyType;
}

export function generateTestPair(keyType: KalshiKeyType): GeneratedPair {
  if (keyType === "ED25519") {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    return {
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      keyType,
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    keyType,
  };
}

/** Verify a base64 signature against the documented pre-sign text. */
export function verifyKalshiSignature(
  publicKeyPem: string,
  timestampMs: string,
  method: string,
  path: string,
  signatureB64: string,
): boolean {
  const pub = createPublicKey(publicKeyPem);
  const keyType: KalshiKeyType = pub.asymmetricKeyType === "ed25519" ? "ED25519" : "RSA_PSS_SHA256";
  const message = Buffer.from(`${timestampMs}${method.toUpperCase()}${path.split("?")[0]}`, "utf8");
  const sig = Buffer.from(signatureB64, "base64");
  if (keyType === "ED25519") return cryptoVerify(null, message, pub, sig);
  return cryptoVerify("sha256", message, {
    key: pub,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
  }, sig);
}
