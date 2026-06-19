import type { Id } from "@/types";

/**
 * A cache for trip thumbnails, keyed by trip id + a content `signature`. The
 * interface is storage-agnostic so a future backend (server blob store) can
 * implement it without touching the dashboard — today it's client-side only.
 */
export interface ThumbnailStore {
  /** Cached data URL for this exact signature, or null on a miss/mismatch. */
  get(tripId: Id, signature: string): Promise<string | null>;
  set(tripId: Id, signature: string, dataUrl: string): Promise<void>;
}

interface Entry {
  signature: string;
  dataUrl: string;
}

const DB_NAME = "travel-recap-thumbs";
const STORE = "thumbs";

/**
 * IndexedDB-backed thumbnail cache (data URLs can exceed localStorage quota).
 * Degrades to an in-memory Map if IndexedDB is unavailable (e.g. private mode),
 * so it never blocks the dashboard.
 */
export class LocalThumbnailStore implements ThumbnailStore {
  private memory = new Map<Id, Entry>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async get(tripId: Id, signature: string): Promise<string | null> {
    const db = await this.openDb();
    if (!db) {
      const e = this.memory.get(tripId);
      return e && e.signature === signature ? e.dataUrl : null;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(tripId);
      req.onsuccess = () => {
        const e = req.result as Entry | undefined;
        resolve(e && e.signature === signature ? e.dataUrl : null);
      };
      req.onerror = () => resolve(null);
    });
  }

  async set(tripId: Id, signature: string, dataUrl: string): Promise<void> {
    const entry: Entry = { signature, dataUrl };
    const db = await this.openDb();
    if (!db) {
      this.memory.set(tripId, entry);
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, tripId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}

/** Shared singleton used by the dashboard. */
export const thumbnailStore: ThumbnailStore = new LocalThumbnailStore();
