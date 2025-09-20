"use client";

// Lightweight, browser-side image preprocessing tuned for mobile uploads.
// - Converts HEIC/HEIF to JPEG (dynamic import) for cross-browser previews
// - Compresses large images to ~1600px max side using browser-image-compression
// - Returns a File you can append to FormData and a preview URL derived
//   from the processed blob to ensure correct orientation in previews.

import imageCompression from "browser-image-compression";

function isHeicLike(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes("heic") || t.includes("heif");
}

function toFile(blob, filename, type) {
  try {
    return new File([blob], filename, { type });
  } catch {
    // Safari 14 fallback: no File constructor — return Blob with name
    blob.name = filename;
    return blob;
  }
}

// Returns { file: File|Blob, previewUrl: string }
export async function preprocessImage(inputFile) {
  if (!inputFile || !(inputFile instanceof Blob)) {
    return { file: inputFile, previewUrl: null };
  }

  let working = inputFile;
  let baseName = (inputFile.name || "photo").replace(/\.[^.]+$/, "");

  try {
    // Convert HEIC/HEIF to JPEG for wider browser compatibility
    if (isHeicLike(inputFile.type)) {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: inputFile, toType: "image/jpeg", quality: 0.92 });
      const convBlob = Array.isArray(converted) ? converted[0] : converted;
      working = toFile(convBlob, `${baseName}.jpg`, "image/jpeg");
    }

    // Compress and normalize orientation
    const opts = {
      maxWidthOrHeight: 1600, // Keep uploads snappy on mobile
      maxSizeMB: 1.6,         // Soft size cap — quality adapts
      useWebWorker: true,
      fileType: "image/jpeg", // Broadest compatibility across marketplaces/mobile
      initialQuality: 0.75,
    };
    const compressedBlob = await imageCompression(working, opts);
    const out = toFile(compressedBlob, `${baseName}-compressed.jpg`, "image/jpeg");
    const previewUrl = URL.createObjectURL(out);
    return { file: out, previewUrl };
  } catch (err) {
    // If anything fails, fall back to original file for reliability
    const previewUrl = URL.createObjectURL(working);
    return { file: working, previewUrl };
  }
}
