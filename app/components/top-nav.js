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
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)]/90 px-2 py-2 shadow-lg shadow-[rgba(12,23,37,0.15)] backdrop-blur">
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
                "flex h-12 min-w-[72px] flex-col items-center justify-center rounded-xl px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                active
                  ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] shadow-sm"
                  : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-foreground)]"
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
