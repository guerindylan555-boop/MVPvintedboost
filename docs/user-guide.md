# VintedBoost — User Guide

This guide explains the core flow and how Studio ties in.

## Main Flow
- Upload: add a clear front photo of the garment. Set garment type if known; otherwise it’s auto‑detected.
- Customize: choose gender and whether to use the default model image or its stored description; pick an environment (Studio defaults or preset) and up to four poses; optionally add extra instructions.
- Review: check the live prompt preview (what’s sent to the model). Adjust if needed and press Generate.

Every generation creates a Listing bundling your settings and images. Open a listing to view all images and reveal the exact prompts used.

## Studio
- Environments: generate mirror‑selfie backgrounds; select up to five per user as defaults. These appear on the main page when “Studio” is selected as the environment.
- Models: generate people for Man/Woman and set a default per gender. The main page can send either the image or the description.
- Poses: the system uses pose descriptions to vary shots when “random” is selected.

## Admin Console
Admins have a dedicated page at `/studio/admin` to:
- Upload/delete environment sources (used to generate environments).
- Upload model source images per gender.
- Upload pose sources and generate pose‑only descriptions.

## Tips
- Keep your garment framed and well lit for best fidelity.
- Use 1–4 poses; more than four can slow generation without adding variety.
- If results drift, toggle model reference to Description for more variation.

