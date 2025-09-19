"use client";

import { PromptPreviewCard } from "./prompt-preview-card";
import { PoseStatusList } from "./pose-status-list";

export function AdminReviewPanel({
  gender,
  environmentSummary,
  poseSummary,
  modelSummary,
  flowMode,
  garmentSummary,
  prompt,
  promptDirty,
  onPromptChange,
  onPromptReset,
  poseStatusItems,
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          {gender}
        </span>
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          Env: {environmentSummary}
        </span>
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          Poses: {poseSummary || "–"}
        </span>
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          Model: {modelSummary}
        </span>
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          Flow: {flowMode}
        </span>
        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[color:var(--color-text-secondary)]">
          Type: {garmentSummary}
        </span>
      </div>
      <PromptPreviewCard
        prompt={prompt}
        dirty={promptDirty}
        onChange={onPromptChange}
        onReset={onPromptReset}
      />
      <PoseStatusList items={poseStatusItems} />
    </div>
  );
}
