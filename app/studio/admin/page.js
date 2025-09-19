"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { createAuthClient } from "better-auth/react";
import { getApiBase } from "@/app/lib/api";
import { getSessionBasics } from "@/app/lib/session";

const authClient = createAuthClient();

export default function StudioAdminPage() {
  const { data: session } = authClient.useSession();
  const { isAdmin } = getSessionBasics(session);
  const [active, setActive] = useState("env"); // env | model | pose

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-semibold mb-2">Admin only</h1>
        <p className="text-sm text-[color:var(--color-text-secondary)]">You don’t have access to the Studio admin console.</p>
        <a href="/studio" className="inline-block mt-4 underline">Back to Studio</a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Studio Admin</h1>
        <nav className="flex items-center gap-2 text-sm">
          {[
            { k: "env", label: "Environment" },
            { k: "model", label: "Model Sources" },
            { k: "pose", label: "Poses" },
          ].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setActive(t.k)}
              className={clsx(
                "h-8 px-3 rounded-md border border-[color:var(--color-border)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                active === t.k
                  ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                  : "text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)]"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {active === "env" && <EnvAdmin />}
      {active === "model" && <ModelSourcesAdmin />}
      {active === "pose" && <PoseAdmin />}
    </div>
  );
}

function EnvAdmin() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState([]);

  async function refresh() {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/env/sources`);
      const data = await res.json();
      setSources(data?.items || []);
    } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    try {
      const base = getApiBase();
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch(`${base}/env/sources/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
      setFiles([]);
    } catch (e) {
      alert("Upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function clearAll() {
    if (!confirm("Delete all environment sources?")) return;
    try {
      const base = getApiBase();
      await fetch(`${base}/env/sources`, { method: "DELETE" });
      await refresh();
    } catch {}
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Environment Sources</h2>
      <p className="text-sm text-[color:var(--color-text-secondary)]">Upload source photos used to generate environment defaults.</p>
      <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <div className="flex items-center gap-2">
        <button
          disabled={!files.length || busy}
          onClick={upload}
          className={clsx(
            "h-9 px-3 rounded-md border border-[color:var(--color-border)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]",
            busy
              ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
              : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
          )}
        >
          Upload
        </button>
        <button
          onClick={clearAll}
          className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text-secondary)] transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          Delete all
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {sources.map((k) => (
          <div key={k} className="aspect-[3/4] rounded border border-[color:var(--color-border)] text-[10px] p-1 break-all">{k.split('/').pop()}</div>
        ))}
      </div>
    </section>
  );
}

function ModelSourcesAdmin() {
  const [gender, setGender] = useState("man");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/model/sources?gender=${gender}`);
      const data = await res.json();
      setItems(data?.items || []);
    } catch {}
  }, [gender]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    try {
      const base = getApiBase();
      const form = new FormData();
      form.append("gender", gender);
      for (const f of files) form.append("files", f);
      const res = await fetch(`${base}/model/sources/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
      setFiles([]);
    } catch (e) {
      alert("Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Model Sources</h2>
      <div className="flex items-center gap-2">
        <label className="text-sm text-[color:var(--color-text-secondary)]">Gender</label>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="h-9 rounded border border-[color:var(--color-border)] bg-transparent px-2 text-[color:var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]"
        >
          <option value="man">Man</option>
          <option value="woman">Woman</option>
        </select>
      </div>
      <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <div className="flex items-center gap-2">
        <button
          disabled={!files.length || busy}
          onClick={upload}
          className={clsx(
            "h-9 px-3 rounded-md border border-[color:var(--color-border)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]",
            busy
              ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
              : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
          )}
        >
          Upload
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {items.map((it) => (
          <div key={it.s3_key} className="aspect-[3/4] rounded overflow-hidden border border-[color:var(--color-border)]">
            {it.url ? <img src={it.url} alt="source" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-[color:var(--color-surface)]" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function PoseAdmin() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [descBusy, setDescBusy] = useState(false);

  async function refresh() {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/pose/sources`);
      const data = await res.json();
      setItems(data?.items || []);
    } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    try {
      const base = getApiBase();
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch(`${base}/pose/sources/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
      setFiles([]);
    } catch (e) {
      alert("Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function describeAll() {
    setDescBusy(true);
    try {
      const base = getApiBase();
      await fetch(`${base}/pose/describe`, { method: "POST" });
      alert("Pose descriptions queued/generated.");
    } catch {}
    setDescBusy(false);
  }

  async function clearAll() {
    if (!confirm("Delete all pose sources and descriptions?")) return;
    const base = getApiBase();
    await fetch(`${base}/pose/sources`, { method: "DELETE" });
    await refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Poses</h2>
      <p className="text-sm text-[color:var(--color-text-secondary)]">Upload pose photos and generate pose-only descriptions for use in prompts.</p>
      <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <div className="flex items-center gap-2">
        <button
          disabled={!files.length || busy}
          onClick={upload}
          className={clsx(
            "h-9 px-3 rounded-md border border-[color:var(--color-border)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]",
            busy
              ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
              : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
          )}
        >
          Upload
        </button>
        <button
          disabled={descBusy}
          onClick={describeAll}
          className={clsx(
            "h-9 px-3 rounded-md border border-[color:var(--color-border)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]",
            descBusy
              ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
              : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
          )}
        >
          Generate descriptions
        </button>
        <button
          onClick={clearAll}
          className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text-secondary)] transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          Delete all
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {items.map((k) => (
          <div key={k} className="aspect-[3/4] rounded border border-[color:var(--color-border)] text-[10px] p-1 break-all">{k.split('/').pop()}</div>
        ))}
      </div>
    </section>
  );
}

