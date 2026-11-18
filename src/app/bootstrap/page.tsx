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
    <main className="flex min-h-screen items-center justify-center bg-[#0A0F1C] px-4 text-[#E9EEF7]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[#202B45] bg-[#0F1523] p-6">
        <div className="text-center">
          <div className="text-[18px] font-bold tracking-wide">FAIDA <span className="text-[10px] font-bold tracking-[0.2em] text-[#00B0F0]">PREDICT</span></div>
          <div className="mt-1 text-[11px] tracking-[0.15em] text-[#64748E]">ONE-TIME OPERATOR PASSWORD</div>
        </div>
        {done ? (
          <div className="rounded-md border border-[#2FC08E]/40 bg-[#2FC08E]/10 px-3 py-2 text-[12px] text-[#2FC08E]">
            Operator password set. Redirecting to sign-in…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="password" className="text-[12px] text-[#9AA8C0]">Operator password (≥10 chars)</label>
              <input id="password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-md border border-[#202B45] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
            </div>
            {error && <div className="rounded-md border border-[#F0525F]/40 bg-[#F0525F]/10 px-3 py-2 text-[12px] text-[#F0525F]">{error}</div>}
            <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#00B0F0] text-[13px] font-semibold text-[#0A0F1C] disabled:opacity-50">
              {busy ? "Setting…" : "Set operator password"}
            </button>
          </>
        )}
        <div className="text-center text-[11px] text-[#64748E]">
          Already set? <Link href="/login" className="text-[#3E9BF0]">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
