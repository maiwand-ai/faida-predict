"use client";

// Phase 10 — one-time operator password bootstrap. Works ONLY while the
// seeded operator has no password (refused with 409 afterwards); the password
// is never shipped as a default and never stored in plaintext.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function BootstrapPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/login"), 1200);
    } else setError(json.error ?? "bootstrap refused");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--fd-bg)] px-4 text-[var(--fd-text)]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-6">
        <div className="text-center">
          <div className="text-[20px] font-bold tracking-wide">FAIDA <span className="text-[12px] font-bold tracking-[0.2em] text-[var(--fd-blue-text)]">PREDICT</span></div>
          <div className="mt-1 text-[13px] tracking-[0.15em] text-[var(--fd-text3)]">ONE-TIME OPERATOR PASSWORD</div>
        </div>
        {done ? (
          <div className="rounded-md border border-[#00D69A]/40 bg-[#00D69A]/10 px-3 py-2 text-[14px] text-[var(--fd-green-text)]">
            Operator password set. Redirecting to sign-in…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="password" className="text-[14px] text-[var(--fd-text2)]">Operator password (≥10 chars)</label>
              <input id="password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-md border border-[var(--fd-border)] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
            </div>
            {error && <div className="rounded-md border border-[#FF5268]/40 bg-[#FF5268]/10 px-3 py-2 text-[14px] text-[var(--fd-red-text)]">{error}</div>}
            <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#2583FF] text-[15px] font-semibold text-[var(--fd-bg)] disabled:opacity-50">
              {busy ? "Setting…" : "Set operator password"}
            </button>
          </>
        )}
        <div className="text-center text-[13px] text-[var(--fd-text3)]">
          Already set? <Link href="/login" className="text-[var(--fd-blue-text)]">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
