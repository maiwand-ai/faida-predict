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
    <main className="flex min-h-screen items-center justify-center bg-[#0A0F1C] px-4 text-[#E9EEF7]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[#202B45] bg-[#0F1523] p-6">
        <div className="text-center">
          <div className="text-[18px] font-bold tracking-wide">FAIDA <span className="text-[10px] font-bold tracking-[0.2em] text-[#00B0F0]">PREDICT</span></div>
          <div className="mt-1 text-[11px] tracking-[0.15em] text-[#64748E]">CLOSED BETA — SIGN IN</div>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-[12px] text-[#9AA8C0]">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-full rounded-md border border-[#202B45] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-[12px] text-[#9AA8C0]">Password</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="h-9 w-full rounded-md border border-[#202B45] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
        </div>
        {error && <div className="rounded-md border border-[#F0525F]/40 bg-[#F0525F]/10 px-3 py-2 text-[12px] text-[#F0525F]">{error}</div>}
        <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#00B0F0] text-[13px] font-semibold text-[#0A0F1C] disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex justify-between text-[11px] text-[#64748E]">
          <span>Enrolled? <Link href="/register" className="text-[#3E9BF0]">Register</Link></span>
          <span>First run? <Link href="/bootstrap" className="text-[#3E9BF0]">Set operator password</Link></span>
        </div>
      </form>
    </main>
  );
}
