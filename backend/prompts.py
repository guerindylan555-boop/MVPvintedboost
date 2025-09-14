from typing import Optional


def _pose_line(pose: str) -> str:
    p = (pose or "").strip().lower()
    if p in ("face", "front", "front-facing", "frontal"):
        return "front-facing mirror view; squared shoulders; phone centered; relaxed posture"
    if p in ("three-quarter", "three-quarter pose", "3/4", "face trois quart", "three quarter"):
        return "three-quarter view toward the mirror; torso angled; weight slightly on one leg"
    if p in ("from the side", "side", "profile"):
        return "profile toward the mirror; ensure torso remains visible; garment unobstructed"
    if p == "random":
        return "natural selfie stance that keeps the outfit fully visible"
    return (pose or "").strip()


def classic_detailed(
    *,
    gender: str,
    environment: str,
    pose: str,
    use_person_image: bool,
    use_env_image: bool,
    person_description: Optional[str] = None,
) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines = []
    lines.append(
        "Create a photorealistic mirror selfie in an amateur smartphone style suitable for a Vinted listing. "
        "The outfit must be clearly visible and look natural. A black iPhone 16 Pro occludes the face in the reflection without hiding the garment."
    )
    lines.append(
        "Use Image 1 as the garment to be worn. "
        + ("Use Image 2 as the person reference and preserve their identity cues (hair/build). " if use_person_image else "Synthesize a plausible person." )
        + (" Use Image 3 as the mirror scene and match its lighting, camera angle, palette, shadows, and depth of field." if use_env_image else " Synthesize a clean mirror setting consistent with the requested environment.")
    )
    if has_desc:
        lines.append("Person description (no image provided): " + (person_description or "").strip())
    lines.append("Required output: one vertical PNG (4:5 preferred), three-quarter or full-body so the garment is dominant and sharp.")
    lines.append(
        "Preserve garment silhouette, color, fabric texture, print scale/alignment, closures, and logos with believable fit and drape. "
        "Natural proportions; realistic hands with five distinct fingers; clean output with no text/watermarks; PG-13."
    )
    lines.append(f"Pose: {pose_line}. Keep the outfit unobstructed.")
    lines.append(
        "Style: smartphone mirror-selfie aesthetic; ~26–35mm equiv look; soft natural light; mild depth of field; correct phone reflection; center the subject in the mirror and avoid cropping garment edges."
    )
    lines.append(
        "Avoid: blurry, over-saturated, HDR halos, duplicated limbs, extra/merged fingers, warped faces, melted textures, AI artifacts, ring-light glare, tripod/DSLR look, explicit content."
    )
    lines.append("End of instructions.")
    return "\n".join(lines)


def classic_concise(
    *,
    gender: str,
    environment: str,
    pose: str,
    use_person_image: bool,
    use_env_image: bool,
    person_description: Optional[str] = None,
) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines = []
    lines.append(
        "Create a photorealistic mirror selfie (amateur smartphone look) for a Vinted listing. A black iPhone 16 Pro occludes the face without hiding the outfit."
    )
    lines.append(
        "Garment: Image 1. "
        + ("Person: Image 2." if use_person_image else "Person: synthesize plausibly.")
        + (" Scene: Image 3 (match lighting/angle/palette/DoF)." if use_env_image else " Scene: synthesize a clean mirror setting.")
    )
    if has_desc:
        lines.append("Person description: " + (person_description or "").strip())
    lines.append("Output: one vertical PNG (4:5 preferred), 3/4 or full-body, outfit dominant and sharp.")
    lines.append(
        "Constraints: preserve garment silhouette/color/fabric/print alignment/logos and believable fit; natural proportions and realistic hands; no text/watermarks; PG-13."
    )
    lines.append(f"Pose: {pose_line}. Garment unobstructed.")
    lines.append("Style: soft natural light; ~26–35mm equiv look; mild DoF; correct phone reflection.")
    lines.append("Avoid: blur, halos, duplicates, extra fingers, warped faces, artifacts, explicit content.")
    return "\n".join(lines)


def seq_step1_detailed(*, use_person_image: bool, pose: str, person_description: Optional[str]) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines = []
    lines.append("Put the garment from Image 2 onto the person in Image 1.")
    lines.append("Do not change the person’s identity, body, hair, or pose.")
    if has_desc:
        lines.append("Person description (no image provided): " + (person_description or "").strip())
    lines.append(
        "Preserve garment color, fabric texture, print scale/alignment, closures, logos, and ensure a believable fit and drape. Background neutral and unchanged."
    )
    lines.append(f"Pose: {pose_line}. Keep the outfit unobstructed.")
    lines.append("Output: one photorealistic PNG; PG-13; no text/watermarks.")
    lines.append("Avoid: artifacts, extra/merged fingers, warped limbs, identity/pose changes, background edits.")
    return "\n".join(lines)


def seq_step1_concise(*, use_person_image: bool, pose: str, person_description: Optional[str]) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines = []
    lines.append("Wear the garment from Image 2 on the person in Image 1 without changing identity or pose.")
    if has_desc:
        lines.append("Person description: " + (person_description or "").strip())
    lines.append("Preserve garment color/fabric/print alignment/logos and believable fit. Background unchanged.")
    lines.append(f"Pose: {pose_line}. Garment unobstructed.")
    lines.append("Output: one photorealistic PNG; PG-13; no text/watermarks.")
    return "\n".join(lines)


def seq_step2_detailed(*, use_env_image: bool, environment: str, pose: str) -> str:
    pose_line = _pose_line(pose)
    lines = []
    lines.append(
        ("Place the person from Image 2 into the mirror scene of Image 1, matching its lighting, camera angle, palette, shadows, and depth of field." if use_env_image
         else "Place the person from Image 2 into a synthesized clean mirror setting consistent with the requested environment.")
    )
    lines.append("Produce a mirror selfie where a black iPhone 16 Pro occludes the face but not the outfit; hands are realistic with correct reflection.")
    lines.append("Do not alter the person or clothing from Image 2 (colors, textures, prints, fit).")
    lines.append(f"Pose: {pose_line}. Keep the outfit unobstructed.")
    lines.append("Output: one photorealistic PNG mirror selfie; PG-13; no text/watermarks.")
    lines.append("Avoid: artifacts, extra phones, inconsistent reflections, added logos, explicit content.")
    return "\n".join(lines)


def seq_step2_concise(*, use_env_image: bool, environment: str, pose: str) -> str:
    pose_line = _pose_line(pose)
    lines = []
    lines.append(
        ("Insert the person from Image 2 into the mirror scene of Image 1 (if present); match lighting/angle/palette/DoF." if use_env_image
         else "Insert the person from Image 2 into a clean mirror setting consistent with the requested environment.")
    )
    lines.append("Mirror selfie with black iPhone 16 Pro occluding the face; outfit fully visible. Do not alter person/clothing.")
    lines.append(f"Pose: {pose_line}. Garment unobstructed.")
    lines.append("Output: one photorealistic PNG; PG-13; no text/watermarks.")
    return "\n".join(lines)

