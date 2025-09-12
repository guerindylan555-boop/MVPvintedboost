"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const allowedPoses = ["standing", "sitting", "lying down", "walking"];
  const [options, setOptions] = useState({
    gender: "woman",
    environment: "studio",
    poses: ["standing"],
    extra: "",
  });
  const [history, setHistory] = useState([]); // [{id, dataUrl, createdAt, prompt, options}]

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vb_history");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {}
  }, []);

  function persistHistory(next) {
    setHistory(next);
    try {
      localStorage.setItem("vb_history", JSON.stringify(next));
    } catch {}
  }

  function buildPrompt() {
    const chunks = ["Put this clothing item on a realistic person model."];
    if (options.gender) chunks.push(`Gender: ${options.gender}.`);
    if (options.environment) chunks.push(`Environment: ${options.environment}.`);
    if (Array.isArray(options.poses) && options.poses.length > 0) {
      const list = options.poses.join(", ");
      chunks.push(`Poses: ${list}.`);
    }
    if (options.extra?.trim()) chunks.push(options.extra.trim());
    chunks.push("Realistic fit, high-quality fashion photo, natural lighting.");
    return chunks.join(" ");
  }

  function togglePose(pose) {
    setOptions((o) => {
      const has = o.poses.includes(pose);
      if (has) {
        return { ...o, poses: o.poses.filter((p) => p !== pose) };
      }
      // limit to 3
      if (o.poses.length >= 3) return o;
      return { ...o, poses: [...o.poses, pose] };
    });
  }

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
      const form = new FormData();
      // unified request: send structured fields; backend builds prompt
      form.append("image", selectedFile);
      form.append("gender", options.gender);
      form.append("environment", options.environment);
      if (Array.isArray(options.poses)) {
        for (const p of options.poses) form.append("poses", p);
      }
      form.append("extra", options.extra || "");

      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/edit`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed: ${res.status}`);
      }

      const blob = await res.blob();
      // Convert to data URL for durable storage
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      if (previewUrl && typeof previewUrl === "string" && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(String(dataUrl));

      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dataUrl: String(dataUrl),
        createdAt: Date.now(),
        prompt: buildPrompt(),
        options,
      };
      const next = [item, ...history].slice(0, 12);
      persistHistory(next);
    } catch (err) {
      console.error(err);
      alert("Generation failed. Check backend logs and API key.");
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

        {/* Options */}
        <section className="mt-1">
          <button
            type="button"
            className="w-full flex items-center justify-between py-3"
            onClick={() => setOptionsOpen((s) => !s)}
          >
            <span className="text-sm font-medium">Options</span>
            <span className="text-xs text-gray-500">{optionsOpen ? "Hide" : "Show"}</span>
          </button>
          {optionsOpen && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Gender</label>
                <select
                  className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                  value={options.gender}
                  onChange={(e) => setOptions((o) => ({ ...o, gender: e.target.value }))}
                >
                  <option value="woman">Woman</option>
                  <option value="man">Man</option>
                  <option value="unisex">Unisex</option>
                </select>
              </div>
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Environment</label>
                <select
                  className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                  value={options.environment}
                  onChange={(e) => setOptions((o) => ({ ...o, environment: e.target.value }))}
                >
                  <option value="studio">Studio</option>
                  <option value="street">Street</option>
                  <option value="bed">Bed</option>
                  <option value="beach">Beach</option>
                  <option value="indoor">Indoor</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Poses (up to 3)</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {allowedPoses.map((pose) => {
                    const selected = options.poses.includes(pose);
                    const limitReached = !selected && options.poses.length >= 3;
                    return (
                      <label key={pose} className={`flex items-center gap-2 text-sm rounded-md border px-3 py-2 ${selected ? "border-foreground" : "border-black/10 dark:border-white/15"}`}>
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selected}
                          disabled={limitReached}
                          onChange={() => togglePose(pose)}
                        />
                        {pose}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Extra instructions</label>
                <input
                  type="text"
                  placeholder="e.g., natural daylight, smiling, medium shot"
                  className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                  value={options.extra}
                  onChange={(e) => setOptions((o) => ({ ...o, extra: e.target.value }))}
                />
              </div>
            </div>
          )}
        </section>

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

        {/* History */}
        <section className="mt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">History</h2>
            {history.length > 0 && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => persistHistory([])}
              >
                Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-gray-500 mt-2">No generations yet.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15 aspect-square"
                  onClick={() => setPreviewUrl(item.dataUrl)}
                  title={new Date(item.createdAt).toLocaleString()}
                >
                  <img src={item.dataUrl} alt="History" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>
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
