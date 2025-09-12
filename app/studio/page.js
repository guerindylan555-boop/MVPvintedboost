"use client";

import { useEffect, useMemo, useState } from "react";

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState("environment"); // environment | model
  // Environment tab state
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [sources, setSources] = useState([]);
  const [generated, setGenerated] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [defaultNames, setDefaultNames] = useState({}); // s3_key -> name
  const [defaults, setDefaults] = useState([]); // [{s3_key,name,url}]
  // Model tab state
  const [modelPrompt, setModelPrompt] = useState("");
  const [isModelGenerating, setIsModelGenerating] = useState(false);
  const [modelPreviewUrl, setModelPreviewUrl] = useState(null);
  const [maleFile, setMaleFile] = useState(null);
  const [malePreview, setMalePreview] = useState(null);
  const [femaleFile, setFemaleFile] = useState(null);
  const [femalePreview, setFemalePreview] = useState(null);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
      if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
      if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    };
  }, [previewUrl, modelPreviewUrl, malePreview, femalePreview]);

  // (Old random prompt suggestions removed – Random now triggers backend generation)

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      // If user entered a prompt, use /env/generate (instruction + prompt). Else fallback to /env/random.
      const endpoint = prompt.trim() ? "/env/generate" : "/env/random";
      let res;
      if (endpoint === "/env/generate") {
        const form = new FormData();
        form.append("prompt", prompt.trim());
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
      } else {
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST" });
      }
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

  async function handleRandomGenerate() {
    try {
      setIsGenerating(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/random`, { method: "POST" });
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
    // Upload selected files to backend as environment sources
    (async () => {
      try {
        if (bulkFiles.length === 0) return alert("Choose files first");
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const form = new FormData();
        for (const f of bulkFiles) form.append("files", f);
        const res = await fetch(`${baseUrl}/env/sources/upload`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        alert("Uploaded sources.");
      } catch (e) {
        console.error(e);
        alert("Bulk upload failed.");
      }
    })();
  }

  async function refreshSources() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/sources`);
      const data = await res.json();
      if (data?.items) setSources(data.items);
    } catch {}
  }

  async function refreshGenerated() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/generated`);
      const data = await res.json();
      if (data?.items) setGenerated(data.items);
    } catch {}
  }

  async function refreshDefaults() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/defaults`);
      const data = await res.json();
      if (data?.items) setDefaults(data.items);
    } catch {}
  }

  useEffect(() => {
    refreshSources();
    refreshGenerated();
    refreshDefaults();
  }, []);

  function toggleSelect(key) {
    setSelectedKeys((prev) => {
      const has = prev.includes(key);
      if (has) return prev.filter((k) => k !== key);
      if (prev.length >= 5) return prev; // limit 5
      return [...prev, key];
    });
  }

  async function saveDefaults() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const form = new FormData();
      for (const k of selectedKeys) form.append("s3_keys", k);
      for (const k of selectedKeys) form.append("names", defaultNames[k] || "Untitled");
      const res = await fetch(`${baseUrl}/env/defaults`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      // Refresh and clear selection for clarity
      await refreshDefaults();
      setSelectedKeys([]);
      setDefaultNames({});
      alert("Defaults saved");
    } catch (e) {
      console.error(e);
      alert("Failed to save defaults");
    }
  }

  async function deleteAllSources() {
    if (!confirm("Delete all uploaded sources? This cannot be undone.")) return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/sources`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await refreshSources();
      alert("All sources deleted");
    } catch (e) {
      console.error(e);
      alert("Failed to delete sources");
    }
  }

  function onPickMale(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
    setMaleFile(f);
    setMalePreview(URL.createObjectURL(f));
  }

  function onPickFemale(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    setFemaleFile(f);
    setFemalePreview(URL.createObjectURL(f));
  }

  async function handleModelGenerate() {
    if (!modelPrompt.trim()) return;
    try {
      setIsModelGenerating(true);
      // For now, model generation uses text-only endpoint. Images will be used later.
      const form = new FormData();
      form.append("prompt", modelPrompt.trim());
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/generate`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
      setModelPreviewUrl(url);
    } catch (err) {
      console.error(err);
      alert("Model generation failed.");
    } finally {
      setIsModelGenerating(false);
    }
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
            }`}
            onClick={() => setActiveTab("model")}
          >
            Model
          </button>
        </div>

        {/* Environment tab */}
        {activeTab === "environment" && (
          <section className="flex flex-col gap-4">
            {defaults.length > 0 && (
              <div className="sticky top-0 z-10 -mx-5 px-5 py-2 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-black/10 dark:border-white/15">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Defaults</h3>
                  <span className="text-[10px] text-gray-500">{defaults.length} saved</span>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {defaults.map((d) => (
                    <div key={d.s3_key} className="relative flex-shrink-0 size-16 rounded-md overflow-hidden border border-black/10 dark:border-white/15" title={d.name}>
                      <img src={d.url || `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/env/image?s3_key=${encodeURIComponent(d.s3_key)}`} alt={d.name} className="h-full w-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 text-[9px] bg-black/60 text-white px-1 truncate">{d.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                onClick={handleRandomGenerate}
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

            {/* Generated env grid below the preview */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Recent generated environments</h3>
                <button
                  type="button"
                  onClick={refreshGenerated}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
              {generated.length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No generated images yet.</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {generated.map((g) => {
                      const selected = selectedKeys.includes(g.s3_key);
                      const src = g.url || `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/env/image?s3_key=${encodeURIComponent(g.s3_key)}`;
                      return (
                        <button
                          key={g.s3_key}
                          type="button"
                          className={`relative rounded-md overflow-hidden border aspect-square ${selected ? "border-blue-500" : "border-black/10 dark:border-white/15"}`}
                          onClick={() => toggleSelect(g.s3_key)}
                          title={g.s3_key}
                        >
                          <img src={src} alt="Generated" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                  {/* Naming inputs for selected */}
                  {selectedKeys.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Selected ({selectedKeys.length}/5)</span>
                        <button
                          type="button"
                          onClick={saveDefaults}
                          className="h-9 px-3 rounded-md bg-foreground text-background text-xs font-medium"
                        >
                          Save defaults
                        </button>
                      </div>
                  {selectedKeys.map((k) => (
                    <div key={k} className="grid grid-cols-3 gap-2 items-center">
                      <span className="col-span-2 truncate text-xs">{k}</span>
                      <input
                        type="text"
                        placeholder="Name"
                        className="h-9 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-xs"
                        value={defaultNames[k] || ""}
                        onChange={(e) => setDefaultNames((d) => ({ ...d, [k]: e.target.value }))}
                      />
                    </div>
                  ))}
                    </div>
                  )}
                </>
              )}
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
              {/* Sources list */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Uploaded sources</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={refreshSources}
                      className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                    >
                      Refresh
                    </button>
                    {sources.length > 0 && (
                      <button
                        type="button"
                        onClick={deleteAllSources}
                        className="h-9 px-3 rounded-md bg-red-600 text-white text-xs font-medium"
                      >
                        Delete all
                      </button>
                    )}
                  </div>
                </div>
                {sources.length === 0 ? (
                  <p className="text-xs text-gray-500 mt-2">No sources uploaded.</p>
                ) : (
                  <ul className="mt-2 text-xs text-gray-500 break-all">
                    {sources.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Model tab */}
        {activeTab === "model" && (
          <section className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-gray-500">Prompt</label>
              <textarea
                rows={3}
                placeholder="Describe the human model scene (e.g., full-body portrait, casual pose)"
                className="mt-1 w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
                value={modelPrompt}
                onChange={(e) => setModelPrompt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModelPrompt("Studio portrait, soft lighting, neutral background")}
                className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
              >
                Random
              </button>
              <button
                type="button"
                onClick={handleModelGenerate}
                disabled={!modelPrompt.trim() || isModelGenerating}
                className={`h-10 px-4 rounded-md text-sm font-semibold active:translate-y-px ${
                  !modelPrompt.trim() || isModelGenerating
                    ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                    : "bg-foreground text-background"
                }`}
              >
                {isModelGenerating ? "Generating…" : "Generate"}
              </button>
            </div>

            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-video bg-black/5 flex items-center justify-center">
                {modelPreviewUrl ? (
                  <img src={modelPreviewUrl} alt="Generated model" className="h-full w-full object-cover" />
                ) : (
                  <p className="text-xs text-gray-500">Your generated model will appear here.</p>
                )}
              </div>
            </div>

            {/* Generated images grid */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Recent generated environments</h3>
                <button
                  type="button"
                  onClick={refreshGenerated}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
              {generated.length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No generated images yet.</p>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {generated.map((g) => {
                    const src = g.url || `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/env/image?s3_key=${encodeURIComponent(g.s3_key)}`;
                    return (
                      <div key={g.s3_key} className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15 aspect-square">
                        <img src={src} alt="Generated" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Two source images (male/female) */}
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Male source image</label>
                <div className="mt-1 rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
                  <div className="relative w-full aspect-[4/5] bg-black/5">
                    {malePreview ? (
                      <img src={malePreview} alt="Male source" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">None</div>
                    )}
                  </div>
                  <div className="p-2 flex gap-2">
                    <label className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={onPickMale} />
                      Choose
                    </label>
                    {malePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
                          setMalePreview(null);
                          setMaleFile(null);
                        }}
                        className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Female source image</label>
                <div className="mt-1 rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
                  <div className="relative w-full aspect-[4/5] bg-black/5">
                    {femalePreview ? (
                      <img src={femalePreview} alt="Female source" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">None</div>
                    )}
                  </div>
                  <div className="p-2 flex gap-2">
                    <label className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={onPickFemale} />
                      Choose
                    </label>
                    {femalePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
                          setFemalePreview(null);
                          setFemaleFile(null);
                        }}
                        className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
