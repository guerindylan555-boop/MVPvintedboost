import { twMerge } from "tailwind-merge";

export function SectionHeader({
  title,
  description,
  summary,
  actions,
  className,
}) {
  return (
    <div className={twMerge("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">{title}</h2>
        {description ? (
          <p className="max-w-prose text-sm text-foreground/70">{description}</p>
        ) : null}
        {summary ? <div className="flex flex-wrap gap-2 text-xs text-foreground/60">{summary}</div> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
