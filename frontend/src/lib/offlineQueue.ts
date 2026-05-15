/**
 * Tiny localStorage-backed offline queue for citizen submissions.
 *
 * Why this exists: the citizen page is the *one* surface that has to
 * survive a 2G connection in a flooded street. If the user taps Submit
 * but the network drops or the backend is unreachable, we don't want
 * to silently lose the report — we stash it and replay when we're back
 * online. Replay is best-effort: dupes are guarded by the
 * server-assigned incident_id (we don't dedupe locally; if the user
 * resubmitted the same thing twice that's their intent).
 *
 * Deliberately tiny — no fancy retry/backoff logic, no IndexedDB.
 * Targeted at hackathon reliability not enterprise persistence.
 */

const KEY = "resqroute.offline_queue.v1";

export type QueuedItem =
  | {
      kind: "report";
      payload: {
        citizen_id: string;
        disaster_type: string;
        description: string;
        coordinates: [number, number];
        severity_hint?: number;
        image_id?: string;
      };
      queued_at: number; // epoch ms
      id: string;
    }
  | {
      kind: "sos";
      payload: {
        citizen_id: string;
        coordinates: [number, number];
        note?: string;
        image_id?: string;
      };
      queued_at: number;
      id: string;
    };

function readAll(): QueuedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: QueuedItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full / disabled. We swallow because the alternative (throwing
    // mid-submit) would mean the user can't even attempt to send.
  }
}

function makeId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueue(item: Omit<QueuedItem, "queued_at" | "id">): QueuedItem {
  const enriched: QueuedItem = {
    ...item,
    queued_at: Date.now(),
    id: makeId(),
  } as QueuedItem;
  const all = readAll();
  all.push(enriched);
  writeAll(all);
  return enriched;
}

export function peek(): QueuedItem[] {
  return readAll();
}

export function size(): number {
  return readAll().length;
}

export function remove(id: string): void {
  const all = readAll().filter((q) => q.id !== id);
  writeAll(all);
}

export function clear(): void {
  writeAll([]);
}

/**
 * Drain the queue in-order, calling `submit` for each. If submit throws
 * we stop and leave the failed item (and everything after it) in place
 * so we don't reorder a user's reports. Returns the count of items
 * successfully sent.
 */
export async function flush(
  submit: (item: QueuedItem) => Promise<void>,
): Promise<number> {
  const items = readAll();
  let sent = 0;
  for (const item of items) {
    try {
      await submit(item);
      remove(item.id);
      sent++;
    } catch {
      // Stop on first failure — preserves order, prevents thrash.
      break;
    }
  }
  return sent;
}
