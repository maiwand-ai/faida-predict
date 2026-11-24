// Phase 7 — Polymarket CLOB client: public book reads, EIP-712 order signing
// (self-custody), L2 HMAC request auth, and the POST /order send boundary.
//
// Signing spec per docs.polymarket.com/trading/place-orders (verified
// 2026-11-18, Protocol V2 era):
//   domain  name "Polymarket CTF Exchange", chainId 137; version/verifyingContract
//           selected from the BOOK response:
//             book.version === "v2"  → version "3", 0xe3333700cA9d93003F00f0F71f8515005F6c00Aa
//             CTF neg_risk=false     → version "2", 0xE111180000d2663C0091e4f400237545B87B996B
//             CTF neg_risk=true      → version "2", 0xe2222d279d744050d28e00520010520000310F59
//   Order   salt uint256 (JSON number, ≤ MAX_SAFE_INTEGER), maker address,
//           signer address, tokenId uint256 (CTF token id / V2 position id),
//           makerAmount uint256, takerAmount uint256, side uint8 (0 BUY, 1 SELL),
//           signatureType uint8 (0 EOA, 1 proxy, 2 safe, 3 deposit wallet),
//           timestamp uint256 (unix ms), metadata bytes32, builder bytes32.
//           (expiration lives in the wire body only — NOT in the signed struct.)
//   amounts 6-decimal integers; BUY: makerAmount = price×size USD, takerAmount
//           = shares; SELL reversed; price must conform to the book's tick_size.
//   L2 auth headers: POLY_ADDRESS, POLY_API_KEY, POLY_PASSPHRASE, POLY_TIMESTAMP,
//           POLY_SIGNATURE = urlsafe_b64(HMAC-SHA256(b64decode(secret),
//           timestamp + "POST" + "/order" + exactBody)).
//   L1 auth (credential derive): ClobAuthDomain EIP-712 + /auth/derive-api-key.
import { createHmac } from "node:crypto";
import type { PrivateKeyAccount } from "viem/accounts";
import { signerAccount, redactKey } from "./custody";

export const CLOB_BASE = "https://clob.polymarket.com";
// Cloudflare in front of the CLOB 403s default library user agents (node/
// undici, python-urllib) — every client identifies itself honestly instead.
const CLIENT_UA = "faida-predict/0.2.1 (live-gated pilot client)";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Domain table (see header). Keyed by book shape.
export function domainForBook(book: { version?: string | null; neg_risk?: boolean | null }): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
} {
  if (book.version === "v2") {
    return { name: "Polymarket CTF Exchange", version: "3", chainId: 137, verifyingContract: "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa" };
  }
  if (book.neg_risk) {
    return { name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: "0xe2222d279d744050d28e00520010520000310F59" };
  }
  return { name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: "0xE111180000d2663C0091e4f400237545B87B996B" };
}

export const ORDER_TYPE = "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";

export interface ClobBook {
  asset_id: string;
  version?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  min_order_size?: string;
  tick_size?: string;
  neg_risk?: boolean;
  timestamp?: string;
}

