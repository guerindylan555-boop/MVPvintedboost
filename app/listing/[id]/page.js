"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { toast } from "react-hot-toast";
import { createAuthClient } from "better-auth/react";
import { ChevronLeft, ChevronRight, Maximize2, X as XIcon } from "lucide-react";
import { getApiBase, withUserId } from "@/app/lib/api";

const authClient = createAuthClient();

export default function ListingPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: session } = authClient.useSession();
  const userId = session?.session?.userId || session?.user?.id || session?.user?.email || null;

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settingCover, setSettingCover] = useState(false);
  const [genDescLoading, setGenDescLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState({}); // { [s3_key]: boolean }
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [descEnabled, setDescEnabled] = useState(false);
  const [desc, setDesc] = useState({ brand: "", productModel: "", size: "" });
  const [productCondition, setProductCondition] = useState("");

  useEffect(() => {
    (async () => {
      if (!id || !userId) return;
      setLoading(true);
      setError(null);
      const baseUrl = getApiBase();
      try {
        const res = await fetch(`${baseUrl}/listing/${id}`, { headers: withUserId({}, userId) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setListing(data);
      } catch (e) {
        setError("Failed to load listing");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, userId]);

  useEffect(() => {
    if (Array.isArray(listing?.images) && listing.images.length > 0) {
      setActiveImageIndex(0);
      setViewerIndex(0);
    }
  }, [listing?.images]);

  const galleryImages = useMemo(() => {
    const generated = Array.isArray(listing?.images)
      ? listing.images.map((img) => ({ ...img, __kind: "generated" }))
      : [];
    if (listing?.source_url) {
      return [
        {
          s3_key: listing?.source_s3_key || "__source__",
          url: listing.source_url,
          pose: "Source garment",
          __kind: "source",
        },
        ...generated,
      ];
    }
    return generated;
  }, [listing?.images, listing?.source_url, listing?.source_s3_key]);

  const settings = listing?.settings || {};
  const hasDescription = typeof listing?.description_text === "string" && listing.description_text.trim().length > 0;

  const gallerySize = galleryImages.length;
  const activeImage = galleryImages[activeImageIndex] || null;
  const activeIsSource = isSourceImage(activeImage);
  const activeKey = activeImage?.s3_key;
  const activePromptVisible = activeKey ? showPrompt[activeKey] : false;
  const viewerImage = galleryImages[viewerIndex] || null;
  const viewerIsSource = isSourceImage(viewerImage);
  const viewerKey = viewerImage?.s3_key;
  const viewerPromptVisible = viewerKey ? showPrompt[viewerKey] : false;

  const handleViewerNext = useCallback(() => {
    if (gallerySize === 0) return;
    setViewerIndex((prev) => (prev + 1) % gallerySize);
  }, [gallerySize]);

  const handleViewerPrev = useCallback(() => {
    if (gallerySize === 0) return;
    setViewerIndex((prev) => (prev - 1 + gallerySize) % gallerySize);
  }, [gallerySize]);

  useEffect(() => {
    if (!viewerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setViewerOpen(false);
      if (event.key === "ArrowRight") handleViewerNext();
      if (event.key === "ArrowLeft") handleViewerPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen, handleViewerNext, handleViewerPrev]);

  async function setCover(s3Key) {
    if (!id || !userId || !s3Key) return;
    setSettingCover(true);
    const baseUrl = getApiBase();
    try {
      const form = new FormData();
      form.append("s3_key", s3Key);
      const res = await fetch(`${baseUrl}/listing/${id}/cover`, { method: "PATCH", body: form, headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Cover updated");
      const r = await fetch(`${baseUrl}/listing/${id}`, { headers: withUserId({}, userId) });
      if (r.ok) setListing(await r.json());
    } catch (e) {
      toast.error(e?.message || "Failed to set cover");
    }
    setSettingCover(false);
  }

  async function generateDescription() {
    if (!id || !userId) return;
    setGenDescLoading(true);
    const baseUrl = getApiBase();
    try {
      const form = new FormData();
      if (settings.gender) form.append("gender", settings.gender);
      if (descEnabled) {
        const brand = desc.brand.trim();
        const modelName = desc.productModel.trim();
        const size = desc.size.trim();
        if (brand) form.append("brand", brand);
        if (modelName) form.append("model_name", modelName);
        if (size) form.append("size", size.toUpperCase());
        if (productCondition) form.append("condition", productCondition);
      }
      const res = await fetch(`${baseUrl}/listing/${id}/describe`, { method: "POST", body: form, headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      const refreshed = await fetch(`${baseUrl}/listing/${id}`, { headers: withUserId({}, userId) });
      if (refreshed.ok) {
        setListing(await refreshed.json());
        toast.success("Description generated");
      }
    } catch (e) {
      toast.error(e?.message || "Failed to generate description");
    }
    setGenDescLoading(false);
  }

  function togglePromptFor(s3Key) {
    if (!s3Key) return;
    setShowPrompt((m) => ({ ...m, [s3Key]: !m[s3Key] }));
  }

  function isSourceImage(img) {
    return img?.__kind === "source";
  }

  function openViewer(index) {
    setViewerIndex(index);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
  }

  if (!id) return <div className="p-5">Invalid listing id</div>;
  if (loading) return <div className="p-5 text-sm text-foreground/60">Loading…</div>;
  if (error) return <div className="p-5 text-sm text-red-500">{error}</div>;
  if (!listing?.ok) return <div className="p-5 text-sm text-foreground/60">Not found.</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-xs text-foreground/60">
        <Link href="/" className="inline-flex items-center gap-1 text-sm underline">
          ← Back to create
        </Link>
        <span>{new Date(listing.created_at).toLocaleString()}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Generated gallery</h2>
              {activeImage && (
                <button
                  type="button"
                  onClick={() => openViewer(activeImageIndex)}
                  className="inline-flex items-center gap-1 rounded-full border border-foreground/20 px-3 py-1 text-xs"
                >
                  <Maximize2 className="size-3" />
                  View full
                </button>
              )}
            </div>
            <div className="mt-4">
              {activeImage ? (
                <div className="flex flex-col gap-3">
                  <div className="relative overflow-hidden rounded-2xl border border-foreground/15 bg-background/40">
                    <div className="aspect-[4/5] w-full">
                      <Image
                        src={activeImage.url}
                        alt={activeImage.pose || "Generated image"}
                        fill
                        sizes="(max-width: 1024px) 100vw, 60vw"
                        className="object-cover"
                        onClick={() => openViewer(activeImageIndex)}
                      />
                    </div>
                    {!activeIsSource && listing.cover_s3_key === activeKey && (
                      <span className="absolute left-3 top-3 rounded-full border border-foreground/20 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                        Cover
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-foreground/15 px-3 py-1">{activeIsSource ? "Source garment" : activeImage.pose || "image"}</span>
                    {activeKey && (
                      <button
                        type="button"
                        onClick={() => setCover(activeKey)}
                        disabled={settingCover || listing.cover_s3_key === activeKey}
                        className={`rounded-full border px-3 py-1 font-medium ${
                          listing.cover_s3_key === activeKey ? "border-foreground bg-foreground/10" : "border-foreground/20"
                        } ${settingCover ? "opacity-60" : ""}`}
                      >
                        {listing.cover_s3_key === activeKey ? "Current cover" : "Set as cover"}
                      </button>
                    )}
                    {!activeIsSource && activeKey && (
                      <button
                        type="button"
                        onClick={() => togglePromptFor(activeKey)}
                        className="rounded-full border border-foreground/20 px-3 py-1 font-medium"
                      >
                        {activePromptVisible ? "Hide prompt" : "Show prompt"}
                      </button>
                    )}
                  </div>
                  {!activeIsSource && activePromptVisible && (
                    <pre className="max-h-48 overflow-auto rounded-xl border border-foreground/15 bg-background/50 p-4 text-xs leading-relaxed">
                      {activeImage.prompt || "No prompt stored."}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center rounded-2xl border border-dashed border-foreground/20 text-sm text-foreground/60">
                  No images generated yet.
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto">
              {galleryImages.map((img, index) => {
                const key = img.s3_key || `image-${index}`;
                const label = isSourceImage(img) ? "Source garment" : img.pose || "image";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    className={`relative h-24 w-20 flex-shrink-0 overflow-hidden rounded-xl border ${
                      index === activeImageIndex ? "border-foreground" : "border-foreground/20"
                    }`}
                    title={label}
                  >
                    {img.url ? (
                      <Image src={img.url} alt={label} fill sizes="80px" className="object-cover" />
                    ) : (
                      <div className="h-full w-full bg-foreground/10" />
                    )}
                    {isSourceImage(img) && (
                      <span className="absolute left-1 top-1 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] uppercase">
                        Source
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 text-sm dark:border-white/15 dark:bg-white/5">
            <h3 className="text-sm font-semibold">Listing settings</h3>
            <dl className="mt-3 grid gap-2 text-xs text-foreground/70">
              <div className="flex justify-between gap-2"><dt className="font-medium text-foreground/80">Gender</dt><dd>{settings.gender || "–"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="font-medium text-foreground/80">Environment</dt><dd>{settings.environment || "–"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="font-medium text-foreground/80">Garment type</dt><dd>{settings.garment_type || "auto"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="font-medium text-foreground/80">Poses</dt><dd>{Array.isArray(settings.poses) && settings.poses.length ? settings.poses.join(", ") : "–"}</dd></div>
              <div><dt className="font-medium text-foreground/80">Notes</dt><dd className="mt-1 text-foreground/60">{settings.extra || "–"}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Description</h3>
              {hasDescription && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(listing.description_text);
                      toast.success("Copied");
                    } catch {}
                  }}
                  className="text-xs underline"
                >
                  Copy
                </button>
              )}
            </div>
            <div className="mt-3 space-y-3 rounded-xl border border-foreground/15 bg-background/40 p-4">
              <div className="flex items-center justify-between text-xs text-foreground/70">
                <span>Include product details</span>
                <button
                  type="button"
                  onClick={() => setDescEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                    descEnabled ? "bg-foreground" : "bg-foreground/30"
                  }`}
                  aria-pressed={descEnabled}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-background transition ${
                      descEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              {descEnabled && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <input
                    type="text"
                    className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/60 px-3"
                    placeholder="Brand (e.g., Nike, Zara)"
                    value={desc.brand}
                    onChange={(e) => setDesc((d) => ({ ...d, brand: e.target.value }))}
                  />
                  <input
                    type="text"
                    className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/60 px-3"
                    placeholder="Model (e.g., Air Max 90)"
                    value={desc.productModel}
                    onChange={(e) => setDesc((d) => ({ ...d, productModel: e.target.value }))}
                  />
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {["Brand new", "Very good", "Good"].map((condition) => (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => setProductCondition(condition)}
                        className={`h-8 rounded-full border px-3 text-xs ${
                          productCondition === condition ? "border-foreground" : "border-foreground/20"
                        }`}
                      >
                        {condition}
                      </button>
                    ))}
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {["xs", "s", "m", "l", "xl"].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setDesc((d) => ({ ...d, size }))}
                        className={`h-8 rounded-full border px-3 text-xs uppercase ${
                          desc.size === size ? "border-foreground" : "border-foreground/20"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {hasDescription ? (
              <>
                <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-foreground/15 bg-background/40 p-4 text-sm leading-relaxed">
                  {listing.description_text}
                </pre>
                <button
                  type="button"
                  onClick={generateDescription}
                  disabled={genDescLoading}
                  className={`mt-3 h-9 w-full rounded-lg border border-foreground/20 px-3 text-sm font-semibold ${
                    genDescLoading ? "opacity-60" : ""
                  }`}
                >
                  {genDescLoading ? "Regenerating…" : "Regenerate description"}
                </button>
              </>
            ) : (
              <div className="mt-3 flex flex-col gap-2 text-xs text-foreground/60">
                <p>No description generated.</p>
                <button
                  type="button"
                  onClick={generateDescription}
                  disabled={genDescLoading}
                  className={`h-9 w-full rounded-lg border border-foreground/20 px-3 text-sm font-semibold ${genDescLoading ? "opacity-60" : ""}`}
                >
                  {genDescLoading ? "Generating…" : "Generate description"}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {viewerOpen && galleryImages.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <button
            type="button"
            onClick={closeViewer}
            className="absolute right-4 top-4 rounded-full border border-white/20 p-2 text-white"
            aria-label="Close viewer"
          >
            <XIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleViewerPrev}
            className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/20 text-white"
            aria-label="Previous image"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={handleViewerNext}
            className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/20 text-white"
            aria-label="Next image"
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="max-h-[85vh] max-w-[90vw] overflow-hidden rounded-2xl border border-white/20 bg-black/40 p-4">
            {viewerImage ? (
              <>
                <div className="relative mx-auto aspect-[4/5] w-[min(70vw,420px)]">
                  <Image
                    src={viewerImage.url}
                    alt={viewerIsSource ? "Source garment" : viewerImage.pose || "Generated image"}
                    fill
                    sizes="(max-width: 1024px) 80vw, 400px"
                    className="object-contain"
                  />
                  <span className="absolute left-3 top-3 rounded-full border border-white/30 bg-black/60 px-3 py-1 text-xs uppercase text-white">
                    {viewerIsSource ? "source garment" : viewerImage.pose || "image"}
                  </span>
                </div>
                {!viewerIsSource && viewerPromptVisible && (
                  <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/20 bg-black/60 p-4 text-xs text-white">
                    {viewerImage.prompt || "No prompt stored."}
                  </pre>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
                  {!viewerIsSource && viewerKey && (
                    <button
                      type="button"
                      onClick={() => togglePromptFor(viewerKey)}
                      className="rounded-full border border-white/30 px-3 py-1"
                    >
                      {viewerPromptVisible ? "Hide prompt" : "Show prompt"}
                    </button>
                  )}
                  <span>
                    {viewerIndex + 1} / {galleryImages.length}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
