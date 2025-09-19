"use client";

import clsx from "clsx";
import { Camera } from "lucide-react";

export function UploadPanel({
  fileInputRef,
  cameraInputRef,
  previewUrl,
  selectedFile,
  isDragging,
  isPreprocessing,
  plannedImagesCount,
  title,
  onTitleChange,
  titleHelpText,
  onTriggerPick,
  onTriggerCamera,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
  onClearSelection,
}) {
  const titleDescriptionId = titleHelpText ? "listing-title-helper" : undefined;

  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Upload garment</h2>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Drop a clear photo of the item you want the model to wear.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={onTriggerCamera}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 font-semibold text-[color:var(--color-foreground)] transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
          >
            <Camera className="size-4" aria-hidden="true" />
            <span>Take photo</span>
          </button>
        </div>
      </div>
      <div className="mt-4">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
        {!previewUrl ? (
          <button
            type="button"
            onClick={onTriggerPick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={clsx(
              "flex aspect-[4/5] w-full items-center justify-center rounded-xl border border-dashed px-4 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
              isDragging
                ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]"
                : "border-[color:var(--color-border)] bg-[color:var(--color-surface-soft)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)]"
            )}
          >
            <div className="flex flex-col items-center gap-2 text-[color:var(--color-text-secondary)]">
              <div className="size-14 rounded-full border border-dashed border-current/30 flex items-center justify-center">
                <Camera className="size-6" />
              </div>
              <div className="text-sm">
                <span className="font-medium text-[color:var(--color-foreground)]">Tap to upload</span> or drop an image
              </div>
              <div className="text-xs">PNG, JPG, HEIC up to ~10MB</div>
              {isPreprocessing && <div className="mt-1 text-xs">Optimizing photo…</div>}
            </div>
          </button>
        ) : (
          <div className="w-full overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
            <div className="relative w-full aspect-[4/5]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Selected garment" className="h-full w-full object-cover" />
              {isPreprocessing && (
                <div className="absolute bottom-2 right-2 rounded-md border border-[color:var(--color-border-muted)] bg-[color:var(--color-surface-strong)] px-2 py-1 text-[11px]">
                  Optimizing…
                </div>
              )}
              <div className="absolute top-2 right-2 rounded-md border border-[color:var(--color-border-muted)] bg-[color:var(--color-surface-strong)] px-2 py-1 text-[11px]">
                {plannedImagesCount} image{plannedImagesCount > 1 ? "s" : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-muted)] p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{selectedFile?.name || "Selected image"}</p>
                <p className="text-xs text-[color:var(--color-text-secondary)]">
                  {selectedFile?.size ? `${Math.round(selectedFile.size / 1024)} KB` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTriggerPick}
                  className="h-9 rounded-lg bg-[color:var(--color-accent)] px-3 text-sm font-medium text-[color:var(--color-accent-contrast)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="h-9 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4">
        <label className="text-xs text-[color:var(--color-text-secondary)]" htmlFor="listing-title">
          Listing title
        </label>
        <input
          id="listing-title"
          type="text"
          placeholder="Give this generation a name"
          className="mt-2 h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-describedby={titleDescriptionId}
        />
        {titleHelpText ? (
          <p id={titleDescriptionId} className="mt-2 text-xs text-[color:var(--color-text-secondary)]">
            {titleHelpText}
          </p>
        ) : null}
      </div>
    </div>
  );
}
