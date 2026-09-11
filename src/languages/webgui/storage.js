'use strict';

/**
 * Emits src/storage/{db,connections,history}.ts — the IndexedDB layer backing saved connections
 * (plaintext, local-only browser storage) and per-topic message history (drives the old/new diff
 * highlighting and the History list; persists across reloads).
 *
 * @param {{ projectName: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildStorageFiles(ctx) {
  const dbTs = `import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_NAME = "${ctx.projectName}-webgui";
// Bump this whenever the schema changes (new store, new index) — IndexedDB only re-runs
// upgrade() when opening at a version HIGHER than what's already in the browser, so a schema
// addition that ships without a version bump silently never applies to anyone who already opened
// an earlier version of this app (their DB stays on the old schema forever, and any code that
// touches the missing store/index starts throwing — often invisibly, since a rejected promise
// from a fire-and-forget write is easy to swallow by accident).
export const DB_VERSION = 2;

export interface SavedConnection {
  id: string;
  name: string;
  protocol: "ws" | "wss";
  host: string;
  port: number;
  path?: string;
  tls: boolean;
  validateCertificate: boolean;
  username?: string;
  password?: string;
  clientId?: string;
  /** Free-text note — populated for connections seeded from the spec's servers section (see
   * ensureSeedConnections()), e.g. flagging that the port may need adjusting for a WS bridge. */
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id?: number;
  topic: string;
  timestampMs: number;
  qos: number;
  retain: boolean;
  payload: Uint8Array;
  decoded?: unknown;
  decodeError?: string;
}

interface AppSchema extends DBSchema {
  connections: {
    key: string;
    value: SavedConnection;
  };
  messageHistory: {
    key: number;
    value: HistoryEntry;
    indexes: { byTopic: string; byTopicAndTime: [string, number] };
  };
  /** Small out-of-line key/value store for app bookkeeping — currently just the "have we already
   * seeded connections from the spec's servers section" one-time flag (see
   * connections.ts's ensureSeedConnections()). */
  meta: {
    key: string;
    value: boolean;
  };
}

let dbPromise: Promise<IDBPDatabase<AppSchema>> | null = null;

/** Opens (and memoizes) the shared IndexedDB connection. Saved connections are stored in plain
 * text — this is local-only browser storage, never transmitted anywhere. */
