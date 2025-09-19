"use client";

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
  onTriggerPick,
  onTriggerCamera,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
  onClearSelection,
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/15 dark:bg-white/5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Upload garment</h2>
          <p className="text-xs text-foreground/60">Drop a clear photo of the item you want the model to wear.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={onTriggerCamera}
            className="inline-flex items-center gap-2 rounded-full border border-foreground/20 px-3 py-1.5 font-semibold text-foreground transition hover:border-foreground/40"
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
            className={`flex aspect-[4/5] w-full items-center justify-center rounded-xl border border-dashed px-4 text-center transition-colors ${
              isDragging ? "border-blue-500 bg-blue-500/10" : "border-foreground/20 hover:border-foreground/40"
            }`}
          >
            <div className="flex flex-col items-center gap-2 text-foreground/70">
              <div className="size-14 rounded-full border border-dashed border-current/30 flex items-center justify-center">
                <Camera className="size-6" />
              </div>
              <div className="text-sm">
                <span className="font-medium text-foreground">Tap to upload</span> or drop an image
              </div>
              <div className="text-xs">PNG, JPG, HEIC up to ~10MB</div>
              {isPreprocessing && <div className="mt-1 text-xs">Optimizing photo…</div>}
            </div>
          </button>
        ) : (
          <div className="w-full overflow-hidden rounded-xl border border-foreground/15 bg-background/40">
            <div className="relative w-full aspect-[4/5]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Selected garment" className="h-full w-full object-cover" />
              {isPreprocessing && (
                <div className="absolute bottom-2 right-2 rounded-md border border-black/10 bg-background/80 px-2 py-1 text-[11px] dark:border-white/15">
                  Optimizing…
                </div>
              )}
              <div className="absolute top-2 right-2 rounded-md border border-black/10 bg-background/80 px-2 py-1 text-[11px] dark:border-white/15">
                {plannedImagesCount} image{plannedImagesCount > 1 ? "s" : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{selectedFile?.name || "Selected image"}</p>
                <p className="text-xs text-foreground/60">{selectedFile?.size ? `${Math.round(selectedFile.size / 1024)} KB` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onTriggerPick} className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background">Change</button>
                <button type="button" onClick={onClearSelection} className="h-9 rounded-lg border border-foreground/20 px-3 text-sm font-medium">Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4">
        <label className="text-xs text-foreground/70">Listing title</label>
        <input
          type="text"
          placeholder="Give this generation a name"
          className="mt-2 h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </div>
    </div>
  );
}
