# VintedBoost Prompting Spec (Gemini 2.5 Flash Image — “Nano Banana”)

Purpose: a concise, production-ready spec to standardize all image-generation prompts across Classic and Sequential flows, align multi‑image references, poses, and photographic cues, and avoid contradictory instructions.

## Goals
- Photorealistic mirror selfie for e‑commerce listings (Vinted style).
- Garment fidelity first: silhouette, color, fabric texture, print scale/alignment, closures, logos.
- Smartphone authenticity: black iPhone 16 Pro occludes face in the mirror; hands realistic; correct reflection.
- Effective multi‑image composition using numbered references; avoid conflicting text when images are provided.

## Image References & Parts Order
Always attach inputs in the order listed and refer to them by number in the prompt text.

- Classic `/edit` (one‑shot):
  - Image 1 — Garment (uploaded source image)
  - Image 2 — Person (optional)
  - Image 3 — Environment (optional)

- Sequential — Step 1 (fit garment on person):
  - Image 1 — Person (or text description if no image)
  - Image 2 — Garment (uploaded)

- Sequential — Step 2 (place person into scene):
  - Image 1 — Environment (optional)
  - Image 2 — Person‑with‑garment (result of Step 1)

Rules:
- If a person image is present, do not describe identity in text; say to use Image 2.
- If an environment image is present, do not describe the scene in text; say to use Image 3 (Classic) or Image 1 (Step 2).
- The prompt text must reference images by number only (no filenames); keep image roles unambiguous.

## Pose Taxonomy (Mirror‑Selfie Canon)
Use these user‑facing poses; inject short pose guidance for garment visibility:
- Face (front‑facing): squared shoulders, phone centered; relaxed posture; full outfit visible.
- Three‑quarter: torso angled, weight slightly on one leg; keep garment lines visible.
- Side (profile): turn toward mirror; ensure torso remains visible; do not hide outfit.
- Random: inject a stored “Pose description: …” string from Studio.

## Prompt Anatomy (Sections)
1) Brief Narrative (2–4 sentences): coherent description of what to generate; mention mirror‑selfie style.
2) Inputs by number: explicitly state how to use each attached image.
3) Required Output: one photorealistic PNG, framing, subject prominence.
4) Preservation/Constraints: garment fidelity, body realism, clean output, PG‑13.
5) Pose: 1–2 lines ensuring garment visibility, plus optional pose description line.
6) Camera/Lighting/Style: vertical/4:5, 26–35mm equiv look, soft natural light, mild DoF, smartphone reflection correctness.
7) Negative Guidance: concise artifact avoidance list.
8) End marker (optional): “End of instructions.”

Notes:
- Be narrative, not keyword lists. Use full sentences.
- Suppress any description that would contradict provided images.

## Templates — Classic (Garment + optional Person + optional Environment)

### Classic — Detailed
Create a photorealistic mirror selfie in an amateur smartphone style suitable for a Vinted listing. The outfit must be clearly visible and look natural. The person holds a black iPhone 16 Pro in front of the face in the reflection without obscuring the garment.

Use Image 1 as the garment to be worn. If Image 2 is provided, use it as the person reference and preserve their identity cues (hair/build); otherwise synthesize a plausible person. If Image 3 is provided, use it as the mirror scene and match its lighting, camera angle, palette, shadows, and depth of field; otherwise synthesize a clean mirror setting consistent with the requested environment.

Required output: one vertical PNG (prefer 4:5) with three‑quarter or full‑body framing so the garment is dominant and sharp.

Preserve and enforce:
- Garment fidelity: exact silhouette, color, fabric texture, print scale/alignment, closures, and logos; believable fit and drape.
- Body realism: natural proportions; hands with five distinct fingers; no merges/extra digits; no warped limbs.
- Clean output: no text, no watermarks, no added logos. PG‑13 only.

Pose: {pose line}. Keep the outfit unobstructed. {optional: Pose description: …}

Camera/lighting/style: smartphone mirror‑selfie aesthetic; ~26–35mm equiv look; soft natural light; mild depth of field; correct phone reflection; center the subject in the mirror and avoid cropping garment edges.

Negative guidance: blurry, over‑saturated, HDR halos, duplicated limbs, extra/merged fingers, warped faces, melted textures, AI artifacts, ring‑light glare, tripod/DSLR look, explicit content.

