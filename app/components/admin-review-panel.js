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
    <div className="space-y-4 rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/15 dark:bg-white/5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-foreground/15 px-3 py-1">{gender}</span>
        <span className="rounded-full border border-foreground/15 px-3 py-1">Env: {environmentSummary}</span>
        <span className="rounded-full border border-foreground/15 px-3 py-1">Poses: {poseSummary || "–"}</span>
        <span className="rounded-full border border-foreground/15 px-3 py-1">Model: {modelSummary}</span>
        <span className="rounded-full border border-foreground/15 px-3 py-1">Flow: {flowMode}</span>
        <span className="rounded-full border border-foreground/15 px-3 py-1">Type: {garmentSummary}</span>
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
