# UI Refactor Notes

## Current Surface Inventory
- **Home generator (`app/page.js`)**: single page with drag/drop upload, garment type toggle, various options (gender, environment, poses, prompt override, sequential flow toggle), prompt preview editor, listing metadata inputs, advanced prompt toggle, DB init for admins, sequential pose status display, listing history grid.
- **Listings detail (`app/listing/[id]/page.js`)**: shows generated images with prompt disclosure buttons and listing metadata.
- **Login (`app/login/page.js`)**: minimalist Google sign-in landing for admins.
- **Studio (`app/studio/page.js`)**: three-tab interface (environment/model/pose) holding both end-user workflows (generate defaults, select assets) and admin-only maintenance (bulk uploads, pose management, source deletion).

## User Goals & Pain Points
- Shoppers want a guided flow from garment upload to reviewing generated lookbook images without juggling multiple toggles at once.
- Creators need clarity on how environment and model defaults influence prompts; the prompt preview editor currently feels technical and exposes raw prompt text without context.
- New users do not see an explanation of “listings”, sequential flow, or why some options are disabled; there is little onboarding help.
- Studio mixes end-user customization with admin chores, creating noisy UI for non-admins and hiding the path to use generated assets back in the main flow.
- Pose handling and sequential flow feedback is verbose and repeated per pose, making the surface feel busy.

## Data Dependencies & Shared Concepts
- Generator relies on: uploaded garment file, environment defaults (`/env/defaults`), model defaults (`/model/defaults`), pose descriptions (`/pose/descriptions`), user session for auth headers, listing persistence (`/listings`, `/listing`).
- Studio uses shared APIs for environments (`/env/*`), models (`/model/*`), poses (`/pose/*`) and must respect per-user scoping via `X-User-Id`.
- Admin actions: uploading environment sources, deleting generated assets, managing pose libraries, uploading model source images.

## Proposed Information Architecture Changes
- Main generator becomes a **three-step wizard**: Upload → Customize → Review, each step focused on a single cluster of decisions with inline help.
- Studio splits into user-friendly environment/model management plus a separate `/studio/admin` shell exposing bulk uploads, deletions, pose management, and DB utilities for admins only.
- Shared component library provides consistent cards, headers, tooltips, and action buttons across generator and studio.

## Experience Principles
- Reduce simultaneous cognitive load by sequencing actions.
- Surface context-sensitive education (tooltips, help sidebar, walkthrough) instead of long instructions.
- Keep mobile-first layout with clear breakpoints and sticky navigation/progress for long flows.

