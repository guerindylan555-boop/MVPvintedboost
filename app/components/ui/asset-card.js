import Image from "next/image";
import { Check } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function AssetCard({
  title,
  subtitle,
  badge,
  tag,
  imageUrl,
  selected,
  onSelect,
  disabled,
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={twMerge(
        "group relative flex w-full flex-col overflow-hidden rounded-2xl border text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        selected ? "border-foreground" : "border-foreground/15 hover:border-foreground/40",
        disabled ? "opacity-50" : ""
      )}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-foreground/5">
        {imageUrl ? (
          <Image src={imageUrl} alt={title || "Generated asset"} fill sizes="200px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-foreground/40">
            No preview
          </div>
        )}
        {selected ? (
          <div className="absolute inset-0 bg-foreground/20" aria-hidden />
        ) : null}
        {selected ? (
          <span className="absolute right-3 top-3 inline-flex items-center justify-center rounded-full bg-background/90 p-1 text-foreground shadow">
            <Check className="size-4" />
          </span>
        ) : null}
        {tag ? (
          <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground shadow">
            {tag}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 px-4 py-3">
        <p className="truncate text-sm font-semibold text-foreground">{title || "Untitled"}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
          {badge ? <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-[11px] font-medium">{badge}</span> : null}
          {subtitle ? <span className="truncate">{subtitle}</span> : null}
        </div>
      </div>
    </button>
  );
}

export function AssetGrid({ items, renderItem, emptyState }) {
  if (!items?.length) {
    return emptyState || null;
  }
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderItem)}</div>;
}
