"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function setImageFile(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    setImageFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    setImageFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleTriggerPick() {
    fileInputRef.current?.click();
  }

  async function handleGenerate() {
    if (!selectedFile) return;
    try {
      setIsGenerating(true);
      // TODO: Wire up API call to your generation backend
      await new Promise((r) => setTimeout(r, 1200));
      console.log("Generate with file:", selectedFile);
      alert("Pretend we generated an image! (hook up backend next)");
    } finally {
      setIsGenerating(false);
    }
  }

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 p-5 max-w-md w-full mx-auto flex flex-col gap-5">
        <header className="pt-2">
          <h1 className="text-xl font-semibold tracking-tight">VintedBoost</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload a clothing photo. We will place it on a model.
          </p>
        </header>

        <section>
          <input
            ref={fileInputRef}
            id="file"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {!previewUrl ? (
            <button
              type="button"
              onClick={handleTriggerPick}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`w-full aspect-[4/5] rounded-2xl border text-center flex items-center justify-center px-4 transition-colors ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5"
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <div className="size-12 rounded-full border border-dashed border-current/30 flex items-center justify-center text-gray-500">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="size-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M3 15.75V18a3 3 0 003 3h12a3 3 0 003-3v-2.25M7.5 9 12 4.5 16.5 9M12 4.5V15"
                    />
                  </svg>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Tap to upload</span> or drop an image
                </div>
                <div className="text-xs text-gray-500">PNG, JPG, HEIC up to ~10MB</div>
              </div>
            </button>
          ) : (
            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-[4/5] bg-black/5">
                {/* Using img for local blob preview to avoid domain config */}
                <img
                  src={previewUrl}
                  alt="Selected garment preview"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    {selectedFile?.name || "Selected image"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(selectedFile?.size ? Math.round(selectedFile.size / 1024) : 0)} KB
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleTriggerPick}
                    className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="h-1" />
      </main>

      <div className="sticky bottom-0 z-10 w-full bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-black/10 dark:border-white/15">
        <div className="max-w-md mx-auto p-4 flex gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedFile || isGenerating}
            className={`flex-1 h-12 rounded-xl text-base font-semibold active:translate-y-px transition-opacity ${
              !selectedFile || isGenerating
                ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                : "bg-foreground text-background"
            }`}
          >
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="size-5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  ></path>
                </svg>
                Generating…
              </span>
            ) : (
              "Generate"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
