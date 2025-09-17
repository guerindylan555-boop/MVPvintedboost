"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { toast } from "react-hot-toast";
import { createAuthClient } from "better-auth/react";
import { ChevronLeft, ChevronRight, Maximize2, X as XIcon } from "lucide-react";
import { getApiBase, withUserId } from "@/app/lib/api";
import { buildMirrorSelfiePreview } from "@/app/lib/prompt-preview";

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
  const [regenLoading, setRegenLoading] = useState({}); // { [pose]: boolean }
  const [regenError, setRegenError] = useState({}); // { [pose]: string }
  const [poseDescs, setPoseDescs] = useState([]); // [{description}]
  const [showPrompt, setShowPrompt] = useState({}); // { [s3_key]: boolean }
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

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
    (async () => {
      try {
        const baseUrl = getApiBase();
        const res = await fetch(`${baseUrl}/pose/descriptions`, { cache: "no-store" });
        const data = await res.json();
        if (data?.items && Array.isArray(data.items)) setPoseDescs(data.items);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (Array.isArray(listing?.images) && listing.images.length > 0) {
      setActiveImageIndex(0);
      setViewerIndex(0);
    }
  }, [listing?.images]);

  const galleryImages = useMemo(() => {
    if (!Array.isArray(listing?.images)) return [];
    return [...listing.images];
  }, [listing?.images]);

  const settings = listing?.settings || {};
  const plannedPoses = useMemo(() => (Array.isArray(settings.poses) ? settings.poses.slice(0, 4) : []), [settings.poses]);

  const imagesByPose = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(listing?.images)) return map;
    const taken = new Set();
    for (const pose of plannedPoses) {
      const match = listing.images.find((img) => img.pose === pose && !taken.has(img.s3_key));
      if (match) {
        map.set(pose, match);
        taken.add(match.s3_key);
      }
    }
    return map;
  }, [listing?.images, plannedPoses]);

  const extraImages = useMemo(() => {
    if (!Array.isArray(listing?.images)) return [];
    return listing.images.filter((img) => !plannedPoses.includes(img.pose));
  }, [listing?.images, plannedPoses]);

  const gallerySize = galleryImages.length;
  const activeImage = galleryImages[activeImageIndex] || null;

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

  function buildEffectivePrompt(settingsSnapshot, pose, poseDescText) {
    const envDefaultKey = settingsSnapshot?.env_default_s3_key ? settingsSnapshot.env_default_s3_key : undefined;
    const usingPersonImage = !!(settingsSnapshot?.use_model_image === true && settingsSnapshot?.model_default_s3_key);
    const selectedPose = pose || (Array.isArray(settingsSnapshot?.poses) && settingsSnapshot.poses.length > 0 ? settingsSnapshot.poses[0] : "");
    return buildMirrorSelfiePreview({
      gender: settingsSnapshot?.gender || "",
      environment: settingsSnapshot?.environment || "",
      pose: selectedPose,
      extra: settingsSnapshot?.extra || "",
      usingPersonImage,
      personDesc: "",
      envDefaultKey,
      randomPoseDescription: poseDescText || "",
      forPreview: false,
    });
  }

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

  async function regeneratePose(pose) {
    if (!id || !userId || !listing?.source_url || !pose) return;
    setRegenLoading((s) => ({ ...s, [pose]: true }));
    setRegenError((e) => ({ ...e, [pose]: undefined }));
    const baseUrl = getApiBase();
    try {
      const form = new FormData();
      const s = listing.settings || {};
      if (s.gender) form.append("gender", s.gender);
      if (s.environment) form.append("environment", s.environment);
      form.append("poses", pose);
      if (s.extra) form.append("extra", s.extra);
      if (s.env_default_s3_key) form.append("env_default_s3_key", s.env_default_s3_key);
      if (s.use_model_image === true && s.model_default_s3_key) {
        form.append("model_default_s3_key", s.model_default_s3_key);
      } else if (s.use_model_image == null && s.model_default_s3_key) {
        form.append("model_default_s3_key", s.model_default_s3_key);
      }
      let effectivePrompt = s.prompt_override || "";
      if (!effectivePrompt) {
        let poseDescText;
        if (pose === "random" && Array.isArray(poseDescs) && poseDescs.length > 0) {
          const pick = poseDescs[Math.floor(Math.random() * poseDescs.length)];
          poseDescText = pick?.description || undefined;
        }
        effectivePrompt = buildEffectivePrompt(s, pose, poseDescText);
      } else if (pose === "random" && !/Pose description:/i.test(effectivePrompt)) {
        if (Array.isArray(poseDescs) && poseDescs.length > 0) {
          const pick = poseDescs[Math.floor(Math.random() * poseDescs.length)];
          if (pick?.description) effectivePrompt = `${effectivePrompt}\nPose description: ${pick.description}`;
        }
      }
      if (effectivePrompt) form.append("prompt_override", effectivePrompt);
      form.append("listing_id", id);
      const res = await fetch(`${baseUrl}/edit/json`, { method: "POST", body: form, headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      const refreshed = await fetch(`${baseUrl}/listing/${id}`, { headers: withUserId({}, userId), cache: "no-store" });
      if (refreshed.ok) setListing(await refreshed.json());
      toast.success(`Regenerated ${pose}`);
    } catch (e) {
      setRegenError((er) => ({ ...er, [pose]: e?.message || "Failed to regenerate" }));
      toast.error(e?.message || `Failed to regenerate ${pose}`);
    } finally {
      setRegenLoading((s) => ({ ...s, [pose]: false }));
    }
  }

  function togglePromptFor(s3Key) {
    setShowPrompt((m) => ({ ...m, [s3Key]: !m[s3Key] }));
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
                    {listing.cover_s3_key === activeImage.s3_key && (
                      <span className="absolute left-3 top-3 rounded-full border border-foreground/20 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                        Cover
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-foreground/15 px-3 py-1">{activeImage.pose || "image"}</span>
                    <button
                      type="button"
                      onClick={() => setCover(activeImage.s3_key)}
                      disabled={settingCover || listing.cover_s3_key === activeImage.s3_key}
                      className={`rounded-full border px-3 py-1 font-medium ${
                        listing.cover_s3_key === activeImage.s3_key ? "border-foreground bg-foreground/10" : "border-foreground/20"
                      } ${settingCover ? "opacity-60" : ""}`}
                    >
                      {listing.cover_s3_key === activeImage.s3_key ? "Current cover" : "Set as cover"}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePromptFor(activeImage.s3_key)}
                      className="rounded-full border border-foreground/20 px-3 py-1 font-medium"
                    >
                      {showPrompt[activeImage.s3_key] ? "Hide prompt" : "Show prompt"}
                    </button>
                  </div>
                  {showPrompt[activeImage.s3_key] && (
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
              {galleryImages.map((img, index) => (
                <button
                  key={img.s3_key}
                  type="button"
                  onClick={() => setActiveImageIndex(index)}
                  className={`relative h-24 w-20 flex-shrink-0 overflow-hidden rounded-xl border ${
                    index === activeImageIndex ? "border-foreground" : "border-foreground/20"
                  }`}
                  title={img.pose || "image"}
                >
                  {img.url ? (
                    <Image src={img.url} alt={img.pose || "image"} fill sizes="80px" className="object-cover" />
                  ) : (
                    <div className="h-full w-full bg-foreground/10" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {plannedPoses.length > 0 && (
            <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
              <h3 className="text-sm font-semibold">Pose checklist</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {plannedPoses.map((pose) => {
                  const img = imagesByPose.get(pose);
                  const busy = !!regenLoading[pose];
                  const err = regenError[pose];
                  if (img) {
                    const isCover = listing.cover_s3_key === img.s3_key;
                    return (
                      <div key={img.s3_key} className="space-y-2 rounded-xl border border-foreground/15 bg-background/40 p-3">
                        <div className="relative h-40 w-full overflow-hidden rounded-lg">
                          {img.url ? (
                            <Image src={img.url} alt={pose} fill sizes="200px" className="object-cover" />
                          ) : (
                            <div className="h-full w-full bg-foreground/10" />
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const idx = galleryImages.findIndex((g) => g.s3_key === img.s3_key);
                              if (idx >= 0) setActiveImageIndex(idx);
                              const viewerIdx = galleryImages.findIndex((g) => g.s3_key === img.s3_key);
                              if (viewerIdx >= 0) {
                                setViewerIndex(viewerIdx);
                                setViewerOpen(true);
                              }
                            }}
                            className="absolute right-2 top-2 rounded-full border border-foreground/20 bg-background/80 p-1"
                            title="Open in viewer"
                          >
                            <Maximize2 className="size-3" />
                          </button>
                          <span className="absolute left-2 top-2 rounded-full border border-foreground/20 bg-background/80 px-2 py-1 text-[11px] font-semibold uppercase">
                            {pose}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setCover(img.s3_key)}
                            disabled={settingCover || isCover}
                            className={`rounded-full border px-3 py-1 font-medium ${
                              isCover ? "border-foreground bg-foreground/10" : "border-foreground/20"
                            } ${settingCover ? "opacity-60" : ""}`}
                          >
                            {isCover ? "Cover" : "Set cover"}
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePromptFor(img.s3_key)}
                            className="rounded-full border border-foreground/20 px-3 py-1 font-medium"
                          >
                            {showPrompt[img.s3_key] ? "Hide prompt" : "Show prompt"}
                          </button>
                        </div>
                        {showPrompt[img.s3_key] && (
                          <pre className="max-h-40 overflow-auto rounded-lg border border-foreground/15 bg-background/50 p-3 text-[11px] leading-relaxed">
                            {img.prompt || "No prompt stored."}
                          </pre>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={`missing-${pose}`} className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-foreground/30 bg-transparent p-4 text-center text-xs text-foreground/60">
                      <span>{err ? err : `${pose} not generated yet.`}</span>
                      <button
                        type="button"
                        onClick={() => regeneratePose(pose)}
                        disabled={busy}
                        className={`h-9 rounded-full border px-4 font-medium ${busy ? "opacity-60" : ""}`}
                      >
                        {busy ? "Regenerating…" : "Regenerate"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {extraImages.length > 0 && (
            <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
              <h3 className="text-sm font-semibold">Additional images</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {extraImages.map((img) => (
                  <div key={img.s3_key} className="space-y-2 rounded-xl border border-foreground/15 bg-background/40 p-3">
                    <div className="relative h-40 w-full overflow-hidden rounded-lg">
                      {img.url ? (
                        <Image src={img.url} alt={img.pose || "image"} fill sizes="200px" className="object-cover" />
                      ) : (
                        <div className="h-full w-full bg-foreground/10" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const idx = galleryImages.findIndex((g) => g.s3_key === img.s3_key);
                          if (idx >= 0) setActiveImageIndex(idx);
                          if (idx >= 0) openViewer(idx);
                        }}
                        className="absolute right-2 top-2 rounded-full border border-foreground/20 bg-background/80 p-1"
                        title="Open in viewer"
                      >
                        <Maximize2 className="size-3" />
                      </button>
                      <span className="absolute left-2 top-2 rounded-full border border-foreground/20 bg-background/80 px-2 py-1 text-[11px] uppercase">
                        {img.pose || "image"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setCover(img.s3_key)}
                        disabled={settingCover || listing.cover_s3_key === img.s3_key}
                        className={`rounded-full border px-3 py-1 font-medium ${
                          listing.cover_s3_key === img.s3_key ? "border-foreground bg-foreground/10" : "border-foreground/20"
                        } ${settingCover ? "opacity-60" : ""}`}
                      >
                        {listing.cover_s3_key === img.s3_key ? "Cover" : "Set cover"}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePromptFor(img.s3_key)}
                        className="rounded-full border border-foreground/20 px-3 py-1 font-medium"
                      >
                        {showPrompt[img.s3_key] ? "Hide prompt" : "Show prompt"}
                      </button>
                    </div>
                    {showPrompt[img.s3_key] && (
                      <pre className="max-h-40 overflow-auto rounded-lg border border-foreground/15 bg-background/50 p-3 text-[11px] leading-relaxed">
                        {img.prompt || "No prompt stored."}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <h3 className="text-sm font-semibold">Source garment</h3>
            <div className="mt-3 overflow-hidden rounded-xl border border-foreground/15 bg-background/40">
              {listing.source_url ? (
                <div className="relative aspect-[4/5] w-full">
                  <Image src={listing.source_url} alt="Source garment" fill sizes="(max-width: 1024px) 100vw, 30vw" className="object-contain" />
                </div>
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center text-sm text-foreground/60">
                  Source image unavailable
                </div>
              )}
            </div>
          </div>

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
              {listing.description_text && (
                <button
                  type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(listing.description_text); toast.success("Copied"); } catch {}
                  }}
                  className="text-xs underline"
                >
                  Copy
                </button>
              )}
            </div>
            {listing.description_text ? (
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-foreground/15 bg-background/40 p-4 text-sm leading-relaxed">
                {listing.description_text}
              </pre>
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
            <div className="relative mx-auto aspect-[4/5] w-[min(70vw,420px)]">
              <Image
                src={galleryImages[viewerIndex].url}
                alt={galleryImages[viewerIndex].pose || "Generated image"}
                fill
                sizes="(max-width: 1024px) 80vw, 400px"
                className="object-contain"
              />
              <span className="absolute left-3 top-3 rounded-full border border-white/30 bg-black/60 px-3 py-1 text-xs uppercase text-white">
                {galleryImages[viewerIndex].pose || "image"}
              </span>
            </div>
            {showPrompt[galleryImages[viewerIndex].s3_key] && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/20 bg-black/60 p-4 text-xs text-white">
                {galleryImages[viewerIndex].prompt || "No prompt stored."}
              </pre>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
              <button
                type="button"
                onClick={() => togglePromptFor(galleryImages[viewerIndex].s3_key)}
                className="rounded-full border border-white/30 px-3 py-1"
              >
                {showPrompt[galleryImages[viewerIndex].s3_key] ? "Hide prompt" : "Show prompt"}
              </button>
              <span>
                {viewerIndex + 1} / {galleryImages.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
