"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAuthClient } from "better-auth/react";

import { getSessionBasics } from "@/app/lib/session";
import { getSubscriptionPlans } from "@/app/lib/subscription-config";

const authClient = createAuthClient();
const SubscriptionContext = createContext(undefined);
const INITIAL_PLANS = getSubscriptionPlans();

function extractUsage(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.usage && typeof payload.usage === "object") return payload.usage;
  if (
    typeof payload.allowance === "number" &&
    typeof payload.remaining === "number" &&
    typeof payload.used === "number"
  ) {
    return payload;
  }
  return null;
}

async function readResponseBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function resolveCheckoutUrl(checkout) {
  if (!checkout || typeof checkout !== "object") return null;
  return (
    checkout.url ||
    checkout.checkout_url ||
    checkout.checkout?.url ||
    checkout.link_url ||
    null
  );
}

function resolvePortalUrl(portal) {
  if (!portal || typeof portal !== "object") return null;
  if (typeof portal.url === "string" && portal.url) return portal.url;
  if (portal.session && typeof portal.session === "object" && portal.session.url) {
    return portal.session.url;
  }
  return null;
}

async function launchEmbeddedCheckout(url, refreshUsage, themeOverride) {
  if (typeof window === "undefined" || !url) return false;
  try {
    const { PolarEmbedCheckout } = await import("@polar-sh/checkout/embed");
    const theme =
      themeOverride ||
      (document.documentElement.classList.contains("dark") ? "dark" : "light");
    const instance = await PolarEmbedCheckout.create(url, theme);
    instance.addEventListener("success", async () => {
      if (typeof refreshUsage === "function") await refreshUsage();
    });
    instance.addEventListener("close", () => {
      try {
        instance.close();
      } catch {}
    });
    return true;
  } catch (error) {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {}
    return false;
  }
}

