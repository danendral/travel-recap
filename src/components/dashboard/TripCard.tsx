"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { useTripThumbnail } from "@/lib/thumbnails/useTripThumbnail";
import { relativeTime } from "@/lib/relativeTime";
import type { TripSummary } from "@/store/selectors";

/**
 * One trip in the dashboard grid: thumbnail, inline-editable name, stop count,
 * last-edited, route summary, and hover actions (open / duplicate / delete).
 * Delete is surfaced to the parent (which owns the confirm dialog).
 */
export default function TripCard({
  summary,
  onRequestDelete,
}: {
  summary: TripSummary;
  onRequestDelete: (id: string) => void;
}) {
  const router = useRouter();
  const renameTrip = useStore((s) => s.renameTrip);
  const duplicateTrip = useStore((s) => s.duplicateTrip);
  const thumb = useTripThumbnail(summary.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);

  const open = () => router.push(`/trip/${summary.id}`);
  const commit = () => {
    const name = draft.trim();
    if (name && name !== summary.name) renameTrip(summary.id, name);
    setEditing(false);
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-700 hover:bg-slate-900">
      {/* Thumbnail (click to open) */}
      <button
        onClick={open}
        className="relative block aspect-video w-full overflow-hidden bg-gradient-to-b from-slate-800 to-slate-950"
        aria-label={`Open ${summary.name}`}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-600">
            🗺️
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded bg-slate-800 px-2 py-0.5 text-sm text-slate-100 outline-none ring-1 ring-sky-500"
          />
        ) : (
          <button
            onDoubleClick={() => {
              setDraft(summary.name);
              setEditing(true);
            }}
            onClick={open}
            className="truncate text-left text-sm font-semibold text-slate-100"
            title={`${summary.name} — double-click to rename`}
          >
            {summary.name}
          </button>
        )}

        <p className="truncate text-xs text-slate-400">
          {summary.routeSummary || "No stops yet"}
        </p>
        <p className="mt-auto pt-1 text-[11px] text-slate-500">
          {summary.stopCount} {summary.stopCount === 1 ? "stop" : "stops"} ·
          edited {relativeTime(summary.updatedAt)}
        </p>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={() => router.push(`/trip/${duplicateTrip(summary.id)}`)}
          title="Duplicate"
          className="rounded-md bg-slate-900/80 px-2 py-1 text-xs text-slate-200 backdrop-blur transition hover:bg-slate-800"
        >
          Duplicate
        </button>
        <button
          onClick={() => onRequestDelete(summary.id)}
          title="Delete"
          className="rounded-md bg-slate-900/80 px-2 py-1 text-xs text-red-300 backdrop-blur transition hover:bg-red-600 hover:text-white"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