export function getDb(): Promise<IDBPDatabase<AppSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppSchema>(DB_NAME, DB_VERSION, {
      // Guarded with objectStoreNames.contains(...) rather than assuming a fresh DB: this runs
      // for EVERY version jump from whatever a given browser already has up to DB_VERSION, not
      // just once on first-ever creation — a browser upgrading from an older schema must only
      // have its MISSING pieces added, never re-create (and silently truncate) a store it
      // already has data in.
      upgrade(db) {
        if (!db.objectStoreNames.contains("connections")) {
          db.createObjectStore("connections", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("messageHistory")) {
          const history = db.createObjectStore("messageHistory", {
            keyPath: "id",
            autoIncrement: true,
          });
          history.createIndex("byTopic", "topic");
          history.createIndex("byTopicAndTime", ["topic", "timestampMs"]);
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}
`;

  const connectionsTs = `import { getDb, type SavedConnection } from "./db";
import { serverSeeds } from "../channels";

const SEED_FLAG_KEY = "serverSeedsApplied";

export async function listConnections(): Promise<SavedConnection[]> {
  const db = await getDb();
  const all = await db.getAll("connections");
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(id: string): Promise<SavedConnection | undefined> {
  const db = await getDb();
  return db.get("connections", id);
}

export type ConnectionInput = Omit<SavedConnection, "id" | "createdAt" | "updatedAt"> & { id?: string };

export async function saveConnection(conn: ConnectionInput): Promise<SavedConnection> {
  const db = await getDb();
  const now = Date.now();
  const existing = conn.id ? await db.get("connections", conn.id) : undefined;
  const record: SavedConnection = {
    ...conn,
    id: conn.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put("connections", record);
  return record;
}

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("connections", id);
}

/**
 * Prepopulates the connections store from the spec's \`servers\` section (src/channels.ts's
 * \`serverSeeds\`), but only on genuinely first use — if the store already has ANY connection
 * (including ones the user has since deleted down to zero, or edited beyond recognition), this is
 * a no-op. Idempotent seeding based on "is the store non-empty" would re-add seeds a user
 * deliberately deleted, so it's gated on a one-time flag instead. Call before listing connections
 * wherever they're first shown (e.g. opening the Connections dialog).
 */
export async function ensureSeedConnections(): Promise<void> {
  if (serverSeeds.length === 0) return;
  const db = await getDb();
  if (await db.get("meta", SEED_FLAG_KEY)) return;
  await db.put("meta", true, SEED_FLAG_KEY);

  for (const seed of serverSeeds) {
    await saveConnection({
      name: seed.id,
      protocol: seed.protocol,
      host: seed.host,
      port: seed.port ?? (seed.tls ? 8883 : 1883),
      tls: seed.tls,
      validateCertificate: true,
      description: seed.description,
    });
  }
}
`;

  const historyTs = `import { getDb, type HistoryEntry } from "./db";

const DEFAULT_MAX_ENTRIES_PER_TOPIC = 200;
// pruneOldest only re-scans and trims a topic's rows once it has drifted this far past the cap,
// rather than on every single insert — see the writeQueues comment below for why "every insert"
// is the expensive part.
const PRUNE_BATCH_SIZE = 20;

// TopicStore's onMessage handler (see state.ts) fires appendHistoryEntry() per message WITHOUT
// awaiting it, so a topic that updates rapidly (a heartbeat every few hundred ms, say) can have
// many calls in flight at once. Each one used to open its own IndexedDB transaction and, via
// pruneOldest, re-scan the topic's entire history — more transactions arriving than the browser
// can service, which starves every other reader/writer on the "messageHistory" store, including
// History's own getHistoryForTopic(). That's the exact bug this queue exists to prevent: History
// staying empty forever on a fast-moving topic while the live value keeps updating fine (the
// latter is plain React state, untouched by any of this).
//
// Chaining every write for a given topic through one promise makes them run strictly one at a
// time — at most one IndexedDB transaction per topic in flight — which is enough backpressure to
// keep the queue itself cheap even under a topic that never stops publishing.
const writeQueues = new Map<string, Promise<void>>();

function enqueue(topic: string, task: () => Promise<void>): Promise<void> {
  // Swallow the previous task's rejection here (not in the returned promise) so one failed write
  // can't wedge every later write for the topic behind a permanently-rejected chain link.
  const previous = (writeQueues.get(topic) ?? Promise.resolve()).catch(() => undefined);
  const next = previous.then(task);
  writeQueues.set(topic, next);
  return next;
}

export async function appendHistoryEntry(entry: HistoryEntry): Promise<void> {
  return enqueue(entry.topic, async () => {
    const db = await getDb();
    await db.add("messageHistory", entry);
    await pruneOldest(entry.topic, DEFAULT_MAX_ENTRIES_PER_TOPIC);
  });
}

export async function getHistoryForTopic(topic: string, limit = 100): Promise<HistoryEntry[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("messageHistory", "byTopic", topic);
  return all.sort((a, b) => b.timestampMs - a.timestampMs).slice(0, limit);
}

export async function getLatestForTopic(topic: string): Promise<HistoryEntry | undefined> {
  const [latest] = await getHistoryForTopic(topic, 1);
  return latest;
}

export async function clearHistoryForTopic(topic: string): Promise<void> {
  return enqueue(topic, async () => {
    const db = await getDb();
    const all = await db.getAllFromIndex("messageHistory", "byTopic", topic);
    const tx = db.transaction("messageHistory", "readwrite");
    for (const entry of all) {
      if (entry.id !== undefined) await tx.store.delete(entry.id);
    }
    await tx.done;
  });
}

/**
 * Caps unbounded growth: keeps only around \`maxEntries\` most recent rows for a topic. Only
 * actually re-scans and trims once the topic has drifted \`PRUNE_BATCH_SIZE\` rows past the cap —
 * once a hot topic reaches the cap, checking (and potentially rewriting) its ENTIRE history on
 * every single subsequent insert is the main cost this module was paying under sustained load;
 * batching the check trades a slightly looser cap (up to maxEntries + PRUNE_BATCH_SIZE rows
 * transiently) for doing that scan 1/PRUNE_BATCH_SIZE as often.
 */
export async function pruneOldest(topic: string, maxEntries: number): Promise<void> {
  const db = await getDb();
  const total = await db.countFromIndex("messageHistory", "byTopic", topic);
  if (total <= maxEntries + PRUNE_BATCH_SIZE) return;
  const all = await db.getAllFromIndex("messageHistory", "byTopic", topic);
  const toDelete = all.sort((a, b) => a.timestampMs - b.timestampMs).slice(0, all.length - maxEntries);
  const tx = db.transaction("messageHistory", "readwrite");
  for (const entry of toDelete) {
    if (entry.id !== undefined) await tx.store.delete(entry.id);
  }
  await tx.done;
}
`;

  return [
    { path: 'src/storage/db.ts', content: dbTs },
    { path: 'src/storage/connections.ts', content: connectionsTs },
    { path: 'src/storage/history.ts', content: historyTs },
  ];
}

module.exports = { buildStorageFiles };
