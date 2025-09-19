"use client";

import clsx from "clsx";
import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";

import { OptionPicker } from "./option-picker";

export function SceneModelOptions({
  collapsed,
  onToggleCollapsed,
  modelDefaultList,
  selectedGender,
  onSelectGender,
  modelDefaults,
  isAdmin,
  useModelImage,
  onUseModelImageChange,
  modelReferenceOptions,
  flowOptions,
  flowMode,
  onFlowModeChange,
  envDefaults,
  envDefaultsLoading,
  selectedEnvDefaultKey,
  onSelectEnvironmentDefault,
  environmentOptions,
  onEnvironmentChange,
  environmentValue,
  plannedImagesCount,
  poseMax,
  onPoseCountChange,
  extraInstructions,
  onExtraChange,
}) {
  const selectedModelDefault = selectedGender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
  const showDescriptionWarning = !useModelImage && !selectedModelDefault?.description;

  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)]">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
      >
        <span>Scene & model options</span>
        <span className="text-xs text-[color:var(--color-text-secondary)]">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-[color:var(--color-border-muted)] px-4 py-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Model defaults</p>
                  <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
                    Pick a Studio default image to set the person and gender.
                  </p>
                </div>
                <Link href="/studio" className="text-xs text-[color:var(--color-text-secondary)] underline">
                  Manage
                </Link>
              </div>
              {modelDefaultList.length > 0 ? (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                  {modelDefaultList.map((model) => {
                    const selected = selectedGender === model.gender;
                    const genderLabel = model.gender === "woman" ? "Woman" : "Man";
                    return (
                      <button
                        key={model.gender}
                        type="button"
                        onClick={() => onSelectGender(model.gender)}
                        className={clsx(
                          "group w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                          selected
                            ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] shadow-[0_18px_36px_rgba(12,23,37,0.24)]"
                            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)]"
                        )}
                        aria-pressed={selected}
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden">
                          {model.url ? (
                            <Image
                              src={model.url}
                              alt={`${genderLabel} default`}
                              fill
                              sizes="128px"
                              className="object-cover transition duration-300 group-hover:scale-[1.02]"
                              unoptimized
                            />
                          ) : (
                            <div
                              className={clsx(
                                "flex h-full w-full items-center justify-center bg-[color:var(--color-surface)]",
                                selected
                                  ? "text-[color:var(--color-accent-contrast)]/80"
                                  : "text-[color:var(--color-text-tertiary)]"
                              )}
                            >
                              <ImageOff className="size-6" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div
                          className={clsx(
                            "px-3 py-2",
                            selected
                              ? "text-[color:var(--color-accent-contrast)]"
                              : "text-[color:var(--color-foreground)]"
                          )}
                        >
                          <p className="text-sm font-semibold capitalize">{model.name || genderLabel}</p>
                          <p
                            className={clsx(
                              "text-[11px]",
                              selected
                                ? "text-[color:var(--color-accent-contrast)]/80"
                                : "text-[color:var(--color-text-secondary)]"
                            )}
                          >
                            {genderLabel} fit
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-xs text-[color:var(--color-text-secondary)]">
                  No Studio defaults yet. <Link href="/studio" className="underline">Add one</Link> to unlock a quicker flow.
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="sm:col-span-2">
                <OptionPicker
                  label="Model reference"
                  description="Use your default model photo from Studio, or send its description only."
                  options={modelReferenceOptions}
                  value={useModelImage ? "image" : "description"}
                  onChange={(value) => onUseModelImageChange(value === "image")}
                />
                {showDescriptionWarning && (
                  <p className="mt-1 text-[11px] text-amber-500">No default description stored yet. Add one from Studio.</p>
                )}
              </div>
            )}
            {isAdmin && (
              <div className="sm:col-span-2">
                <OptionPicker label="Generation flow" options={flowOptions} value={flowMode} onChange={onFlowModeChange} />
              </div>
            )}
            <div className="sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Environment defaults</p>
                    <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
                      Pick from your saved backgrounds. Add more in Studio to build a library.
                    </p>
                  </div>
                  <Link href="/studio" className="text-xs text-[color:var(--color-text-secondary)] underline">
                    Manage
                  </Link>
                </div>
                {envDefaultsLoading ? (
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-32 w-32 flex-shrink-0 animate-pulse rounded-xl bg-[color:var(--color-surface)]"
                      />
                    ))}
                  </div>
                ) : envDefaults.length > 0 ? (
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {envDefaults.map((env) => {
                    const selected = selectedEnvDefaultKey === env.s3_key;
                    return (
                      <button
                        key={env.s3_key}
                        type="button"
                        onClick={() => onSelectEnvironmentDefault(env.s3_key)}
                        className={clsx(
                          "group w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                          selected
                            ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] shadow-[0_18px_36px_rgba(12,23,37,0.24)]"
                            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)]"
                        )}
                        aria-pressed={selected}
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden">
                          {env.url ? (
                            <Image
                              src={env.url}
                              alt={env.name || "Environment"}
                              fill
                              sizes="128px"
                              className="object-cover transition duration-300 group-hover:scale-[1.02]"
                              unoptimized
                            />
                          ) : (
                            <div
                              className={clsx(
                                "flex h-full w-full items-center justify-center bg-[color:var(--color-surface)]",
                                selected
                                  ? "text-[color:var(--color-accent-contrast)]/80"
                                  : "text-[color:var(--color-text-tertiary)]"
                              )}
                            >
                              <ImageOff className="size-6" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div
                          className={clsx(
                            "px-3 py-2",
                            selected
                              ? "text-[color:var(--color-accent-contrast)]"
                              : "text-[color:var(--color-foreground)]"
                          )}
                        >
                          <p className="text-sm font-semibold">{env.name || "Untitled"}</p>
                          <p
                            className={clsx(
                              "text-[11px]",
                              selected
                                ? "text-[color:var(--color-accent-contrast)]/80"
                                : "text-[color:var(--color-text-secondary)]"
                            )}
                          >
                            {selected ? "Current selection" : "Tap to select"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <OptionPicker options={environmentOptions} value={environmentValue} onChange={onEnvironmentChange} />
                  <p className="text-[11px] text-[color:var(--color-text-tertiary)]">
                    Save environment photos in Studio to see them here.
                  </p>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Image count</p>
                    <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
                      Pick how many images to generate (max {poseMax}).
                    </p>
                  </div>
                  <div className="inline-flex items-baseline gap-2 rounded-xl bg-[color:var(--color-accent)] px-4 py-2 text-[color:var(--color-accent-contrast)] shadow">
                    <span className="text-2xl font-semibold leading-none">{plannedImagesCount}</span>
                    <span className="text-[11px] uppercase tracking-wide text-[color:var(--color-accent-contrast)]/70">
                      images
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {Array.from({ length: poseMax }, (_, idx) => idx + 1).map((count) => {
                    const checked = plannedImagesCount === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => onPoseCountChange(count)}
                        className={clsx(
                          "group flex h-10 items-center justify-center rounded-lg border text-sm font-semibold transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                          checked
                            ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] shadow"
                            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)] hover:text-[color:var(--color-foreground)]"
                        )}
                        aria-pressed={checked}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] text-[color:var(--color-text-secondary)]">
                  We’ll pick varied poses automatically for each image.
                </p>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-[color:var(--color-text-secondary)]">Extra instructions</label>
              <textarea
                rows={3}
                className="mt-2 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
                placeholder="Optional: add a style tweak, colours, or vibe"
                value={extraInstructions}
                onChange={(e) => onExtraChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
