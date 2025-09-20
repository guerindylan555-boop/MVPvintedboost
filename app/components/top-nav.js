"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Sparkles, Palette, Settings, List, CreditCard } from "lucide-react";

import { useSubscription } from "./subscription-provider";

const links = [
  { href: "/", label: "Create", icon: Sparkles },
  { href: "/studio", label: "Studio", icon: Palette },
  { href: "/listings", label: "Listings", icon: List },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function TopNav() {
  const pathname = usePathname();
  const { plan, allowance, remaining, isBillingEnabled } = useSubscription();

  const planName = plan?.name || "Free";
  const allowanceNumber = typeof allowance === "number" ? allowance : null;
  const remainingNumber =
    typeof remaining === "number" ? Math.max(remaining, 0) : null;
  const quotaBadge = allowanceNumber === 0 ? "Unlimited" : remainingNumber;
  const usageActive = pathname === "/billing" || pathname?.startsWith("/billing/");
  const lowQuota =
    allowanceNumber &&
    remainingNumber !== null &&
    remainingNumber <= Math.max(1, Math.round(allowanceNumber * 0.15));

  const badgeClass = lowQuota
    ? "bg-amber-500/20 text-amber-100"
    : "bg-[var(--color-accent-soft)] text-[var(--color-foreground)]";

  return (
    <nav className="pointer-events-none fixed bottom-4 left-0 right-0 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] px-2 py-2 shadow-[0_18px_60px_var(--color-border-strong)] backdrop-blur">
        <div className="flex items-center gap-1">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                aria-label={active ? `${link.label} current page` : link.label}
                className={clsx(
                  "flex h-12 min-w-[72px] flex-col items-center justify-center rounded-xl px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-strong)]",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-foreground)] shadow-[0_12px_35px_var(--color-border-strong)]"
                    : "text-[var(--color-foreground)]/70 hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-foreground)] focus-visible:bg-[var(--color-accent-soft)] focus-visible:text-[var(--color-foreground)]"
                )}
              >
                <Icon className="mb-1 size-4" />
                {link.label}
              </Link>
            );
          })}
        </div>
        {isBillingEnabled ? (
          <Link
            href="/billing"
            aria-label="Open billing overview"
            className={clsx(
              "flex h-12 items-center gap-2 rounded-xl border border-[var(--color-border-strong)]/40 px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-strong)]",
              usageActive
                ? "bg-[var(--color-accent-soft)] text-[var(--color-foreground)]"
                : "text-[var(--color-foreground)]/80 hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-foreground)]"
            )}
          >
            <div className="flex items-center justify-center rounded-full bg-[var(--color-border-strong)]/20 p-1">
              <CreditCard className="size-4" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-foreground)]/50">Plan</span>
              <span className="text-sm font-semibold text-[var(--color-foreground)]">{planName}</span>
            </div>
            {allowanceNumber !== null ? (
              <span className={clsx("ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClass)}>
                {quotaBadge === null ? "—" : quotaBadge === "Unlimited" ? "Unlimited" : `${quotaBadge} left`}
              </span>
            ) : null}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
