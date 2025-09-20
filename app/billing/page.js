"use client";

import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";

import { useSubscription } from "@/app/components/subscription-provider";

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function BillingPage() {
  const {
    usage,
    plan,
    allowance,
    used,
    remaining,
    plans,
    isBillingEnabled,
    startCheckout,
    openPortal,
    manageUrl,
  } = useSubscription();
  const [workingPlan, setWorkingPlan] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const planId = plan?.id || null;
  const allowanceNumber = typeof allowance === "number" ? allowance : null;
  const usedNumber = typeof used === "number" ? used : null;
  const remainingNumber = typeof remaining === "number" ? Math.max(remaining, 0) : null;

  const fallbackPlan = useMemo(() => plans.find((p) => p.key === "free") || plans[0] || null, [plans]);
  const activePlanOption = useMemo(() => {
    if (planId) {
      return plans.find((p) => p.id === planId) || fallbackPlan;
    }
    return fallbackPlan;
  }, [fallbackPlan, planId, plans]);

  const displayPlanName = plan?.name || activePlanOption?.name || "Free";
  const displayAllowance = allowanceNumber ?? activePlanOption?.allowance ?? null;
  const displayRemaining = remainingNumber ?? (displayAllowance != null && usedNumber != null
    ? Math.max(displayAllowance - usedNumber, 0)
    : null);

  const allowanceLabel = useMemo(() => {
    if (displayAllowance === null) return "—";
    if (displayAllowance === 0) return "Unlimited";
    return `${displayAllowance.toLocaleString()} / month`;
  }, [displayAllowance]);

  const remainingLabel = useMemo(() => {
    if (displayAllowance === 0) return "Unlimited";
    if (displayRemaining === null) return "—";
    return `${displayRemaining.toLocaleString()} left`;
  }, [displayAllowance, displayRemaining]);

  async function handleSelectPlan(option) {
    if (!option?.id) {
      toast.error("This plan is not configured. Set NEXT_PUBLIC_POLAR_PLAN_*_ID in your env file.");
      return;
    }
    setWorkingPlan(option.key);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : undefined;
      const successUrl = origin ? `${origin}/billing?status=success` : undefined;
      const cancelUrl = origin ? `${origin}/billing?status=cancelled` : undefined;
      await startCheckout(option.id, { successUrl, cancelUrl });
      toast.success("Checkout opened. Complete the upgrade in the overlay or new tab.");
    } catch (error) {
      toast.error(error?.message || "Unable to start checkout.");
    } finally {
      setWorkingPlan(null);
    }
  }

  async function handlePortal() {
    setPortalBusy(true);
    try {
      const returnUrl = typeof window !== "undefined" ? window.location.href : undefined;
      const url = await openPortal(returnUrl);
      if (!url && manageUrl) {
        try {
          window.open(manageUrl, "_blank", "noopener,noreferrer");
          toast.success("Customer portal opened in a new tab.");
        } catch {
          toast("Opening existing customer portal…");
        }
      } else if (!url) {
        toast.error("No billing portal available yet.");
      } else {
        toast.success("Customer portal opened in a new tab.");
      }
    } catch (error) {
      toast.error(error?.message || "Unable to open portal.");
    } finally {
      setPortalBusy(false);
    }
  }

  const periodStart = usage?.period?.start;
  const periodEnd = usage?.period?.end;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Billing & usage</h1>
        <p className="text-sm text-foreground/70">
          Track your current allowance and upgrade to unlock more AI generations.
        </p>
      </header>

      {!isBillingEnabled ? (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-900 dark:border-amber-200/40 dark:bg-amber-200/10 dark:text-amber-100">
          Billing isn&apos;t configured for this environment. Ask your administrator to add Polar credentials to the backend service.
        </div>
      ) : null}

      <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg sm:p-8">
        <h2 className="text-lg font-semibold">Current period</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-background)]/40 p-4">
            <p className="text-xs uppercase tracking-wide text-foreground/50">Plan</p>
            <p className="mt-1 text-base font-semibold text-foreground">{displayPlanName}</p>
            {plan?.interval ? (
              <p className="text-xs text-foreground/60">{plan.interval}</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-background)]/40 p-4">
            <p className="text-xs uppercase tracking-wide text-foreground/50">Allowance</p>
            <p className="mt-1 text-base font-semibold text-foreground">{allowanceLabel}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-background)]/40 p-4">
            <p className="text-xs uppercase tracking-wide text-foreground/50">Used</p>
            <p className="mt-1 text-base font-semibold text-foreground">
              {usedNumber === null ? "—" : usedNumber.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-background)]/40 p-4">
            <p className="text-xs uppercase tracking-wide text-foreground/50">Remaining</p>
            <p className="mt-1 text-base font-semibold text-foreground">{remainingLabel}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-foreground/60">
          <span>Period: {formatDate(periodStart)} → {formatDate(periodEnd)}</span>
          {planId ? (
            <button
              type="button"
              onClick={handlePortal}
              disabled={portalBusy}
              className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
            >
              {portalBusy ? "Opening portal…" : "Manage subscription"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Choose a plan</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((option) => {
            const isCurrent = planId && option.id === planId;
            const busy = workingPlan === option.key;
            const disabled = !option.isAvailable || busy || !isBillingEnabled;
            const quota =
              option.allowance === 0
                ? "Unlimited generations"
                : `${option.allowance.toLocaleString()} generations / month`;
            return (
              <div
                key={option.key}
                className={
                  "flex h-full flex-col justify-between rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg"
                }
              >
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-foreground/50">{option.tagline}</p>
                    <h3 className="mt-1 text-xl font-semibold text-foreground">{option.name}</h3>
                    <p className="text-sm text-foreground/70">{option.price}</p>
                  </div>
                  <p className="text-sm font-medium text-foreground">{quota}</p>
                  <ul className="space-y-2 text-xs text-foreground/70">
                    {option.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <span className="mt-1 inline-block size-1.5 rounded-full bg-[var(--color-accent)]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectPlan(option)}
                  className="mt-6 inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
                >
                  {isCurrent ? "Current plan" : busy ? "Opening checkout…" : option.isAvailable ? "Select plan" : "Configure plan"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
