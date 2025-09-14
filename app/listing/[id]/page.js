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

        {/* Images gallery */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Generated Images</h2>
            {settingCover && <div className="text-xs text-gray-500">Updating cover…</div>}
          </div>
          {(!listing.images || listing.images.length === 0) ? (
            <p className="text-xs text-gray-500 mt-2">No images yet.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {listing.images.map((img) => {
                const isCover = img.s3_key === listing.cover_s3_key;
                return (
                  <div key={img.s3_key} className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15">
                    <a href={img.url || "#"} target="_blank" rel="noreferrer" className="block relative w-full aspect-square">
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
          )}
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
