"use client";

export function PoseStatusList({ items }) {
  if (!items || items.length === 0) return null;

  const resolveStatusLabel = (status, error) => {
    if (status === "running") return "Generating…";
    if (status === "done") return "Ready";
    if (status === "error") return error || "Failed";
    if (status === "blocked") return "Upgrade required";
    return "Queued";
  };

  return (
    <div className="rounded-xl border border-foreground/10 bg-background/40 p-4">
      <h3 className="text-sm font-semibold">Generation status</h3>
      <ul className="mt-2 space-y-2 text-xs">
        {items.map(({ key, label, status, error }) => (
          <li key={key} className="flex items-start justify-between gap-3">
            <span className="font-medium">{label}</span>
            <span
              className={
                status === "error"
                  ? "text-red-500"
                  : status === "done"
                    ? "text-green-400"
                    : status === "blocked"
                      ? "text-amber-400"
                      : "text-foreground/60"
              }
            >
              {resolveStatusLabel(status, error)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
