"use client";

// Phase 10 — closed-beta registration. The email must already sit on the
// operator's enrollment list (BetaMember) and the country must pass the C4.5
// eligibility matrix (unknown country = denied). No public signup.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", name: "", country: "NL" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    setBusy(false);
    if (res.ok) router.push("/");
    else setError(json.reason ? `${json.error} — ${json.reason}` : json.error ?? "registration refused");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0E14] px-4 text-[#E6EAF2]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[#1E2533] bg-[#0E121A] p-6">
        <div className="text-center">
          <div className="text-[18px] font-bold tracking-wide">FAIDA <span className="text-[10px] font-bold tracking-[0.2em] text-[#00B0F0]">PREDICT</span></div>
          <div className="mt-1 text-[11px] tracking-[0.15em] text-[#6B7A94]">CLOSED BETA — REGISTER (enrollment required)</div>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-[12px] text-[#8B95A7]">Email (must be enrolled)</label>
          <input id="email" type="email" required value={form.email} onChange={set("email")}
            className="h-9 w-full rounded-md border border-[#1E2533] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
        </div>
        <div className="space-y-2">
          <label htmlFor="name" className="text-[12px] text-[#8B95A7]">Name (optional)</label>
          <input id="name" value={form.name} onChange={set("name")}
            className="h-9 w-full rounded-md border border-[#1E2533] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <label htmlFor="country" className="text-[12px] text-[#8B95A7]">Country (ISO-2)</label>
            <input id="country" required maxLength={2} minLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
              className="h-9 w-full rounded-md border border-[#1E2533] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-[12px] text-[#8B95A7]">Password (≥10 chars)</label>
            <input id="password" type="password" required minLength={10} value={form.password} onChange={set("password")}
              className="h-9 w-full rounded-md border border-[#1E2533] bg-transparent px-3 text-[13px] outline-none focus:border-[#00B0F0]" />
          </div>
        </div>
        {error && <div className="rounded-md border border-[#F0525F]/40 bg-[#F0525F]/10 px-3 py-2 text-[12px] text-[#F0525F]">{error}</div>}
        <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#00B0F0] text-[13px] font-semibold text-[#0B0E14] disabled:opacity-50">
          {busy ? "Registering…" : "Create account"}
        </button>
        <div className="text-center text-[11px] text-[#6B7A94]">
          Already registered? <Link href="/login" className="text-[#3E9BF0]">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
