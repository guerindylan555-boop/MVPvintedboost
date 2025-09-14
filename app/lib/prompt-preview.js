// Shared preview builder for the Mirror Selfie prompt used in the UI.
// Keeps frontend previews consistent across pages.

export function buildMirrorSelfiePreview({
  gender = "",
  environment = "",
  pose = "",
  extra = "",
  usingPersonImage = false,
  personDesc = "",
  envDefaultKey = undefined,
  randomPoseDescription = undefined,
  forPreview = true,
} = {}) {
  const q = (s) => (s || "").trim();

  // Pose mapping
  let poseLine = "";
  const poseLines = [];
  const p = (pose || "").toLowerCase();
  if (p === "face") {
    poseLine = "front-facing mirror view";
    poseLines.push("Orientation: front-facing; squared shoulders; straight posture; phone centered.");
    poseLines.push("Pose description: frontal mirror selfie; shoulders squared; phone centered; relaxed posture.");
  } else if (p === "three-quarter pose" || p === "face trois quart") {
    poseLine = "three-quarter view toward the mirror";
    poseLines.push("Orientation: three-quarter face; body slightly angled; shoulders subtly rotated.");
    poseLines.push("Pose description: three-quarter view; torso angled; weight slightly on one leg.");
  } else if (p === "from the side") {
    poseLine = "side profile toward the mirror";
    poseLines.push("Orientation: side/profile view; ensure torso and garment remain visible.");
    poseLines.push("Pose description: profile view; head and torso turned sideways; garment unobstructed.");
  } else if (p === "random") {
    if (!forPreview) {
      if (q(randomPoseDescription)) {
        poseLine = "see pose description below";
        poseLines.push(`Pose description: ${q(randomPoseDescription)}`);
      } else {
        poseLine = "natural selfie stance";
      }
    } else {
      if (q(randomPoseDescription)) {
        poseLine = "see pose description below";
        poseLines.push(`Pose description: ${q(randomPoseDescription)}`);
      } else {
        poseLine = "random from saved pose descriptions";
      }
    }
  } else if (q(pose)) {
    poseLine = pose;
  }

  const usingPersonDesc = Boolean(!usingPersonImage && q(personDesc));

  const lines = [];
  lines.push("High-level goals");
  lines.push("- Photorealistic mirror selfie suitable for a Vinted listing.");
  lines.push("- The person holds a black iPhone 16 Pro; amateur smartphone look.");
  lines.push("- Garment is the hero: exact shape, color, fabric, prints, logos.");
  lines.push("");
  lines.push("TASK");
  const taskParts = [];
  taskParts.push(
    "You render a photorealistic mirror selfie of a person wearing the provided garment. The person holds a black iPhone 16 Pro."
  );
  if (usingPersonImage) {
    taskParts.push(
      "Use the attached person reference image; keep hair and overall build consistent (the face may be occluded by the phone)."
    );
  } else if (usingPersonDesc) {
    taskParts.push(
      "No person image; use the provided person description to guide identity (the face may be occluded by the phone)."
    );
  } else {
    taskParts.push("No person reference; synthesize a plausible model matching the selected person.");
  }
  if (envDefaultKey) {
    taskParts.push(
      "Use the attached environment reference as a mirror scene; match its lighting, camera angle, color palette, and depth of field."
    );
  } else {
    taskParts.push(
      "No environment reference; synthesize a clean mirror setting consistent with the requested environment."
    );
  }
  taskParts.push("Keep an amateur smartphone look.");
  lines.push(taskParts.join(" "));
  lines.push("");
  lines.push("REQUIRED OUTPUT");
  lines.push("- One 2D PNG photo, vertical smartphone framing (prefer 4:5).");
  lines.push("- Realistic lighting and skin; garment clearly visible and dominant.");
  lines.push("- The person must be wearing the uploaded garment; do not omit or replace it.");
  lines.push("");
  lines.push("HARD CONSTRAINTS (must follow)");
  lines.push(
    "1) Garment fidelity: preserve exact silhouette, color, fabric texture, print scale/alignment, closures, and logos from the garment image."
  );
  lines.push(
    "2) Body realism: natural proportions; correct anatomy; no extra fingers; no warped limbs."
  );
  lines.push(
    "3) Face realism: plausible expression; no duplicates/melting; preserve identity cues (hair/build) if a person ref is provided."
  );
  lines.push("4) Clothing fit: believable size and drape; respect gravity and fabric stiffness.");
  lines.push(
    "5) Clean output: no watermarks, no AI artifacts, no text overlays, no added logos."
  );
  lines.push("6) Safety: PG-13; no explicit content.");
  lines.push(
    "7) Mirror selfie: a black iPhone 16 Pro is held in front of the face in the mirror; ensure the phone occludes the face area consistently (with correct reflection), without obscuring key garment details."
  );
  lines.push(
    "8) Garment usage: the person must be wearing the uploaded garment; do not omit or replace it."
  );
  lines.push("");
  lines.push("CONDITIONED CONTROLS");
  lines.push(`- Person: ${usingPersonImage ? "" : q(gender)}`);
  lines.push(`- Scene: ${envDefaultKey ? "" : q(environment)}`);
  lines.push(`- Pose: ${poseLine || ""}`);
  lines.push(`- Notes: "${q(extra).replace(/\n/g, " ")}"`);
  lines.push("");
  lines.push("STYLE & CAMERA DIRECTION");
  lines.push("- Smartphone mirror-selfie aesthetic; natural colors; mild grain acceptable.");
  lines.push("- 3/4 or full-body by default so the garment is fully visible.");
  lines.push(
    "- Camera look: ~26–35mm equivalent; mild lens distortion; f/2.8–f/5.6; soft bokeh if indoors."
  );
  lines.push(
    "- Lighting: match environment reference if given; otherwise soft directional key + gentle fill; subtle rim for separation."
  );
  lines.push(
    "- Composition: center subject in mirror; show phone and hand; avoid cropping garment edges; keep hands visible naturally."
  );
  lines.push("");
  lines.push("ENVIRONMENT BEHAVIOR");
  if (envDefaultKey) {
    lines.push(
      "- Use the attached environment reference as a mirror scene; imitate its framing, palette, light direction, shadows, and DoF; keep any mirror frame consistent."
    );
  } else {
    lines.push(
      "- No environment reference: synthesize a clean mirror setting (bedroom/closet/bath) that complements the garment; uncluttered background."
    );
  }
  lines.push("");
  lines.push("PERSON BEHAVIOR");
  if (usingPersonImage) {
    lines.push(
      "- Person reference: use the attached image; keep hair, skin tone, and general build consistent (face may be partly occluded by phone)."
    );
  } else {
    lines.push(
      "- No person reference: synthesize a plausible model matching the selected person; friendly neutral expression."
    );
    if (usingPersonDesc) {
      lines.push("- Use a person that matches this description.");
      lines.push(`- Person description: ${q(personDesc)}`);
    }
  }
  lines.push(
    "- Hand pose: holding a black iPhone 16 Pro naturally; fingers look correct; phone and its reflection visible."
  );
  lines.push("");
  lines.push("POSE RENDERING");
  lines.push(
    `- Enforce the requested pose: ${poseLine || ""}. Make it balanced and anatomically plausible.`
  );
  lines.push(
    "- Ensure the garment remains fully visible and not occluded by the phone or pose."
  );
  for (const ln of poseLines) lines.push(`- ${ln}`);
  lines.push("");
  lines.push("QUALITY CHECK BEFORE OUTPUT");
  lines.push("- Fingers: five per hand; shapes correct.");
  lines.push("- Garment: crisp edges; seams/hemlines visible; prints/logos accurate.");
  lines.push(
    "- Face: no duplicates; no melting; if visible, eyes symmetrical; otherwise occluded by phone."
  );
  lines.push(
    "- Mirror: phone and reflection consistent; no extra phones; no camera artifacts."
  );
  lines.push("- Background: clean and coherent; matches env ref if provided.");
  lines.push("");
  lines.push("NEGATIVE GUIDANCE (avoid)");
  lines.push(
    "blurry, over-saturated, HDR halos, duplicated limbs, extra fingers, warped faces, melted textures, text overlays, watermarks, added/brand-new logos, heavy beauty retouching, studio glamour look, ring-light glare, tripod/DSLR look, explicit content."
  );
  lines.push("");
  lines.push("END OF INSTRUCTIONS");

  return lines.join("\n");
}

