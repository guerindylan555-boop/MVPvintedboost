"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Sparkles, Palette, Settings, List } from "lucide-react";

const links = [
  { href: "/", label: "Create", icon: Sparkles },
  { href: "/studio", label: "Studio", icon: Palette },
  { href: "/listings", label: "Listings", icon: List },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-none fixed bottom-4 left-0 right-0 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] px-2 py-2 shadow-[0_18px_60px_var(--color-border-strong)] backdrop-blur">
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
    </nav>
  );
}
