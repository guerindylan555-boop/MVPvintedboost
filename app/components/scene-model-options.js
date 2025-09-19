"use client";

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
    <div className="rounded-2xl border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Scene & model options</span>
        <span className="text-xs text-foreground/60">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-foreground/10 px-4 py-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Model defaults</p>
                  <p className="mt-1 text-xs text-foreground/60">Pick a Studio default image to set the person and gender.</p>
                </div>
                <Link href="/studio" className="text-xs text-foreground/60 underline">
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
                        className={`group w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition ${
                          selected
                            ? "border-foreground ring-2 ring-foreground/40 bg-foreground/5 shadow-lg"
                            : "border-foreground/15 hover:border-foreground/50"
                        }`}
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
                            <div className="flex h-full w-full items-center justify-center bg-foreground/10 text-foreground/50">
                              <ImageOff className="size-6" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-2">
                          <p className="text-sm font-semibold capitalize">{model.name || genderLabel}</p>
                          <p className="text-[11px] text-foreground/60">{genderLabel} fit</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-foreground/15 bg-background/40 p-3 text-xs text-foreground/60">
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
                  <p className="mt-1 text-xs text-foreground/60">Pick from your saved backgrounds. Add more in Studio to build a library.</p>
                </div>
                <Link href="/studio" className="text-xs text-foreground/60 underline">
                  Manage
                </Link>
              </div>
              {envDefaultsLoading ? (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-32 w-32 flex-shrink-0 animate-pulse rounded-xl bg-foreground/10" />
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
                        className={`group w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition ${
                          selected
                            ? "border-foreground ring-2 ring-foreground/40 bg-foreground/5 shadow-lg"
                            : "border-foreground/15 hover:border-foreground/50"
                        }`}
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
                            <div className="flex h-full w-full items-center justify-center bg-foreground/10 text-foreground/50">
                              <ImageOff className="size-6" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-2">
                          <p className="text-sm font-semibold">{env.name || "Untitled"}</p>
                          <p className="text-[11px] text-foreground/60">{selected ? "Current selection" : "Tap to select"}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <OptionPicker options={environmentOptions} value={environmentValue} onChange={onEnvironmentChange} />
                  <p className="text-[11px] text-foreground/50">Save environment photos in Studio to see them here.</p>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <div className="rounded-2xl border border-foreground/15 bg-background/60 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Image count</p>
                    <p className="mt-1 text-xs text-foreground/60">Pick how many images to generate (max {poseMax}).</p>
                  </div>
                  <div className="inline-flex items-baseline gap-2 rounded-xl bg-foreground px-4 py-2 text-background shadow">
                    <span className="text-2xl font-semibold leading-none">{plannedImagesCount}</span>
                    <span className="text-[11px] uppercase tracking-wide text-background/70">images</span>
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
                        className={`group flex h-10 items-center justify-center rounded-lg border text-sm font-semibold transition ${
                          checked
                            ? "border-foreground bg-foreground text-background shadow"
                            : "border-foreground/20 bg-background/80 text-foreground/70 hover:border-foreground/60 hover:text-foreground"
                        }`}
                        aria-pressed={checked}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] text-foreground/60">We’ll pick varied poses automatically for each image.</p>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-foreground/70">Extra instructions</label>
              <textarea
                rows={3}
                className="mt-2 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 py-2 text-sm"
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
