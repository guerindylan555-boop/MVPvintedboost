"use client";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { authClient } from "@/app/lib/auth-client";
import { getSessionBasics } from "@/app/lib/session";

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (error) {
    return value;
  }
}

export default function UsageAdminPage() {
  const { data: session } = authClient.useSession();
  const { isAdmin } = getSessionBasics(session);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [costs, setCosts] = useState({});
  const [draft, setDraft] = useState({});
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({ users: 0, allowance: 0, used: 0, remaining: 0 });

  const costKeys = useMemo(() => Object.keys(draft).sort(), [draft]);

  const fetchSummary = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/usage/summary", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Failed to load usage overview");
      }
      const nextCosts = data?.costs || {};
      const nextDraft = Object.fromEntries(
        Object.entries(nextCosts).map(([key, value]) => [key, String(value ?? "")])
      );
      setCosts(nextCosts);
      setDraft(nextDraft);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotals({
        users: data?.totals?.users ?? 0,
        allowance: data?.totals?.allowance ?? 0,
        used: data?.totals?.used ?? 0,
        remaining: data?.totals?.remaining ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage overview");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      fetchSummary();
    }
  }, [fetchSummary, isAdmin]);

  const handleCostChange = useCallback((key, raw) => {
    const next = raw.replace(/[^0-9]/g, "");
    setDraft((prev) => ({
      ...prev,
      [key]: next,
    }));
  }, []);

  const handleSaveCosts = useCallback(
    async (event) => {
      event.preventDefault();
      if (!isAdmin) return;
      setSaving(true);
      setError(null);
      setStatus(null);
      try {
        const payload = {};
        Object.entries(draft).forEach(([key, value]) => {
          const parsed = Number.parseInt(value ?? "0", 10);
          payload[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        });
        const res = await fetch("/api/admin/usage/costs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ costs: payload }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.detail || data?.error || "Unable to update usage costs");
        }
        const nextCosts = data?.costs || payload;
        const nextDraft = Object.fromEntries(
          Object.entries(nextCosts).map(([key, value]) => [key, String(value ?? "")])
        );
        setCosts(nextCosts);
        setDraft(nextDraft);
        setStatus("Usage costs updated");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to update usage costs");
      } finally {
        setSaving(false);
      }
    },
    [draft, isAdmin]
  );

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-semibold mb-2">Admin only</h1>
        <p className="text-sm text-gray-500">You don’t have access to the usage administration tools.</p>
        <Link href="/" className="mt-4 inline-block underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Usage Administration</h1>
          <p className="text-sm text-muted-foreground">
            Adjust quota costs and review per-user usage across the platform.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSummary}
            className="h-9 rounded-md border border-border px-3 text-sm"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Usage costs</h2>
          {status ? <span className="text-xs text-emerald-500">{status}</span> : null}
        </div>
        <form className="grid gap-4 sm:grid-cols-2 md:grid-cols-3" onSubmit={handleSaveCosts}>
          {costKeys.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">No usage costs configured.</p>
          ) : (
            costKeys.map((key) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="font-medium capitalize">{key.replace(/_/g, " ")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft[key] ?? ""}
                  onChange={(event) => handleCostChange(key, event.target.value)}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            ))
          )}
          <div className="col-span-full flex items-center gap-2">
            <button
              type="submit"
              className={clsx(
                "h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground",
                saving && "opacity-60"
              )}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {error ? <span className="text-xs text-red-500">{error}</span> : null}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Usage overview</h2>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading usage…"
                : `${totals.users} users • ${totals.used}/${totals.allowance} credits used (${totals.remaining} remaining)`}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border/60 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Allowance</th>
                <th className="px-3 py-2 text-right">Used</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                <th className="px-3 py-2">Period start</th>
                <th className="px-3 py-2">Period end</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {loading ? "Loading usage…" : "No usage records found."}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const plan = item.plan || {};
                  return (
                    <tr key={`${item.user_id}-${item.current_period_start || ""}`} className="align-middle">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.user_id}</td>
                      <td className="px-3 py-2">{plan.name || "—"}</td>
                      <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {plan.status || "unknown"}
                      </td>
                      <td className="px-3 py-2 text-right">{item.allowance ?? 0}</td>
                      <td className="px-3 py-2 text-right">{item.used ?? 0}</td>
                      <td className="px-3 py-2 text-right">{item.remaining ?? 0}</td>
                      <td className="px-3 py-2">{formatDate(item.current_period_start)}</td>
                      <td className="px-3 py-2">{formatDate(item.current_period_end)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
