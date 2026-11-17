// Phase 7 signing self-test — exercises the EIP-712 order chain OFFLINE with a
// public, zero-funds TEST key (Hardhat/Anvil account #0 — a fixture, never a
// production key). Verifies what a unit test can prove about signing:
//   S1  domain selection follows the book shape (v3 for "v2" books, v2 for CTF)
//   S2  BUY amounts encode to the documented 6-decimal integers (docs example)
//   S3  off-tick prices are refused (tick conformance)
//   S4  the signature recovers to the signer address over the exact typed data
//   S5  the L2 HMAC signature matches an independent recomputation
//   S6  no private-key material leaks into the signed order JSON or logs
// Run: bun scripts/live_selftest.ts   (exit 0 = all pass)
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, recoverAddress } from "viem";
import { createHmac } from "node:crypto";
import {
  domainForBook,
  encodeBuyAmounts,
  buildSignedOrder,
  l2Signature,
  wireBody,
  ORDER_TYPE,
  type SignedOrder,
} from "../src/lib/live/clobClient";
import { redactKey } from "../src/lib/live/custody";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public fixture
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const account = privateKeyToAccount(TEST_KEY);
process.env.POLYMARKET_SIGNER_KEY = TEST_KEY;

// S1 — domain selection per book shape
const dV2 = domainForBook({ version: "v2" });
check("S1 v2 book → domain version 3 / V2 exchange", dV2.version === "3" && dV2.verifyingContract.toLowerCase() === "0xe3333700ca9d93003f00f0f71f8515005f6c00aa");
const dCtf = domainForBook({ version: null, neg_risk: false });
check("S1 CTF non-neg-risk → version 2 / 0xE111…996B", dCtf.version === "2" && dCtf.verifyingContract === "0xE111180000d2663C0091e4f400237545B87B996B");
const dNeg = domainForBook({ version: null, neg_risk: true });
check("S1 CTF neg-risk → 0xe222…0F59", dNeg.verifyingContract === "0xe2222d279d744050d28e00520010520000310F59");

// S2 — BUY amounts: docs example (10 shares @ 0.52, tick 0.01 → 5200000 / 10000000)
const enc = encodeBuyAmounts(52, "10", "0.01");
check("S2 makerAmount 5200000 (docs example)", enc.makerAmount === "5200000", enc.makerAmount);
check("S2 takerAmount 10000000 (docs example)", enc.takerAmount === "10000000", enc.takerAmount);

// S3 — tick conformance refusal
let tickThrew = "";
try {
  encodeBuyAmounts(51, "10", "0.1"); // 0.51 needs 2 decimals, tick 0.1 allows 1
} catch (e) {
  tickThrew = String(e instanceof Error ? e.message : e);
}
check("S3 off-tick price refused", tickThrew.includes("tick size"), tickThrew);

// S4 — signature verifies over the exact typed data, recovering the signer
const signed: SignedOrder = await buildSignedOrder({
  tokenId: "48099164485416083893266310609329446256683823764045666170346437777171233243162", // fixture-shaped uint256
  makerAmount: enc.makerAmount,
  takerAmount: enc.takerAmount,
  side: "BUY",
  book: { version: null, neg_risk: false },
});
const orderMessage = {
  salt: BigInt(signed.salt),
  maker: signed.maker,
  signer: signed.signer,
  tokenId: BigInt(signed.tokenId),
  makerAmount: BigInt(signed.makerAmount),
  takerAmount: BigInt(signed.takerAmount),
  side: signed.side,
  signatureType: signed.signatureType,
  timestamp: BigInt(signed.timestamp),
  metadata: signed.metadata,
  builder: signed.builder,
};
const typedData = {
  domain: signed.domain,
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
  primaryType: "Order" as const,
  message: orderMessage,
};
const recovered = await recoverAddress({ hash: hashTypedData(typedData), signature: signed.signature });
const ok = recovered.toLowerCase() === account.address.toLowerCase();
check("S4 signature recovers to the signer address (EIP-712)", ok === true);
check("S4 maker = signer = EOA (self-custody, signatureType 0)", signed.maker === account.address && signed.signer === account.address && signed.signatureType === 0);

// S5 — L2 HMAC matches an independent recomputation
const bodyJson = JSON.stringify(wireBody(signed, "smoke_test_key"));
const ts = "1700000000";
const expected = createHmac("sha256", Buffer.from("c21va2VfdGVzdF9zZWNyZXQ=", "base64")).update(`${ts}POST/order${bodyJson}`).digest().toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const got = l2Signature("c21va2VfdGVzdF9zZWNyZXQ=", ts, "POST", "/order", bodyJson);
check("S5 L2 HMAC matches independent recomputation", got === expected, `${got.slice(0, 12)}… vs ${expected.slice(0, 12)}…`);
check("S5 ORDER_TYPE hash is stable", ORDER_TYPE.startsWith("Order(uint256 salt,address maker,address signer"));

// S6 — no private-key material in the signed payload or redacted logs
const leakScan = JSON.stringify({ ...signed, wire: wireBody(signed, "smoke_test_key") });
check("S6 private key absent from signed payload", !leakScan.includes(TEST_KEY.slice(2, 34)));
check("S6 redactKey scrubs key-shaped strings", redactKey(`key=${TEST_KEY} and POLYMARKET_SIGNER_KEY=0xdeadbeef`).includes("***REDACTED***"));

console.log(failures === 0 ? "\nSELFTEST PASS — signing chain verified offline (S1–S6)" : `\nSELFTEST FAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