export function SubscriptionProvider({ children }) {
  const { data: session } = authClient.useSession();
  const { userId } = getSessionBasics(session);

  const [usage, setUsage] = useState(null);
  const [planOptions, setPlanOptions] = useState(INITIAL_PLANS);
  const [costs, setCosts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [manageUrl, setManageUrl] = useState(null);
  const fetchAbortRef = useRef(0);

  const applyUsageFromResponse = useCallback((payload) => {
    const next = extractUsage(payload);
    if (next) {
      setUsage(next);
      if (next.costs && typeof next.costs === "object") {
        setCosts(next.costs);
      } else if (payload && typeof payload === "object" && payload.costs && typeof payload.costs === "object") {
        setCosts(payload.costs);
      }
      return next;
    }
    if (payload && typeof payload === "object" && payload.costs && typeof payload.costs === "object") {
      setCosts(payload.costs);
    }
    return null;
  }, []);

  const mergePlans = useCallback((payload) => {
    if (!payload || !Array.isArray(payload.plans)) return;
    setPlanOptions((prev) => {
      const remotes = payload.plans.filter((item) => item && typeof item === "object");
      const byId = new Map(
        remotes
          .filter((item) => typeof item.id === "string")
          .map((item) => [item.id, item])
      );
      const byName = new Map(
        remotes
          .filter((item) => typeof item.name === "string")
          .map((item) => [item.name.trim().toLowerCase(), item])
      );

      return prev.map((option) => {
        let remote = option.id ? byId.get(option.id) : undefined;
        if (!remote && option.name) {
          remote = byName.get(option.name.trim().toLowerCase());
        }
        if (!remote && option.planMetadata?.name) {
          remote = byName.get(String(option.planMetadata.name).trim().toLowerCase());
        }

        if (!remote) {
          return option.id
            ? { ...option, isAvailable: option.isAvailable }
            : option;
        }

        const allowance =
          typeof remote.allowance === "number" && remote.allowance >= 0
            ? remote.allowance
            : option.allowance;

        return {
          ...option,
          id: option.id || remote.id,
          name: remote.name || option.name,
          allowance,
          planMetadata: remote.metadata || option.planMetadata,
          interval: remote.interval || option.interval,
          currency: remote.currency || option.currency,
          priceId: remote.default_price_id || option.priceId,
          isAvailable: Boolean(remote.id || option.id),
        };
      });
    });
    if (payload?.costs && typeof payload.costs === "object") {
      setCosts(payload.costs);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUsage(null);
      setCosts(null);
      setBillingEnabled(true);
      setManageUrl(null);
      return;
    }
    const runId = Date.now();
    fetchAbortRef.current = runId;
    setLoading(true);
    try {
      const res = await fetch("/api/usage/me", {
        method: "GET",
        cache: "no-store",
      });
      const data = await readResponseBody(res);
      if (fetchAbortRef.current !== runId) return;
      if (res.status === 503) {
        setBillingEnabled(false);
      } else {
        setBillingEnabled(true);
      }
      if (!res.ok) {
        const message = data?.error || "Failed to load usage";
        setError(new Error(message));
        return;
      }
      setError(null);
      applyUsageFromResponse(data);
    } catch (err) {
      if (fetchAbortRef.current !== runId) return;
      setError(err instanceof Error ? err : new Error("Failed to load usage"));
    } finally {
      if (fetchAbortRef.current === runId) setLoading(false);
    }
  }, [applyUsageFromResponse, userId]);

  useEffect(() => {
    if (!userId) {
      setUsage(null);
      setManageUrl(null);
      return;
    }
    refresh();
  }, [userId, refresh]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/billing/plans", { cache: "no-store" });
        const data = await readResponseBody(res);
        if (res.ok && data) {
          mergePlans(data);
        }
      } catch (err) {
        console.warn("Failed to load billing plans", err);
      }
    })();
  }, [mergePlans]);

  const startCheckout = useCallback(
    async (planId, { successUrl, cancelUrl, theme } = {}) => {
      if (!userId) throw new Error("Sign in to manage billing");
      if (!planId) throw new Error("Plan unavailable");

      const payload = {
        plan_id: planId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      };
      if (session?.user?.email) payload.customer_email = session.user.email;

      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await readResponseBody(res);
      applyUsageFromResponse(data);
      if (!res.ok) {
        throw new Error(data?.error || "Unable to start checkout");
      }

      const checkout = data?.checkout || data;
      const url = resolveCheckoutUrl(checkout);
      const opened = await launchEmbeddedCheckout(url, refresh, theme);
      if (!opened && url && typeof window !== "undefined") {
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {}
      }
      return { checkout, url, opened };
    },
    [applyUsageFromResponse, refresh, session?.user?.email, userId]
  );

  const openPortal = useCallback(
    async (returnUrl) => {
      if (!userId) throw new Error("Sign in to manage billing");
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(returnUrl ? { return_url: returnUrl } : {}),
        cache: "no-store",
      });
      const data = await readResponseBody(res);
      applyUsageFromResponse(data);
      if (!res.ok) {
        throw new Error(data?.error || "Unable to open portal");
      }
      const url = resolvePortalUrl(data?.portal || data);
      if (url) {
        setManageUrl(url);
        if (typeof window !== "undefined") {
          try {
            window.open(url, "_blank", "noopener,noreferrer");
          } catch {}
        }
      }
      return url;
    },
    [applyUsageFromResponse, userId]
  );

  const allowance = typeof usage?.allowance === "number" ? usage.allowance : null;
  const used = typeof usage?.used === "number" ? usage.used : null;
  const remaining = typeof usage?.remaining === "number" ? usage.remaining : null;
  const plan = usage?.plan || null;

  const value = useMemo(
    () => ({
      isLoading: loading,
      error,
      usage,
      plan,
      allowance,
      used,
      remaining,
      costs: usage?.costs && typeof usage.costs === "object" ? usage.costs : costs,
      isBillingEnabled: billingEnabled,
      manageUrl,
      plans: planOptions,
      refresh,
      applyUsageFromResponse,
      startCheckout,
      openPortal,
    }),
    [
      costs,
      allowance,
      applyUsageFromResponse,
      billingEnabled,
      error,
      loading,
      manageUrl,
      openPortal,
      planOptions,
      plan,
      refresh,
      remaining,
      startCheckout,
      usage,
      used,
    ]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription must be used within SubscriptionProvider");
  }
  return context;
}
