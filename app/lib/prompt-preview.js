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

  // Pose mapping → short, garment-visible lines
  const p = (pose || "").toLowerCase();
  let poseLine = "";
  if (p === "face") poseLine = "front-facing; squared shoulders; phone centered";
  else if (p === "three-quarter pose" || p === "face trois quart") poseLine = "three-quarter view; torso angled; weight on one leg";
  else if (p === "from the side") poseLine = "profile toward mirror; torso visible; outfit unobstructed";
  else if (p === "random") poseLine = q(randomPoseDescription) ? "see pose description below" : "natural selfie stance";
  else if (q(pose)) poseLine = pose;

  const usingPersonDesc = Boolean(!usingPersonImage && q(personDesc));

  const lines = [];
  // Narrative
  lines.push("Create a photorealistic mirror selfie for a Vinted listing. A black iPhone 16 Pro occludes the face without hiding the outfit.");
  // Inputs by number (Classic semantics)
  const inputs = [];
  inputs.push("Image 1 = garment to be worn");
  inputs.push(usingPersonImage ? "Image 2 = person reference" : "Person = synthesize plausibly");
  inputs.push(envDefaultKey ? "Image 3 = mirror scene (match lighting/angle/palette/DoF)" : `Scene = synthesize clean mirror setting (${q(environment)})`);
  lines.push(inputs.join("; "));
  if (usingPersonDesc) lines.push(`Person description: ${q(personDesc)}`);
  // Output & constraints
  lines.push("Output: one vertical PNG (4:5 preferred), 3/4 or full-body; outfit dominant and sharp.");
  lines.push("Constraints: preserve garment silhouette/color/fabric/print alignment/logos and believable fit; natural proportions and realistic hands; no text/watermarks; PG-13.");
  // Pose
  if (poseLine) lines.push(`Pose: ${poseLine}.`);
  if (p === "random" && q(randomPoseDescription)) lines.push(`Pose description: ${q(randomPoseDescription)}`);
  // Notes
  if (q(extra)) lines.push(`Notes: ${q(extra).replace(/\n/g, " ")}`);
  // Style
  lines.push("Style: soft natural light; ~26–35mm equiv look; mild DoF; correct phone reflection.");
  // Negatives
  lines.push("Avoid: blur, halos, duplicates, extra/merged fingers, warped faces, artifacts, explicit content.");
  if (!forPreview) lines.push("End of instructions.");

  return lines.join("\n");
}
