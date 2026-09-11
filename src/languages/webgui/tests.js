'use strict';

/**
 * Emits the generated project's own Vitest + Testing Library suite (tests/**), run only by that
 * project's own `npm test` (not by this repo's `npm test` — see test/webgui-generate.test.js for
 * the unit tests of this backend's *generator* output). Static — independent of the spec, except
 * codec.test.ts/TopicTree.test.tsx/PublishPanel.test.tsx which read the generated src/channels.ts
 * (itself spec-derived) rather than hardcoding fixture-specific values.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTestFiles() {
  const setupTs = `import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
// Initializes i18next with the real EN/UK resources before any component under test renders —
// without this, useTranslation()'s t() falls back to returning the raw key (e.g. "publishModeRaw"
// instead of "Raw protobuf"), which every component test's text-based queries depend on.
import "../src/i18n";
`;

  const codecTestTs = `import { describe, it, expect } from "vitest";
import root from "../src/codec/root";
import { encodeMessage, decodeMessage } from "../src/codec/codec";
import { allChannels } from "../src/channels";

describe("codec", () => {
  it("round-trips every channel's message type through encode/decode", () => {
    for (const channel of allChannels) {
      const type = root.lookupType(channel.protoPackage + "." + channel.protoMessageType);
      const bytes = encodeMessage(type, {});
      const result = decodeMessage(type, bytes);
      expect(result.ok).toBe(true);
    }
  });

  it("reports a decode error for malformed bytes instead of throwing", () => {
    const channel = allChannels[0];
    const type = root.lookupType(channel.protoPackage + "." + channel.protoMessageType);
    // A single continuation-bit-set varint byte with nothing after it is invalid for any message
    // shape (the wire-format reader runs out of buffer before the schema is even consulted).
    const result = decodeMessage(type, new Uint8Array([0xff]));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
`;

  const fieldSchemaTestTs = `import { describe, it, expect } from "vitest";
import { Root } from "protobufjs/light";
import type * as protobuf from "protobufjs/light";
import { buildFieldSchema } from "../src/codec/fieldSchema";

// Built ad-hoc rather than depending on the AsyncAPI fixture having these shapes — fieldSchema.ts
// is generic over any protobufjs Type, so this exercises it directly against a map, a nested
// message, a repeated message, an enum, and a self-referential field the fixture doesn't cover.
const root = new Root().addJSON({
  test: {
    nested: {
      Address: {
        fields: { city: { type: "string", id: 1 } },
      },
      Status: {
        values: { UNKNOWN: 0, OK: 1, ERROR: 2 },
      },
      Sample: {
        fields: {
          name: { type: "string", id: 1 },
          status: { type: "Status", id: 2 },
          address: { type: "Address", id: 3 },
          tags: { rule: "repeated", type: "string", id: 4 },
          addresses: { rule: "repeated", type: "Address", id: 5 },
          labels: { keyType: "string", type: "int32", id: 6 },
          self: { type: "Sample", id: 7 },
        },
      },
    },
  },
} as unknown as Record<string, protobuf.AnyNestedObject>);

describe("buildFieldSchema", () => {
  it("describes scalar, enum, nested message, repeated and map fields", () => {
    const type = root.lookupType("test.Sample");
    const schema = buildFieldSchema(type);
    const byName = Object.fromEntries(schema.map((f) => [f.name, f]));

    expect(byName.name.kind).toBe("scalar");
    expect(byName.status.kind).toBe("enum");
    expect(byName.status.enumValues).toEqual({ UNKNOWN: 0, OK: 1, ERROR: 2 });
    expect(byName.address.kind).toBe("message");
    expect(byName.address.nestedFields?.[0]?.name).toBe("city");
    expect(byName.tags.repeated).toBe(true);
    expect(byName.addresses.repeated).toBe(true);
    expect(byName.labels.map).toBe(true);
    expect(byName.labels.keyType).toBe("string");
  });

  it("stops recursing into a self-referential message type instead of overflowing the stack", () => {
    const type = root.lookupType("test.Sample");
    const schema = buildFieldSchema(type);
    const self = schema.find((f) => f.name === "self");
    expect(self?.kind).toBe("message");
    expect(self?.nestedFields).toBeUndefined();
  });
});
`;

  const storageTestTs = `import { describe, it, expect, vi } from "vitest";
import { saveConnection, listConnections, deleteConnection } from "../src/storage/connections";
import { appendHistoryEntry, getHistoryForTopic } from "../src/storage/history";

describe("storage", () => {
  // Must run before any other test in this file touches the DB — it opens the database directly
  // at version 1 (bypassing getDb()) to simulate a browser that already created it under an OLDER
  // schema, before later checking that opening it through this module's getDb() (at the current
  // DB_VERSION) adds whatever stores that older schema was missing, without wiping existing data.
  // A DB_VERSION bump that forgets a real schema addition is exactly the bug class this guards
  // against: it silently breaks for anyone who already opened an earlier version of the app,
  // while working fine for a brand new IndexedDB — the two are easy to conflate in manual testing.
  it("adds missing stores to a pre-existing older-schema database instead of requiring a fresh IndexedDB", async () => {
    const { DB_NAME } = await import("../src/storage/db");

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("connections", { keyPath: "id" });
        const history = db.createObjectStore("messageHistory", { keyPath: "id", autoIncrement: true });
        history.createIndex("byTopic", "topic");
        history.createIndex("byTopicAndTime", ["topic", "timestampMs"]);
        // Deliberately no "meta" store here — this is last version's schema, missing whatever
        // was added since. If a future change adds another store, extend this fixture too.
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // Fresh module instance so getDb()'s memoized connection promise can't have already been
    // resolved (and thus its upgrade() skipped) by an earlier test in this file.
    vi.resetModules();
    const { ensureSeedConnections } = await import("../src/storage/connections");

    await ensureSeedConnections(); // throws if the store it needs was never created
  });

  it("round-trips a saved connection", async () => {
    const saved = await saveConnection({
      name: "Local",
      protocol: "ws",
      host: "localhost",
      port: 9001,
      tls: false,
      validateCertificate: true,
    });

    expect((await listConnections()).find((c) => c.id === saved.id)?.name).toBe("Local");

    await deleteConnection(saved.id);
    expect((await listConnections()).find((c) => c.id === saved.id)).toBeUndefined();
  });

  it("round-trips a history entry", async () => {
    await appendHistoryEntry({
      topic: "test/topic",
      timestampMs: Date.now(),
      qos: 0,
      retain: false,
      payload: new Uint8Array([1, 2, 3]),
    });

    const entries = await getHistoryForTopic("test/topic");
    expect(entries.length).toBeGreaterThan(0);
  });

  // Regression test for a real bug: TopicStore's onMessage handler fires appendHistoryEntry()
  // per message without awaiting it, so a fast-moving topic (a heartbeat every few hundred ms)
  // can have many calls racing at once. Each used to open its own IndexedDB transaction and
  // re-scan the topic's whole history to decide whether to prune — more concurrent transactions
  // than the browser could service, which starved every other reader/writer on the store
  // (including History's own read) for as long as the topic kept publishing: live values kept
  // updating (plain React state), but History never loaded. appendHistoryEntry() now serializes
  // writes per topic instead of firing them concurrently; this only re-checks correctness (no
  // entry lost to a race), not the starvation itself, which needs a real IndexedDB to reproduce.
  it("keeps every entry from a burst of concurrent unawaited appends to the same topic", async () => {
    const topic = "test/concurrent-burst";
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        appendHistoryEntry({
          topic,
          timestampMs: i,
          qos: 0,
          retain: false,
          payload: new Uint8Array([i]),
        })
      )
    );

    const entries = await getHistoryForTopic(topic, 100);
    expect(entries.length).toBe(25);
  });

  it("caps a topic's history once it drifts past the prune batch margin", async () => {
    const topic = "test/prune-batch";
    for (let i = 0; i < 221; i++) {
      await appendHistoryEntry({ topic, timestampMs: i, qos: 0, retain: false, payload: new Uint8Array([1]) });
    }

    const entries = await getHistoryForTopic(topic, 500);
    // Bounded (pruned at least once) but not trimmed down to the bare cap on every insert.
    expect(entries.length).toBeLessThan(221);
    expect(entries.length).toBeGreaterThanOrEqual(200);
  });
});
`;

  const mqttTransportTestTs = `import { describe, it, expect } from "vitest";
import { FakeMqttTransport } from "../src/mqtt/FakeMqttTransport";

describe("FakeMqttTransport", () => {
  it("records published messages and subscriptions", () => {
    const transport = new FakeMqttTransport();
    transport.connect();
    transport.subscribe("a/b");
    transport.publish("a/b", new Uint8Array([1, 2, 3]), true, 1);

    expect(transport.connected).toBe(true);
    expect(transport.subscribedTopics).toEqual(["a/b"]);
    expect(transport.published).toEqual([{ topic: "a/b", payload: new Uint8Array([1, 2, 3]), retain: true, qos: 1 }]);
  });

  it("dispatches delivered messages to the registered handler", () => {
    const transport = new FakeMqttTransport();
    const received: Array<[string, Uint8Array, boolean]> = [];
    transport.setMessageHandler((topic, payload, retain) => {
      received.push([topic, payload, retain]);
    });
    transport.deliver("a/b", new Uint8Array([9]), false);

    expect(received).toEqual([["a/b", new Uint8Array([9]), false]]);
  });
});
`;

  const topicsTestTs = `import { describe, it, expect } from "vitest";
import { hasParameters, subscribeFilterFor, matchesAddress, findChannelForTopic } from "../src/topics";
import type { ChannelMeta } from "../src/channels";

function channel(address: string): ChannelMeta {
  return { id: "c", address, tags: [], retain: false, protoPackage: "p", protoMessageType: "T" };
}

describe("topics", () => {
  it("detects a channel address as parameterized only when it has a {param} segment", () => {
    expect(hasParameters(channel("fleet/rover/status"))).toBe(false);
    expect(hasParameters(channel("fleet/{deviceId}/status"))).toBe(true);
  });

  it("turns every {param} segment into an MQTT '+' wildcard for subscribing", () => {
    expect(subscribeFilterFor(channel("fleet/rover/status"))).toBe("fleet/rover/status");
    expect(subscribeFilterFor(channel("fleet/{deviceId}/status"))).toBe("fleet/+/status");
    expect(subscribeFilterFor(channel("a/{x}/b/{y}"))).toBe("a/+/b/+");
  });

  it("matches a concrete received topic against a parameterized address, one segment per {param}", () => {
    const c = channel("fleet/{deviceId}/status");
    expect(matchesAddress(c, "fleet/rover-7/status")).toBe(true);
    expect(matchesAddress(c, "fleet/status")).toBe(false); // wrong segment count
    expect(matchesAddress(c, "other/rover-7/status")).toBe(false); // literal segment mismatch
    expect(matchesAddress(c, "fleet//status")).toBe(false); // {param} must match a NON-EMPTY segment
  });

  it("still matches a non-parameterized address only by exact equality", () => {
    const c = channel("fleet/rover/status");
    expect(matchesAddress(c, "fleet/rover/status")).toBe(true);
    expect(matchesAddress(c, "fleet/rover-7/status")).toBe(false);
  });

  it("finds the right channel among several for a concrete topic, parameterized or not", () => {
    const channels = [channel("a/b"), channel("fleet/{deviceId}/status"), channel("x/{y}/{z}")];
    expect(findChannelForTopic(channels, "fleet/rover-7/status")).toBe(channels[1]);
    expect(findChannelForTopic(channels, "x/1/2")).toBe(channels[2]);
    expect(findChannelForTopic(channels, "no/match")).toBeUndefined();
  });
});
`;

  const topicTreeTestTsx = `import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopicTree } from "../src/components/tree/TopicTree";
import { ConnectionProvider } from "../src/state/ConnectionContext";
import { TopicStoreProvider } from "../src/state/TopicStore";
import { flatChannels, channelGroups } from "../src/channels";

function renderTree(
  onSelectChannel: (channel: (typeof flatChannels)[number], topic: string) => void = () => {}
) {
  return render(
    <ConnectionProvider>
      <TopicStoreProvider>
        <TopicTree search="" selectedChannelId={null} selectedTopic={null} onSelectChannel={onSelectChannel} />
      </TopicStoreProvider>
    </ConnectionProvider>
  );
}

describe("TopicTree", () => {
  it("renders every group and flat channel from the spec", () => {
    renderTree();
    for (const group of channelGroups) {
      expect(screen.getByText(group.name)).toBeInTheDocument();
    }
    for (const channel of flatChannels) {
      expect(screen.getByText(channel.id)).toBeInTheDocument();
    }
  });

  it("calls onSelectChannel with the channel and its address when a leaf topic is clicked", async () => {
    const onSelect = vi.fn();
    const channel = flatChannels[0];
    renderTree(onSelect);
    if (!channel) return;
    await userEvent.click(screen.getByText(channel.id));
    expect(onSelect).toHaveBeenCalledWith(channel, channel.address);
  });
});
`;

  const publishPanelTestTsx = `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublishPanel } from "../src/components/publish/PublishPanel";
import { ConnectionProvider } from "../src/state/ConnectionContext";
import { flatChannels } from "../src/channels";

describe("PublishPanel", () => {
  it("switches to the raw-bytes editor and accepts hex input", async () => {
    const channel = flatChannels[0];
    if (!channel) return;

    render(
      <ConnectionProvider>
        <PublishPanel channel={channel} topic={channel.address} />
      </ConnectionProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: /raw protobuf/i }));
    const textarea = screen.getByPlaceholderText(/deadbeef/i);
    await userEvent.type(textarea, "0a0568656c6c6f");

    expect(textarea).toHaveValue("0a0568656c6c6f");
  });
});
`;

  const historyListTestTsx = `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryList } from "../src/components/topic/HistoryList";
import { appendHistoryEntry } from "../src/storage/history";
import { flatChannels } from "../src/channels";
import { ConnectionProvider } from "../src/state/ConnectionContext";
import { TopicStoreProvider } from "../src/state/TopicStore";

describe("HistoryList", () => {
  it("expands to reveal persisted entries when its row is clicked", async () => {
    const channel = flatChannels[0];
    if (!channel) return;
    await appendHistoryEntry({
      topic: channel.address,
      timestampMs: Date.now(),
      qos: 0,
      retain: false,
      payload: new Uint8Array([1, 2, 3]),
      decoded: { hello: "world" },
    });

    render(
      <ConnectionProvider>
        <TopicStoreProvider>
          <HistoryList topic={channel.address} />
        </TopicStoreProvider>
      </ConnectionProvider>
    );

    expect(screen.queryByText('{"hello":"world"}')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("History"));
    expect(await screen.findByText('{"hello":"world"}')).toBeInTheDocument();
  });
});
`;

  const connectionFormTestTsx = `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionForm } from "../src/components/connections/ConnectionForm";
import { ConnectionProvider } from "../src/state/ConnectionContext";
import { listConnections } from "../src/storage/connections";

describe("ConnectionForm", () => {
  it("saves a new connection", async () => {
    render(
      <ConnectionProvider>
        <ConnectionForm connection={null} onSaved={() => {}} onDeleted={() => {}} onConnect={() => {}} />
      </ConnectionProvider>
    );

    // Exact match: /name/i alone would also match the "Username" field's label.
    await userEvent.clear(screen.getByLabelText(/^name$/i));
    await userEvent.type(screen.getByLabelText(/^name$/i), "My Broker");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const saved = await listConnections();
    expect(saved.some((c) => c.name === "My Broker")).toBe(true);
  });
});
`;

  return [
    { path: 'tests/setup.ts', content: setupTs },
    { path: 'tests/codec.test.ts', content: codecTestTs },
    { path: 'tests/fieldSchema.test.ts', content: fieldSchemaTestTs },
    { path: 'tests/storage.test.ts', content: storageTestTs },
    { path: 'tests/mqttTransport.test.ts', content: mqttTransportTestTs },
    { path: 'tests/topics.test.ts', content: topicsTestTs },
    { path: 'tests/TopicTree.test.tsx', content: topicTreeTestTsx },
    { path: 'tests/HistoryList.test.tsx', content: historyListTestTsx },
    { path: 'tests/PublishPanel.test.tsx', content: publishPanelTestTsx },
    { path: 'tests/ConnectionForm.test.tsx', content: connectionFormTestTsx },
  ];
}

module.exports = { buildTestFiles };
