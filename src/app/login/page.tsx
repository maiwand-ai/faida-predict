"use client";

// Phase 10 — login. Closed beta: accounts exist only via operator enrollment
// + registration. No public signup anywhere (BETA_PHASE75 §1).
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (res.ok) router.push("/");
    else setError(json.error ?? "login failed");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080B12] px-4 text-[#E8EDF5]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[#1E2A3D] bg-[#111827] p-6">
        <div className="text-center">
          <div className="text-[20px] font-bold tracking-wide">FAIDA <span className="text-[12px] font-bold tracking-[0.2em] text-[#2583FF]">PREDICT</span></div>
          <div className="mt-1 text-[13px] tracking-[0.15em] text-[#7C889B]">CLOSED BETA — SIGN IN</div>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-[14px] text-[#9AA6B8]">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-full rounded-md border border-[#1E2A3D] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-[14px] text-[#9AA6B8]">Password</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="h-9 w-full rounded-md border border-[#1E2A3D] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
        </div>
        {error && <div className="rounded-md border border-[#FF5268]/40 bg-[#FF5268]/10 px-3 py-2 text-[14px] text-[#FF5268]">{error}</div>}
        <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#2583FF] text-[15px] font-semibold text-[#080B12] disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex justify-between text-[13px] text-[#7C889B]">
          <span>Enrolled? <Link href="/register" className="text-[#2583FF]">Register</Link></span>
          <span>First run? <Link href="/bootstrap" className="text-[#2583FF]">Set operator password</Link></span>
        </div>
      </form>
    </main>
  );
}