/** Public read — no credentials. `fetchedAtMs` is the B5 freshness clock. */
export async function fetchClobBook(tokenId: string): Promise<{ book: ClobBook; fetchedAtMs: number }> {
  const res = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`, {
    headers: { "User-Agent": CLIENT_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`clob book ${res.status}`);
  const book = (await res.json()) as ClobBook;
  return { book, fetchedAtMs: Date.now() };
}

// ── amount encoding (tick-size table from the docs) ──────────────────────────
const TICK_DECIMALS: Record<string, { price: number; amount: number }> = {
  "0.1": { price: 1, amount: 3 },
  "0.01": { price: 2, amount: 4 },
  "0.005": { price: 3, amount: 5 },
  "0.0025": { price: 4, amount: 6 },
  "0.001": { price: 3, amount: 5 },
  "0.0001": { price: 4, amount: 6 },
};

export interface EncodedAmounts {
  makerAmount: string; // 6-decimal integer string
  takerAmount: string;
  shares: string; // size-decimal string (2)
  priceStr: string; // price within tick decimals
}

/**
 * Encode a BUY of `shares` YES/NO tokens at `priceCents` (integer 1..99).
 * BUY: makerAmount = USD (price×size), takerAmount = shares (6-dec integers).
 * `sizeShares` must already be rounded to 2 decimals (size decimals).
 */
export function encodeBuyAmounts(priceCents: number, sizeShares: string, tickSize: string): EncodedAmounts {
  const dec = TICK_DECIMALS[tickSize];
  if (!dec) throw new Error(`unsupported tick size ${tickSize}`);
  const price = priceCents / 100;
  const priceStr = price.toFixed(dec.price);
  if (parseFloat(priceStr) !== price) {
    throw new Error(`price ${priceCents}¢ does not conform to tick size ${tickSize}`);
  }
  const shares = parseFloat(sizeShares).toFixed(2);
  const usd = parseFloat(priceStr) * parseFloat(shares);
  // Docs: "If it exceeds Amount decimals, round it up first to
  // Amount decimals + 4, then down to Amount decimals." price_dec + 2 equals
  // amount_dec in the tick table, so the floor never truncates a valid
  // product — the bump only kills binary-float dust.
  const fine = 10 ** (dec.amount + 4);
  const bumped = Math.round(usd * fine) / fine;
  const usdRounded = Math.floor(bumped * 10 ** dec.amount) / 10 ** dec.amount;
  return {
    makerAmount: String(Math.round(usdRounded * 1e6)),
    takerAmount: String(Math.round(parseFloat(shares) * 1e6)),
    shares,
    priceStr,
  };
}

export interface SignedOrder {
  salt: number;
  maker: `0x${string}`;
  signer: `0x${string}`;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: 0 | 1;
  signatureType: 0 | 1 | 2 | 3;
  timestamp: number; // unix ms
  metadata: `0x${string}`;
  builder: `0x${string}`;
  signature: `0x${string}`;
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
}

/**
 * Build and EIP-712-sign a CTF/Protocol-V2 order with the loaded self-custody
 * signer (EOA → signatureType 0, maker = signer). Throws when no signer key
 * was injected — building an unsigned order is never a valid state.
 */
export async function buildSignedOrder(params: {
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: "BUY" | "SELL";
  book: { version?: string | null; neg_risk?: boolean | null };
}): Promise<SignedOrder> {
  const account: PrivateKeyAccount | null = signerAccount();
  if (!account) throw new Error("NO_SIGNER: no POLYMARKET_SIGNER_KEY in the server environment (keys are never stored)");
  const domain = domainForBook(params.book);
  const order = {
    salt: Math.floor(Math.random() * 1_000_000_000),
    maker: account.address,
    signer: account.address,
    tokenId: params.tokenId as `0x${string}`,
    makerAmount: params.makerAmount,
    takerAmount: params.takerAmount,
    side: (params.side === "BUY" ? 0 : 1) as 0 | 1,
    signatureType: 0 as const,
    timestamp: Date.now(),
    metadata: ZERO_BYTES32 as `0x${string}`,
    builder: ZERO_BYTES32 as `0x${string}`,
  };
  const signature = await account.signTypedData({
    domain,
    types: {
      Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
        { name: "timestamp", type: "uint256" },
        { name: "metadata", type: "bytes32" },
        { name: "builder", type: "bytes32" },
      ],
    },
    primaryType: "Order",
    message: {
      salt: BigInt(order.salt),
      maker: order.maker,
      signer: order.signer,
      tokenId: BigInt(order.tokenId),
      makerAmount: BigInt(order.makerAmount),
      takerAmount: BigInt(order.takerAmount),
      side: order.side,
      signatureType: order.signatureType,
      timestamp: BigInt(order.timestamp),
      metadata: order.metadata,
      builder: order.builder,
    },
  });
  return { ...order, signature, domain };
}

/** The exact POST /order wire body for a signed order (GTC limit). */
export function wireBody(o: SignedOrder, apiKey: string): Record<string, unknown> {
  return {
    deferExec: false,
    order: {
      builder: o.builder,
      expiration: "0",
      maker: o.maker,
      makerAmount: o.makerAmount,
      metadata: o.metadata,
      salt: o.salt,
      side: o.side === 0 ? "BUY" : "SELL",
      signature: o.signature,
      signatureType: o.signatureType,
      signer: o.signer,
      takerAmount: o.takerAmount,
      timestamp: String(o.timestamp),
      tokenId: o.tokenId,
    },
    orderType: "GTC",
    owner: apiKey,
  };
}

// ── L2 HMAC request auth ─────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * L2 signature per docs: urlsafeBase64WithPadding(HMAC-SHA256(
 *   base64Decode(apiSecret), timestamp + method + requestPath + exactBody)).
 * `padding` is kept (the docs say "WithPadding" — '=' stays).
 */
export function l2Signature(apiSecret: string, timestamp: string, method: string, requestPath: string, body: string): string {
  const key = Buffer.from(apiSecret, "base64");
  const mac = createHmac("sha256", key).update(`${timestamp}${method}${requestPath}${body}`).digest();
  return b64url(mac);
}

export interface L2Headers {
  POLY_ADDRESS: string;
  POLY_API_KEY: string;
  POLY_PASSPHRASE: string;
  POLY_TIMESTAMP: string;
  POLY_SIGNATURE: string;
}

export function l2Headers(params: { address: string; apiKey: string; apiSecret: string; apiPassphrase: string; method: string; requestPath: string; body: string }): L2Headers {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    POLY_ADDRESS: params.address,
    POLY_API_KEY: params.apiKey,
    POLY_PASSPHRASE: params.apiPassphrase,
    POLY_TIMESTAMP: timestamp,
    POLY_SIGNATURE: l2Signature(params.apiSecret, timestamp, params.method, params.requestPath, params.body),
  };
}

export interface SendCredentials {
  address: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export interface SendResult {
  success: boolean;
  orderID: string;
  status: string;
  errorMsg: string;
  makingAmount?: string;
  takingAmount?: string;
}

/**
 * THE send boundary. Requires injected L2 credentials (env); without them it
 * refuses honestly — building/auditing a signed order without sending is the
 * default (DRY_RUN lives one layer up, in execute.ts).
 */
export async function sendSignedOrder(signed: SignedOrder, creds: SendCredentials): Promise<SendResult> {
  const body = JSON.stringify(wireBody(signed, creds.apiKey));
  const headers = l2Headers({
    address: creds.address,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    apiPassphrase: creds.apiPassphrase,
    method: "POST",
    requestPath: "/order",
    body,
  });
  const res = await fetch(`${CLOB_BASE}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CLIENT_UA, ...headers },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await res.json().catch(() => ({}))) as Partial<SendResult>;
  return {
    success: Boolean(payload.success),
    orderID: payload.orderID ?? "",
    status: payload.status ?? "",
    errorMsg: redactKey(payload.errorMsg ?? (res.ok ? "" : `http ${res.status}`)),
    makingAmount: payload.makingAmount,
    takingAmount: payload.takingAmount,
  };
}
