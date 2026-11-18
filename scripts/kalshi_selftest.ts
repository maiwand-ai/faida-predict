// Phase 9 credential-kind self-test — exercises the Kalshi asymmetric API key
// signing chain OFFLINE with freshly generated test pairs (never production
// credentials). Verifies what a unit test can prove about the SECOND
// credential kind (carry-forward register: "RSA key auth ≠ wallet signing"):
//   K1  RSA-2048 pair: sign the documented pre-sign text with RSA-PSS/SHA-256
//       (salt = digest length) → independent verify against the public key
//   K2  Ed25519 pair: sign the message directly → independent verify
//   K3  pre-sign text contract: "{timestamp}{METHOD}{path}", query stripped;
//       tampering ANY component breaks verification
//   K4  env-absent honest state: keyPresent false, keyStored false (structural)
//   K5  redaction: PEM blocks and env-style assignments never survive output
//   K6  signature shape: base64; RSA-2048 sig = 256 bytes, Ed25519 = 64 bytes
// Run: bun scripts/kalshi_selftest.ts   (exit 0 = all pass)
import {
  generateTestPair,
  verifyKalshiSignature,
  signKalshiWithPem,
  signKalshiRequest,
  kalshiCredentialStatus,
  redactKalshiKey,
} from "../src/lib/live/kalshiCustody";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const TS = String(Date.now());
const METHOD = "GET";
const PATH = "/trade-api/v2/portfolio/balance?limit=5";

// K1 — RSA-PSS/SHA-256 round trip
const rsa = generateTestPair("RSA_PSS_SHA256");
const rsaSig = signKalshiWithPem(rsa.privateKeyPem, TS, METHOD, PATH);
check("K1a RSA signature verifies against the public key (documented padding)", verifyKalshiSignature(rsa.publicKeyPem, TS, METHOD, PATH, rsaSig));
check("K1b query parameters are stripped from the signed path", verifyKalshiSignature(rsa.publicKeyPem, TS, METHOD, "/trade-api/v2/portfolio/balance", rsaSig));
check("K1c RSA-2048 signature is 256 bytes (base64-decoded)", Buffer.from(rsaSig, "base64").length === 256);

// K2 — Ed25519 round trip
const ed = generateTestPair("ED25519");
const edSig = signKalshiWithPem(ed.privateKeyPem, TS, METHOD, PATH);
check("K2a Ed25519 signature verifies (message signed directly)", verifyKalshiSignature(ed.publicKeyPem, TS, METHOD, PATH, edSig));
check("K2b Ed25519 signature is 64 bytes", Buffer.from(edSig, "base64").length === 64);

// K3 — pre-sign text contract: tampering any component breaks verification
check("K3a wrong timestamp fails verification", !verifyKalshiSignature(rsa.publicKeyPem, String(Number(TS) + 1), METHOD, PATH, rsaSig));
check("K3b wrong method fails verification", !verifyKalshiSignature(rsa.publicKeyPem, TS, "POST", PATH, rsaSig));
check("K3c wrong path fails verification", !verifyKalshiSignature(rsa.publicKeyPem, TS, METHOD, "/trade-api/v2/portfolio/orders", rsaSig));
check("K3d lowercase method normalizes to uppercase (contract-safe)", verifyKalshiSignature(rsa.publicKeyPem, TS, "get", PATH, rsaSig));

// K4 — env-absent honest state (no key injected in this test run)
process.env.KALSHI_PRIVATE_KEY = "";
process.env.KALSHI_API_KEY_ID = "";
delete process.env.KALSHI_PRIVATE_KEY;
delete process.env.KALSHI_API_KEY_ID;
const absent = kalshiCredentialStatus();
check("K4a absent credential reports honestly (keyPresent=false, keyStored=false)", absent.keyPresent === false && absent.keyStored === false && absent.keyIdFingerprint === null);
check("K4b absent credential names the model without material", absent.credentialModel === "KALSHI_ASYMMETRIC_API_KEY");
let threw = false;
let threwMsg = "";
try {
  signKalshiRequest(TS, METHOD, PATH);
} catch (e) {
  threwMsg = String(e instanceof Error ? e.message : e);
  threw = threwMsg.includes("KALSHI_CREDENTIAL_ABSENT");
}
check("K4c signing without a credential refuses (fail-closed)", threw, threwMsg.slice(0, 120) || "(no throw)");

// K5 — redaction
const pemSample = rsa.privateKeyPem;
check("K5a PEM private key block is fully redacted", !redactKalshiKey(`junk ${pemSample} junk`).includes("PRIVATE KEY") && redactKalshiKey(pemSample).includes("***REDACTED_PEM***"));
check("K5b env-style assignment is redacted", !redactKalshiKey(`KALSHI_PRIVATE_KEY=${pemSample}`).includes("MII"));

// K6 — signature shape is valid base64
check("K6a signatures decode as strict base64", /^[A-Za-z0-9+/]+={0,2}$/.test(rsaSig) && /^[A-Za-z0-9+/]+={0,2}$/.test(edSig));

console.log("");
if (failures) {
  console.log(`SELFTEST FAIL — ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("SELFTEST PASS — Kalshi credential kind proven offline (K1–K6)");
}
