"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { createAuthClient } from "better-auth/react";
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

  useEffect(() => {
    (async () => {
      if (!id || !userId) return;
      setLoading(true);
      setError(null);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      try {
        const res = await fetch(`${baseUrl}/listing/${id}`, { headers: { "X-User-Id": String(userId) } });
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

  // Load pose descriptions so we can append one when regenerating a random pose
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const res = await fetch(`${baseUrl}/pose/descriptions`, { cache: "no-store" });
        const data = await res.json();
        if (data?.items && Array.isArray(data.items)) setPoseDescs(data.items);
      } catch {}
    })();
  }, []);

  function buildEffectivePrompt(s, pose, poseDescText) {
    // Mirror Selfie prompt aligned with main page; simplified and driven by listing settings
    const envDefaultKey = s?.env_default_s3_key ? s.env_default_s3_key : undefined;
    const usingPersonImage = !!(s?.use_model_image === true && s?.model_default_s3_key);
    const usingPersonDesc = false; // listing settings don't store the description text; fallback to synthesize
    const selectedPose = pose || (Array.isArray(s?.poses) && s.poses.length > 0 ? s.poses[0] : "");

    let poseLine = "";
    const poseLines = [];
    if (selectedPose === "Face" || selectedPose === "face") {
      poseLine = "front-facing mirror view";
      poseLines.push("Orientation: front-facing; squared shoulders; straight posture; phone centered.");
      poseLines.push("Pose description: frontal mirror selfie; shoulders squared; phone centered; relaxed posture.");
    } else if (selectedPose === "three-quarter pose" || selectedPose === "face trois quart") {
      poseLine = "three-quarter view toward the mirror";
      poseLines.push("Orientation: three-quarter face; body slightly angled; shoulders subtly rotated.");
      poseLines.push("Pose description: three-quarter view; torso angled; weight slightly on one leg.");
    } else if (selectedPose === "from the side") {
      poseLine = "side profile toward the mirror";
      poseLines.push("Orientation: side/profile view; ensure torso and garment remain visible.");
      poseLines.push("Pose description: profile view; head and torso turned sideways; garment unobstructed.");
    } else if (selectedPose === "random") {
      if (poseDescText) {
        poseLine = "see pose description below";
        poseLines.push(`Pose description: ${poseDescText}`);
      } else {
        poseLine = "natural selfie stance";
      }
    } else if (selectedPose) {
      poseLine = selectedPose;
    }

    const lines = [];
    lines.push("High-level goals");
    lines.push("- Photorealistic mirror selfie suitable for a Vinted listing.");
    lines.push("- The person holds a black iPhone 16 Pro; amateur smartphone look.");
    lines.push("- Garment is the hero: exact shape, color, fabric, prints, logos.");
    lines.push("");
    lines.push("TASK");
    lines.push(
      "You render a photorealistic mirror selfie of a person wearing the provided garment. The person holds a black iPhone 16 Pro. If a person reference is provided, keep hair and overall build consistent (the face may be occluded by the phone). If an environment reference is provided, treat it as a mirror scene and match its lighting, camera angle, color palette, and depth of field. Keep an amateur phone-shot look."
    );
    lines.push("");
    lines.push("REQUIRED OUTPUT");
    lines.push("- One 2D PNG photo, vertical smartphone framing (prefer 4:5).");
    lines.push("- Realistic lighting and skin; garment clearly visible and dominant.");
    lines.push("- The person must be wearing the uploaded garment; do not omit or replace it.");
    lines.push("");
    lines.push("HARD CONSTRAINTS (must follow)");
    lines.push("1) Garment fidelity: preserve exact silhouette, color, fabric texture, print scale/alignment, closures, and logos from the garment image.");
    lines.push("2) Body realism: natural proportions; correct anatomy; no extra fingers; no warped limbs.");
    lines.push("3) Face realism: plausible expression; no duplicates/melting; preserve identity cues (hair/build) if a person ref is provided.");
    lines.push("4) Clothing fit: believable size and drape; respect gravity and fabric stiffness.");
    lines.push("5) Clean output: no watermarks, no AI artifacts, no text overlays, no added logos.");
    lines.push("6) Safety: PG-13; no explicit content.");
    lines.push("7) Mirror selfie: a black iPhone 16 Pro is held in front of the face in the mirror; ensure the phone occludes the face area consistently (with correct reflection), without obscuring key garment details.");
    lines.push("8) Garment usage: the person must be wearing the uploaded garment; do not omit or replace it.");
    lines.push("");
    lines.push("CONDITIONED CONTROLS");
    lines.push(`- Gender: ${usingPersonImage ? "" : (s?.gender || "")}`);
    lines.push(`- Environment: ${envDefaultKey ? "" : (s?.environment || "")}`);
    lines.push(`- Pose: ${poseLine || ""}`);
    lines.push(`- Extra user instructions: "${(s?.extra || "").trim().replace(/\n/g, " ")}"`);
    lines.push("");
    lines.push("STYLE & CAMERA DIRECTION");
    lines.push("- Smartphone mirror-selfie aesthetic; natural colors; mild grain acceptable.");
    lines.push("- 3/4 or full-body by default so the garment is fully visible.");
    lines.push("- Camera look: ~26–35mm equivalent; mild lens distortion; f/2.8–f/5.6; soft bokeh if indoors.");
    lines.push("- Lighting: match environment reference if given; otherwise soft directional key + gentle fill; subtle rim for separation.");
    lines.push("- Composition: center subject in mirror; show phone and hand; avoid cropping garment edges; keep hands visible naturally.");
    lines.push("");
    lines.push("ENVIRONMENT BEHAVIOR");
    lines.push("- If an environment reference is provided: treat it as a mirror scene; imitate its framing, palette, light direction, shadows, and DoF; keep any mirror frame consistent.");
    if (!envDefaultKey) {
      lines.push("- If not provided: synthesize a clean mirror setting (bedroom/closet/bath) that complements the garment; uncluttered background.");
    }
    lines.push("");
    lines.push("PERSON BEHAVIOR");
    lines.push("- If a person reference is provided: keep hair, skin tone, and general build consistent (face may be partly occluded by phone).");
    lines.push("- If not provided: synthesize a plausible model matching the gender; friendly neutral expression.");
    if (usingPersonDesc) {
      // None currently available on listing; included for parity with main page
      lines.push("- Use a person that matches this description.");
      lines.push(`- Person description: ${""}`);
    }
    lines.push("- Hand pose: holding a black iPhone 16 Pro naturally; fingers look correct; phone and its reflection visible.");
    lines.push("");
    lines.push("POSE RENDERING");
    lines.push(`- Enforce the requested pose: ${poseLine || ""}. Make it balanced and anatomically plausible.`);
    lines.push("- Ensure the garment remains fully visible and not occluded by the phone or pose.");
    for (const ln of poseLines) lines.push(`- ${ln}`);
    lines.push("");
    lines.push("QUALITY CHECK BEFORE OUTPUT");
    lines.push("- Fingers: five per hand; shapes correct.");
    lines.push("- Garment: crisp edges; seams/hemlines visible; prints/logos accurate.");
    lines.push("- Face: no duplicates; no melting; if visible, eyes symmetrical; otherwise occluded by phone.");
    lines.push("- Mirror: phone and reflection consistent; no extra phones; no camera artifacts.");
    lines.push("- Background: clean and coherent; matches env ref if provided.");
    lines.push("");
    lines.push("NEGATIVE GUIDANCE (avoid)");
    lines.push("blurry, over-saturated, HDR halos, duplicated limbs, extra fingers, warped faces, melted textures, text overlays, watermarks, added/brand-new logos, heavy beauty retouching, studio glamour look, ring-light glare, tripod/DSLR look, explicit content.");
    lines.push("");
    lines.push("END OF INSTRUCTIONS");

    return lines.join("\n");
  }

  async function setCover(s3Key) {
    if (!id || !userId || !s3Key) return;
    setSettingCover(true);
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
    try {
      const form = new FormData();
      form.append("s3_key", s3Key);
      const res = await fetch(`${baseUrl}/listing/${id}/cover`, { method: "PATCH", body: form, headers: { "X-User-Id": String(userId) } });
      if (res.ok) {
        // Refresh listing
        const r = await fetch(`${baseUrl}/listing/${id}`, { headers: { "X-User-Id": String(userId) } });
        if (r.ok) setListing(await r.json());
      }
    } catch {}
    setSettingCover(false);
  }

  async function generateDescription() {
    if (!id || !userId) return;
    setGenDescLoading(true);
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
    try {
      const form = new FormData();
      const res = await fetch(`${baseUrl}/listing/${id}/describe`, { method: "POST", body: form, headers: { "X-User-Id": String(userId) } });
      if (!res.ok) throw new Error(await res.text());
      const r = await fetch(`${baseUrl}/listing/${id}`, { headers: { "X-User-Id": String(userId) } });
      if (r.ok) setListing(await r.json());
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert("Failed to generate description");
    }
    setGenDescLoading(false);
  }

  async function regeneratePose(pose) {
    if (!id || !userId || !listing?.source_url || !pose) return;
    setRegenLoading((s) => ({ ...s, [pose]: true }));
    setRegenError((e) => ({ ...e, [pose]: undefined }));
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
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
        // Backward compatibility: default to using image when present
        form.append("model_default_s3_key", s.model_default_s3_key);
      }
      // Build a fresh prompt so we can inject a random pose description when needed
      let effectivePrompt = s.prompt_override || "";
      if (!effectivePrompt) {
        let poseDescText = undefined;
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
      const res = await fetch(`${baseUrl}/edit/json`, { method: "POST", body: form, headers: { "X-User-Id": String(userId) } });
      if (!res.ok) throw new Error(await res.text());
      // Refresh listing to pull the new image in
      const r = await fetch(`${baseUrl}/listing/${id}`, { headers: { "X-User-Id": String(userId) }, cache: "no-store" });
      if (r.ok) setListing(await r.json());
    } catch (e) {
      setRegenError((er) => ({ ...er, [pose]: e?.message || "Failed to regenerate" }));
    } finally {
      setRegenLoading((s) => ({ ...s, [pose]: false }));
    }
  }

  if (!id) return <div className="p-5">Invalid listing id</div>;
  if (loading) return <div className="p-5 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-5 text-sm text-red-600">{error}</div>;
  if (!listing?.ok) return <div className="p-5 text-sm text-gray-500">Not found.</div>;

  const s = listing.settings || {};

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 p-5 max-w-md w-full mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm underline underline-offset-4">← Back</Link>
          <div className="text-xs text-gray-500">{new Date(listing.created_at).toLocaleString()}</div>
        </div>

        {/* Source image and settings */}
        <section>
          <h1 className="text-base font-semibold">Listing</h1>
          <div className="mt-2 rounded-2xl overflow-hidden border border-black/10 dark:border-white/15">
            {listing.source_url ? (
              <div className="relative w-full aspect-[4/5]">
                <Image src={listing.source_url} alt="Source" fill sizes="(max-width: 768px) 100vw, 600px" className="object-contain" />
              </div>
            ) : (
              <div className="p-10 text-center text-sm text-gray-500">Source image unavailable</div>
            )}
          </div>
          <div className="mt-3 text-sm grid grid-cols-2 gap-2">
            <div><span className="text-gray-500">Gender:</span> {s.gender || "–"}</div>
            <div><span className="text-gray-500">Environment:</span> {s.environment || "–"}</div>
            <div className="col-span-2"><span className="text-gray-500">Poses:</span> {Array.isArray(s.poses) && s.poses.length ? s.poses.join(", ") : "–"}</div>
            <div className="col-span-2"><span className="text-gray-500">Extra:</span> {s.extra || "–"}</div>
          </div>
        </section>

        {/* Images gallery with planned poses (up to 4) */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Generated Images</h2>
            {settingCover && <div className="text-xs text-gray-500">Updating cover…</div>}
          </div>
          {(() => {
            const s = listing.settings || {};
            const planned = Array.isArray(s.poses) ? s.poses.slice(0, 4) : [];
            const images = Array.isArray(listing.images) ? listing.images : [];
            const taken = new Set();
            const byPose = new Map();
            // Prefer the most recent per pose
            for (const p of planned) {
              const found = images.find((img) => img.pose === p && !taken.has(img.s3_key));
              if (found) {
                byPose.set(p, found);
                taken.add(found.s3_key);
              }
            }
            // Build tiles in planned order, with placeholders where missing
            if (planned.length === 0 && images.length === 0) {
              return <p className="text-xs text-gray-500 mt-2">No images yet.</p>;
            }
            return (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {planned.map((p) => {
                  const img = byPose.get(p);
                  if (img) {
                    const isCover = img.s3_key === listing.cover_s3_key;
                    return (
                      <div key={img.s3_key} className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15">
                        <a href={img.url || "#"} target="_blank" rel="noreferrer" className="block relative w-full aspect-square" title={p}>
                          {img.url ? (
                            <Image src={img.url} alt={img.pose} fill sizes="(max-width: 768px) 50vw, 300px" className="object-cover" />
                          ) : (
                            <div className="w-full h-full bg-black/10 dark:bg-white/10" />
                          )}
                        </a>
                        {isCover && (
                          <div className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">Cover</div>
                        )}
                        <div className="absolute top-1 left-1 flex items-center gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">{p}</span>
                          <button
                            type="button"
                            className={`px-2 py-1 text-[11px] rounded ${isCover ? "bg-foreground text-background" : "bg-background/80 border border-black/10 dark:border-white/15"}`}
                            onClick={() => setCover(img.s3_key)}
                            disabled={settingCover || isCover}
                            title={isCover ? "Current cover" : "Set as cover"}
                          >
                            {isCover ? "Cover" : "Set cover"}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  // Placeholder for missing/failed pose
                  const busy = !!regenLoading[p];
                  const err = regenError[p];
                  return (
                    <div key={`missing-${p}`} className="relative rounded-md overflow-hidden border border-dashed border-black/20 dark:border-white/20 aspect-square flex items-center justify-center">
                      <div className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">{p}</div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-xs text-gray-500">{err ? "Previous attempt failed" : "Not generated"}</div>
                        <button
                          type="button"
                          className={`h-8 px-2 rounded-md border text-xs ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
                          onClick={() => regeneratePose(p)}
                          disabled={busy}
                        >
                          {busy ? "Regenerating…" : "Regenerate"}
                        </button>
                        {err && <div className="text-[10px] text-red-600 max-w-[140px] text-center truncate" title={err}>{err}</div>}
                      </div>
                    </div>
                  );
                })}
                {/* Also render any extra images that don't match a planned pose */}
                {images.filter((img) => !planned.includes(img.pose)).map((img) => {
                  const isCover = img.s3_key === listing.cover_s3_key;
                  return (
                    <div key={img.s3_key} className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15">
                      <a href={img.url || "#"} target="_blank" rel="noreferrer" className="block relative w-full aspect-square" title={img.pose}>
                        {img.url ? (
                          <Image src={img.url} alt={img.pose} fill sizes="(max-width: 768px) 50vw, 300px" className="object-cover" />
                        ) : (
                          <div className="w-full h-full bg-black/10 dark:bg-white/10" />
                        )}
                      </a>
                      {isCover && (
                        <div className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">Cover</div>
                      )}
                      <div className="absolute top-1 left-1 flex items-center gap-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">{img.pose || "image"}</span>
                        <button
                          type="button"
                          className={`px-2 py-1 text-[11px] rounded ${isCover ? "bg-foreground text-background" : "bg-background/80 border border-black/10 dark:border-white/15"}`}
                          onClick={() => setCover(img.s3_key)}
                          disabled={settingCover || isCover}
                          title={isCover ? "Current cover" : "Set as cover"}
                        >
                          {isCover ? "Cover" : "Set cover"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>

        {/* Description */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Description</h2>
            <div className="flex items-center gap-2">
              {listing.description_text && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={async () => { try { await navigator.clipboard.writeText(listing.description_text); } catch {} }}
                >
                  Copy
                </button>
              )}
              {!listing.description_text && (
                <button type="button" className="text-xs underline" onClick={generateDescription} disabled={genDescLoading}>
                  {genDescLoading ? "Generating…" : "Generate description"}
                </button>
              )}
            </div>
          </div>
          {listing.description_text ? (
            <pre className="mt-2 whitespace-pre-wrap text-sm border border-black/10 dark:border-white/15 rounded-md p-3 bg-black/5 dark:bg-white/5">{listing.description_text}</pre>
          ) : (
            <p className="text-xs text-gray-500 mt-2">No description generated.</p>
          )}
        </section>
      </main>
    </div>
  );
}
