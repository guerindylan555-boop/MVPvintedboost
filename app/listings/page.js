"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createAuthClient } from "better-auth/react";
import { Plus } from "lucide-react";
import { getApiBase, withUserId } from "@/app/lib/api";
import { getSessionBasics } from "@/app/lib/session";
import { subscribeToListingsUpdates } from "@/app/lib/listings-events";

const authClient = createAuthClient();

export default function ListingsPage() {
  const { data: session } = authClient.useSession();
  const { userId, isAdmin } = getSessionBasics(session);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchInFlightRef = useRef(false);
  const fingerprintRef = useRef(null);

  const fetchListings = useCallback(async (isBackground = false) => {
    if (!userId) return;
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    if (!isBackground) setLoading(true);
    if (!isBackground) setError(null);
    const baseUrl = getApiBase();
    try {
      const res = await fetch(`${baseUrl}/listings`, { headers: withUserId({}, userId), cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const fingerprint = items
        .map((item) => `${item?.id ?? ""}:${item?.updated_at ?? item?.created_at ?? ""}`)
        .join("|");
      if (fingerprintRef.current !== fingerprint) {
        fingerprintRef.current = fingerprint;
        setListings(items);
      }
      if (!isBackground) setError(null);
    } catch (err) {
      if (isBackground) {
        if (process.env.NODE_ENV !== "production") console.error(err);
      } else {
        setError(err?.message || "Failed to load listings");
      }
    } finally {
      fetchInFlightRef.current = false;
      if (!isBackground) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchListings();
  }, [userId, fetchListings]);

  useEffect(() => {
    if (!userId) {
      fingerprintRef.current = null;
      setListings([]);
      return undefined;
    }

    const unsubscribe = subscribeToListingsUpdates(() => {
      fetchListings(true);
    });

    const handleFocus = () => fetchListings(true);
    const handleVisibility = () => {
      if (!document.hidden) fetchListings(true);
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId, fetchListings]);

  const sortedListings = useMemo(() => {
    if (!Array.isArray(listings)) return [];
    return [...listings].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [listings]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your listings</h1>
          <p className="text-sm text-[color:var(--color-text-secondary)]">
            Browse every generated listing, tweak covers, and jump back into edits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[color:var(--color-accent)] px-3 text-xs font-semibold text-[color:var(--color-accent-contrast)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
          >
            <Plus className="size-3" />
            New listing
          </Link>
        </div>
      </div>

      {!userId ? (
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-6 text-sm text-[color:var(--color-text-secondary)]">
          Sign in to view your listings.
        </div>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-36 animate-pulse rounded-2xl bg-[color:var(--color-surface)]" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10">
          {error}
        </div>
      ) : sortedListings.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-6 text-sm text-[color:var(--color-text-secondary)]">
          No listings yet. Generate your first one to see it here.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sortedListings.map((listing) => {
            const createdAt = listing.created_at ? new Date(listing.created_at) : null;
            const settings = listing.settings || {};
            return (
              <Link
                key={listing.id}
                href={`/listing/${listing.id}`}
                className="group flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4 text-sm transition hover:border-[color:var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
                    {listing.cover_url ? (
                      <Image src={listing.cover_url} alt={listing.title || "Listing cover"} fill sizes="80px" className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-[color:var(--color-text-tertiary)]">
                        No cover
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--color-foreground)]">{listing.title || "Untitled listing"}</p>
                    {createdAt && (
                      <p className="text-xs text-[color:var(--color-text-secondary)]">{createdAt.toLocaleString()}</p>
                    )}
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-[color:var(--color-text-tertiary)]">
                      {settings.gender || ""} {settings.environment || ""}
                    </p>
                    {typeof listing.images_count === "number" && (
                      <p className="text-[11px] text-[color:var(--color-text-secondary)]">
                        {listing.images_count} image{listing.images_count === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <p className="text-center text-[11px] text-[color:var(--color-text-tertiary)]">
          Admin? Use the init tools on the Create page to seed defaults.
        </p>
      )}
    </div>
  );
}
