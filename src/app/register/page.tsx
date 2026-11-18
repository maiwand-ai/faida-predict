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
    <main className="flex min-h-screen items-center justify-center bg-[var(--fd-bg)] px-4 text-[var(--fd-text)]">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--fd-border)] bg-[var(--fd-surface)] p-6">
        <div className="text-center">
          <div className="text-[20px] font-bold tracking-wide">FAIDA <span className="text-[12px] font-bold tracking-[0.2em] text-[var(--fd-blue-text)]">PREDICT</span></div>
          <div className="mt-1 text-[13px] tracking-[0.15em] text-[var(--fd-text3)]">CLOSED BETA — REGISTER (enrollment required)</div>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-[14px] text-[var(--fd-text2)]">Email (must be enrolled)</label>
          <input id="email" type="email" required value={form.email} onChange={set("email")}
            className="h-9 w-full rounded-md border border-[var(--fd-border)] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
        </div>
        <div className="space-y-2">
          <label htmlFor="name" className="text-[14px] text-[var(--fd-text2)]">Name (optional)</label>
          <input id="name" value={form.name} onChange={set("name")}
            className="h-9 w-full rounded-md border border-[var(--fd-border)] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <label htmlFor="country" className="text-[14px] text-[var(--fd-text2)]">Country (ISO-2)</label>
            <input id="country" required maxLength={2} minLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
              className="h-9 w-full rounded-md border border-[var(--fd-border)] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-[14px] text-[var(--fd-text2)]">Password (≥10 chars)</label>
            <input id="password" type="password" required minLength={10} value={form.password} onChange={set("password")}
              className="h-9 w-full rounded-md border border-[var(--fd-border)] bg-transparent px-3 text-[15px] outline-none focus:border-[#2583FF]" />
          </div>
        </div>
        {error && <div className="rounded-md border border-[#FF5268]/40 bg-[#FF5268]/10 px-3 py-2 text-[14px] text-[var(--fd-red-text)]">{error}</div>}
        <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-[#2583FF] text-[15px] font-semibold text-[var(--fd-bg)] disabled:opacity-50">
          {busy ? "Registering…" : "Create account"}
        </button>
        <div className="text-center text-[13px] text-[var(--fd-text3)]">
          Already registered? <Link href="/login" className="text-[var(--fd-blue-text)]">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
