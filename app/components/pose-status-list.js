"use client";

export function PoseStatusList({ items }) {
  if (!items || items.length === 0) return null;

  const resolveStatusLabel = (status, error) => {
    if (status === "running") return "Generating…";
    if (status === "done") return "Ready";
    if (status === "error") return error || "Failed";
    return "Queued";
  };

  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4">
      <h3 className="text-sm font-semibold">Generation status</h3>
      <ul className="mt-2 space-y-2 text-xs text-[color:var(--color-text-secondary)]">
        {items.map(({ key, label, status, error }) => (
          <li key={key} className="flex items-start justify-between gap-3">
            <span className="font-medium">{label}</span>
            <span
              className={
                status === "error"
                  ? "text-[color:var(--color-danger)]"
                  : status === "done"
                    ? "text-[color:var(--color-positive)]"
                    : "text-[color:var(--color-text-secondary)]"
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
