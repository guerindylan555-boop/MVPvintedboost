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


def _garment_condition_line(garment_type: str) -> str:
    t = (garment_type or "").strip().lower()
    if t == "top":
        return (
            "Complement with a neutral, non-branded bottom only to stabilize composition; keep the top dominant and unaltered."
        )
    if t == "bottom":
        return (
            "Add a plain, non-branded top that does not cover key design details; keep the bottom dominant and unaltered."
        )
    # full piece
    return "Do not add garments; keep the provided piece intact."


def classic_detailed(
    *,
    gender: str,
    environment: str,
    pose: str,
    use_person_image: bool,
    use_env_image: bool,
    person_description: Optional[str] = None,
    garment_type: str = "full",
) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines: list[str] = []
    lines.append("Create a photorealistic mirror selfie (amateur smartphone look) for a Vinted listing.")
    # Image roles (no conditional phrasing; select exact line per case)
    lines.append("Garment: use Image 1.")
    if use_person_image:
        lines.append(
            "Person: use Image 2 and keep identity (face, hair color/length, build, pose) unchanged."
        )
    elif has_desc:
        lines.append("Person: synthesize a plausible wearer matching: " + (person_description or "").strip())
    else:
        lines.append("Person: synthesize a plausible " + (gender or "person"))
    if use_env_image:
        lines.append(
            "Scene: use Image 3 as the mirror scene; match lighting, camera angle, palette, and depth of field."
        )
    else:
        lines.append("Scene: synthesize a clean " + (environment or "studio") + " mirror setting.")
    # Fidelity and conditioning (compact)
    lines.append(
        "Fidelity: preserve exact silhouette, proportions, color, fabric texture, print scale/alignment, closures, trim, and logos; do not redesign, recolor, simplify, or add/remove features."
    )
    lines.append(_garment_condition_line(garment_type))
    # Pose and style
    lines.append(f"Pose: {pose_line}. Outfit unobstructed.")
    lines.append("Mirror‑selfie smartphone look; correct reflection; PG‑13; no text/watermarks.")
    return "\n".join(lines)


def classic_concise(
    *,
    gender: str,
    environment: str,
    pose: str,
    use_person_image: bool,
    use_env_image: bool,
    person_description: Optional[str] = None,
    garment_type: str = "full",
) -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines: list[str] = []
    lines.append("Photorealistic mirror selfie (amateur smartphone look).")
    if use_person_image:
        person_line = "Person: use Image 2; keep identity unchanged."
    elif has_desc:
        person_line = "Person: synthesize matching: " + (person_description or "").strip()
    else:
        person_line = "Person: synthesize a plausible " + (gender or "person")
    scene_line = (
        "Scene: use Image 3; match lighting/angle/palette/DoF." if use_env_image else "Scene: synthesize a clean " + (environment or "studio") + " mirror setting."
    )
    lines.append("Garment: Image 1. " + person_line + " " + scene_line)
    lines.append(
        "Fidelity: exact silhouette/proportions, color, fabric texture, print alignment/scale, closures, trim, logos; no redesign/recolor/simplify/add/remove."
    )
    lines.append(_garment_condition_line(garment_type))
    lines.append(f"Pose: {pose_line}. Outfit unobstructed. Mirror selfie; correct reflection; PG‑13; no text/watermarks.")
    return "\n".join(lines)


def seq_step1_detailed(*, use_person_image: bool, pose: str, person_description: Optional[str], gender: str = "") -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines: list[str] = []
    lines.append("Put the garment from Image 2 onto the person in Image 1; do not change identity, body, hair, or pose.")
    if has_desc:
        lines.append("Person: synthesize matching: " + (person_description or "").strip())
    elif not use_person_image:
        lines.append("Person: synthesize a plausible " + (gender or "person"))
    lines.append(
        "Fidelity: preserve exact color, fabric texture, print scale/alignment, closures, logos, silhouette, and believable fit/drape. Background neutral and unchanged."
    )
    lines.append(f"Pose: {pose_line}. Outfit unobstructed. PG‑13; no text/watermarks.")
    return "\n".join(lines)


def seq_step1_concise(*, use_person_image: bool, pose: str, person_description: Optional[str], gender: str = "") -> str:
    pose_line = _pose_line(pose)
    has_desc = bool((person_description or "").strip() and not use_person_image)
    lines: list[str] = []
    lines.append("Wear the garment from Image 2 on the person in Image 1; identity and pose unchanged.")
    if has_desc:
        lines.append("Person: synthesize matching: " + (person_description or "").strip())
    elif not use_person_image:
        lines.append("Person: synthesize a plausible " + (gender or "person"))
    lines.append("Fidelity: exact color/fabric/print alignment/logos, silhouette, believable fit; background unchanged.")
    lines.append(f"Pose: {pose_line}. Outfit unobstructed. PG‑13; no text/watermarks.")
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
