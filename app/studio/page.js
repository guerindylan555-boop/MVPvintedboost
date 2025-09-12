"use client";

import { useEffect, useMemo, useState } from "react";

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState("environment"); // environment | model
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const randomPrompts = useMemo(
    () => [
      "Minimalist photo studio with seamless white backdrop and softbox lighting",
      "Urban street at dusk with neon reflections and wet pavement",
      "Cozy bedroom interior with warm lamps and wooden floor",
      "Beach at golden hour with gentle waves and clean horizon",
      "Modern indoor loft with large windows and natural light",
    ],
    []
  );

  function fillRandom() {
    const next = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    setPrompt(next);
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    try {
      setIsGenerating(true);
      const form = new FormData();
      form.append("prompt", prompt.trim());
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/generate`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch (err) {
      console.error(err);
      alert("Environment generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleBulkChange(e) {
    const files = Array.from(e.target.files || []);
    setBulkFiles(files);
  }

  function handleBulkUpload() {
    alert("Admin only feature. Coming soon.");
  }

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 p-5 max-w-2xl w-full mx-auto flex flex-col gap-5">
        <header className="pt-2">
          <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Generate environment or human model scenes.</p>
        </header>

        {/* Tabs */}
        <div className="grid grid-cols-2 rounded-lg border border-black/10 dark:border-white/15 overflow-hidden">
          <button
            className={`h-10 text-sm font-medium ${
              activeTab === "environment" ? "bg-foreground text-background" : "bg-transparent"
            }`}
            onClick={() => setActiveTab("environment")}
          >
            Environment
          </button>
          <button
            className={`h-10 text-sm font-medium ${
              activeTab === "model" ? "bg-foreground text-background" : "bg-transparent"
            } opacity-60`}
            onClick={() => setActiveTab("model")}
            disabled
            title="Coming soon"
          >
            Model
          </button>
        </div>

        {/* Environment tab */}
        {activeTab === "environment" && (
          <section className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-gray-500">Prompt</label>
              <textarea
                rows={3}
                placeholder="Describe the environment to generate (e.g., lush garden at sunrise with mist)"
                className="mt-1 w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fillRandom}
                className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
              >
                Random
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className={`h-10 px-4 rounded-md text-sm font-semibold active:translate-y-px ${
                  !prompt.trim() || isGenerating
                    ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                    : "bg-foreground text-background"
                }`}
              >
                {isGenerating ? "Generating…" : "Generate"}
              </button>
            </div>

            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-video bg-black/5 flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} alt="Generated environment" className="h-full w-full object-cover" />
                ) : (
                  <p className="text-xs text-gray-500">Your generated environment will appear here.</p>
                )}
              </div>
            </div>

            {/* Bulk upload (Admin only) */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Bulk upload images</h2>
                <span className="text-xs text-gray-500">Admin only</span>
              </div>
              <div className="mt-2 grid gap-2">
                <input
                  id="bulk"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleBulkChange}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-black/10 dark:file:border-white/15 file:px-3 file:py-2 file:bg-transparent file:text-sm"
                />
                {bulkFiles.length > 0 && (
                  <ul className="text-xs text-gray-500 list-disc ml-4">
                    {bulkFiles.map((f) => (
                      <li key={f.name}>{f.name} ({Math.round(f.size / 1024)} KB)</li>
                    ))}
                  </ul>
                )}
                <div>
                  <button
                    type="button"
                    onClick={handleBulkUpload}
                    className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                  >
                    Upload (disabled)
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Model tab placeholder */}
        {activeTab === "model" && (
          <section>
            <p className="text-sm text-gray-500">Model generation coming soon.</p>
          </section>
        )}
      </main>
    </div>
  );
}