End of instructions.

### Classic — Concise
Create a photorealistic mirror selfie (amateur smartphone look) for a Vinted listing. The person wears the garment from Image 1. If provided, use Image 2 as the person and Image 3 as the mirror scene (match its lighting/angle/palette/DoF). Black iPhone 16 Pro occludes the face without hiding the outfit.

Output: one vertical PNG (4:5 preferred), three‑quarter or full‑body, outfit dominant and sharp.

Constraints: preserve garment silhouette/color/fabric/print alignment/logos and believable fit; natural proportions and realistic hands; no text/watermarks; PG‑13.

Pose: {pose line}. Keep the garment unobstructed. {optional: Pose description: …}

Style: soft natural light, ~26–35mm equiv look, mild DoF, correct phone reflection.

Avoid: blur, halos, duplicates, extra fingers, warped faces, artifacts, explicit content.

## Templates — Sequential

### Step 1 (Fit Garment on Person) — Detailed
Put the garment from Image 2 onto the person in Image 1. Do not change the person’s identity, body, hair, or pose. Preserve garment color, fabric texture, print scale/alignment, closures, logos, and ensure a believable fit and drape. Keep the background neutral and unchanged.

Pose: {pose line}. Keep the outfit unobstructed. {optional: Pose description: …}

Output: one photorealistic PNG of the person now wearing the garment; no text/watermarks; PG‑13.

Avoid: artifacts, extra/merged fingers, warped limbs, identity/pose changes, background edits.

### Step 1 — Concise
Wear the garment from Image 2 on the person in Image 1 without changing identity or pose. Preserve garment color/fabric/print alignment/logos and believable fit. Background unchanged.

Pose: {pose line}. Garment unobstructed.

Output: one photorealistic PNG; PG‑13; no text/watermarks.

### Step 2 (Place Person into Scene) — Detailed
Place the person from Image 2 into the mirror scene of Image 1 (if provided), matching its lighting, camera angle, palette, shadows, and depth of field. Produce a mirror selfie where a black iPhone 16 Pro occludes the face but not the outfit; hands are realistic with correct reflection.

Do not alter the person or clothing from Image 2 (colors, textures, prints, fit). If no environment image is provided, synthesize a clean mirror setting consistent with the requested environment.

Pose: {pose line}. Keep the outfit unobstructed. {optional: Pose description: …}

Output: one photorealistic PNG mirror selfie; PG‑13; no text/watermarks.

Avoid: artifacts, extra phones, inconsistent reflections, added logos, explicit content.

### Step 2 — Concise
Insert the person from Image 2 into the mirror scene of Image 1 (if present); match lighting/angle/palette/DoF. Mirror selfie with black iPhone 16 Pro occluding the face; outfit fully visible. Do not alter person/clothing.

Pose: {pose line}. Garment unobstructed.

Output: one photorealistic PNG; PG‑13; no text/watermarks.

## Contradiction & Redundancy Rules
- When Image 2 (person) exists: do not describe identity traits in text; instruct to use Image 2.
- When Image 3 (Classic) or Image 1 (Step 2) exists: do not describe environment in text; instruct to use the scene image and match lighting/angle.
- Only use “Pose description: …” for the Random pose injection from Studio; otherwise keep pose to 1–2 lines.

## Camera & Lighting Cues (Default)
- Vertical portrait, 4:5 preferred; subject centered in mirror; avoid cropping garment edges.
- ~26–35mm equiv look; soft natural light; mild depth of field; subtle grain acceptable.
- Correct mirror geometry and phone reflection; one phone only.

## Negative Guidance (Short List)
blurry, over‑saturated, HDR halos, duplicated limbs, extra/merged fingers, warped faces, melted textures, AI artifacts, text, watermarks, added logos, ring‑light glare, tripod/DSLR look, explicit content.

## Length & Fallback
- Default to Detailed variants (cost is not a constraint). If the API returns internal errors related to input size, retry once with the Concise variant for the same flow step.

## Implementation Notes (for Phase 2)
- Align backend `types.Part` order with the “Image N” scheme above and reference them by number in prompt text.
- Map UI poses (face/three‑quarter/side/random) to their short pose lines here to keep frontend preview and backend identical.
- When images are present, omit conflicting textual descriptions (person identity or environment details) and only instruct how to use the image.

