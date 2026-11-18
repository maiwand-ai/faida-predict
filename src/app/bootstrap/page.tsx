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
    <main className="flex min-h-screen items-center justify-center bg-[#080B12] px-4 text-[#E8EDF5]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[#1E2A3D] bg-[#111827] p-6">
        <div className="text-center">
          <div className="text-[20px] font-bold tracking-wide">FAIDA <span className="text-[12px] font-bold tracking-[0.2em] text-[#2583FF]">PREDICT</span></div>
          <div className="mt-1 text-[13px] tracking-[0.15em] text-[#7C889B]">ONE-TIME OPERATOR PASSWORD</div>
        </div>
        {done ? (
          <div className="rounded-md border border-[#00D69A]/40 bg-[#00D69A]/10 px-3 py-2 text-[14px] text-[#00D69A]">
            Operator password set. Redirecting to sign-in…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="password" className="text-[14px] text-[#9AA6B8]">Operator password (≥10 chars)</label>
              <input id="password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-md border border-[#1E2A3D] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
            </div>
            {error && <div className="rounded-md border border-[#FF5268]/40 bg-[#FF5268]/10 px-3 py-2 text-[14px] text-[#FF5268]">{error}</div>}
            <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#2583FF] text-[15px] font-semibold text-[#080B12] disabled:opacity-50">
              {busy ? "Setting…" : "Set operator password"}
            </button>
          </>
        )}
        <div className="text-center text-[13px] text-[#7C889B]">
          Already set? <Link href="/login" className="text-[#2583FF]">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
