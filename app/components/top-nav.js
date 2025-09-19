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
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-black/10 bg-background/90 px-2 py-2 shadow-lg shadow-black/10 backdrop-blur dark:border-white/10 dark:shadow-black/40">
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
                "flex h-12 min-w-[72px] flex-col items-center justify-center rounded-xl px-3 text-xs font-medium transition",
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-foreground/70 hover:text-foreground"
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
