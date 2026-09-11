'use strict';

/**
 * Emits src/state/{ConnectionContext,TopicStore,SettingsContext}.tsx — the app's React state
 * layer (plain Context, no external state library). Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildStateFiles() {
  const connectionContextTsx = `import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { MqttJsTransport } from "../mqtt/MqttJsTransport";
import type { MqttConnectionStatus, MqttTransport } from "../mqtt/MqttTransport";
import type { SavedConnection } from "../storage/db";
import { allChannels } from "../channels";
import { subscribeFilterFor } from "../topics";

type MessageListener = (topic: string, payload: Uint8Array, retain: boolean) => void;

// How long to wait for a "connected" or a failure signal before giving up on an attempt — a
// broker that silently drops packets (wrong host/firewalled, as opposed to actively refusing the
// connection) may never fire a WebSocket error/close event on its own.
const CONNECT_TIMEOUT_MS = 8000;

interface ConnectionContextValue {
  status: MqttConnectionStatus;
  activeConnection: SavedConnection | null;
  transport: MqttTransport | null;
  /**
   * Resolves once the attempt reaches "connected", or fails ("error"/"disconnected"/timeout) — on
   * failure the attempt is rolled back (transport stopped, state reset to disconnected) before
   * resolving, so callers can safely keep their own UI open on a failed result without leaking a
   * background reconnect loop against bad connection details.
   */
  connect: (connection: SavedConnection) => Promise<MqttConnectionStatus>;
  disconnect: () => void;
  onMessage: (handler: MessageListener) => () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function buildUrl(connection: SavedConnection): string {
  const protocol = connection.tls ? "wss" : "ws";
  const path = connection.path ?? "/";
  return protocol + "://" + connection.host + ":" + connection.port + path;
}

export function ConnectionProvider(props: { children: React.ReactNode }): JSX.Element {
  const [status, setStatus] = useState<MqttConnectionStatus>("disconnected");
  const [activeConnection, setActiveConnection] = useState<SavedConnection | null>(null);
  const [transport, setTransport] = useState<MqttTransport | null>(null);
  const handlersRef = useRef(new Set<MessageListener>());
  // Mirrors \`transport\` but read/written synchronously (no re-render lag). connect()/disconnect()
  // below read THIS, not the \`transport\` state variable directly — a stable useCallback with an
  // empty dep array closes over state as of its FIRST render, so reading \`transport\` there would
  // always see null and silently skip disconnecting the previous live connection on every
  // subsequent reconnect (the underlying MqttJsTransport — and its auto-reconnect loop — would
  // leak forever, invisible to the UI, which only reflects the state values).
  const transportRef = useRef<MqttTransport | null>(null);

  const connect = useCallback((connection: SavedConnection): Promise<MqttConnectionStatus> => {
    transportRef.current?.disconnect();
    const next = new MqttJsTransport({
      url: buildUrl(connection),
      clientId: connection.clientId,
      username: connection.username,
      password: connection.password,
      rejectUnauthorized: connection.validateCertificate,
    });

    return new Promise<MqttConnectionStatus>((resolve) => {
      let settled = false;
      const finish = (result: MqttConnectionStatus): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result !== "connected") {
          // Roll back a failed/timed-out attempt: stop it outright (mqtt.js otherwise keeps
          // retrying every reconnectPeriod against the same bad details) and reset state so the
          // UI doesn't show a stale "connecting" chip for an attempt we've given up waiting on.
          next.disconnect();
          if (transportRef.current === next) transportRef.current = null;
          setTransport((current) => (current === next ? null : current));
          setActiveConnection((current) => (current === connection ? null : current));
          setStatus("disconnected");
        }
        resolve(result);
      };

      next.setStatusHandler((s) => {
        setStatus(s);
        if (s === "connected" || s === "error" || s === "disconnected") finish(s);
      });
      next.setMessageHandler((topic, payload, retain) => {
        for (const handler of handlersRef.current) handler(topic, payload, retain);
      });

      const timer = setTimeout(() => finish("error"), CONNECT_TIMEOUT_MS);

      next.connect();
      // Subscribe only to the spec's known channels — this generator is spec-driven, not a
      // wildcard ('#') broker-wide discovery tool like the reference MQTT Explorer. A channel
      // address itself may still contain AsyncAPI {param} placeholders (dynamic topic segments,
      // e.g. "fleet/{deviceId}/status") — subscribeFilterFor() turns each into an MQTT '+'
      // wildcard so messages actually arrive; the literal "{param}" string (with braces) would
      // never match anything a broker actually publishes.
      for (const channel of allChannels) next.subscribe(subscribeFilterFor(channel));
      transportRef.current = next;
      setTransport(next);
      setActiveConnection(connection);
    });
  }, []);

  const disconnect = useCallback(() => {
    transportRef.current?.disconnect();
    transportRef.current = null;
    setTransport(null);
    setActiveConnection(null);
    setStatus("disconnected");
  }, []);

  const onMessage = useCallback((handler: MessageListener) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo<ConnectionContextValue>(
    () => ({ status, activeConnection, transport, connect, disconnect, onMessage }),
    [status, activeConnection, transport, connect, disconnect, onMessage]
  );

  return <ConnectionContext.Provider value={value}>{props.children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnection must be used within a ConnectionProvider");
  return ctx;
}
`;

  const topicStoreTsx = `import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "./ConnectionContext";
import { allChannels, type ChannelMeta } from "../channels";
import { hasParameters, matchesAddress } from "../topics";
import { getMessageTypeForChannel } from "../codec/messageTypes";
import { decodeMessage } from "../codec/codec";
import { appendHistoryEntry } from "../storage/history";

export interface TopicState {
  topic: string;
  channelId: string;
  latestPayload: Uint8Array;
  previousPayload?: Uint8Array;
  latestDecoded?: Record<string, unknown>;
  previousDecoded?: Record<string, unknown>;
  decodeError?: string;
  qos: number;
  retain: boolean;
  timestampMs: number;
  messageCount: number;
}

interface TopicStoreValue {
  topics: Map<string, TopicState>;
  paused: boolean;
  setPaused: (paused: boolean) => void;
}

const TopicStoreContext = createContext<TopicStoreValue | null>(null);

// Fast path for the common case (an exact, non-parameterized address); parameterized channels
// (address contains {param} placeholders, e.g. "fleet/{deviceId}/status") fall back to pattern
// matching against the small list of them — a received topic is a CONCRETE string
// ("fleet/rover-7/status") that will never exactly equal the pattern itself.
const exactChannelsByAddress = new Map(allChannels.filter((c) => !hasParameters(c)).map((c) => [c.address, c]));
const parameterizedChannels = allChannels.filter((c) => hasParameters(c));

function resolveChannelForTopic(topic: string): ChannelMeta | undefined {
  return exactChannelsByAddress.get(topic) ?? parameterizedChannels.find((c) => matchesAddress(c, topic));
}

export function TopicStoreProvider(props: { children: React.ReactNode }): JSX.Element {
  const { onMessage } = useConnection();
  const [topics, setTopics] = useState<Map<string, TopicState>>(new Map());
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    return onMessage((topic, payload, retain) => {
      if (pausedRef.current) return;
      const channel = resolveChannelForTopic(topic);
      if (!channel) return;

      const type = getMessageTypeForChannel(channel);
      const result = decodeMessage(type, payload);
      const timestampMs = Date.now();

      setTopics((prev) => {
        const next = new Map(prev);
        const existing = next.get(topic);
        next.set(topic, {
          topic,
          channelId: channel.id,
          latestPayload: payload,
          previousPayload: existing?.latestPayload,
          latestDecoded: result.ok ? result.value : undefined,
          previousDecoded: existing?.latestDecoded,
          decodeError: result.ok ? undefined : result.error,
          qos: 0,
          retain,
          timestampMs,
          messageCount: (existing?.messageCount ?? 0) + 1,
        });
        return next;
      });

      // Not awaited (message handling itself must stay synchronous), but errors are surfaced
      // rather than silently dropped: a persistence failure here would otherwise be invisible —
      // the live message count above updates regardless (it's plain React state), so History
      // silently going empty while the count keeps working correctly is exactly what this
      // failing without anyone noticing would look like.
      appendHistoryEntry({
        topic,
        timestampMs,
        qos: 0,
        retain,
        payload,
        decoded: result.ok ? result.value : undefined,
        decodeError: result.ok ? undefined : result.error,
      }).catch((err) => console.error("Failed to persist history entry for", topic, err));
    });
  }, [onMessage]);

  const value = useMemo<TopicStoreValue>(() => ({ topics, paused, setPaused }), [topics, paused]);

  return <TopicStoreContext.Provider value={value}>{props.children}</TopicStoreContext.Provider>;
}

export function useTopicStore(): TopicStoreValue {
  const ctx = useContext(TopicStoreContext);
  if (!ctx) throw new Error("useTopicStore must be used within a TopicStoreProvider");
  return ctx;
}

export function useTopicState(topic: string): TopicState | undefined {
  const { topics } = useTopicStore();
  return topics.get(topic);
}

/**
 * For a parameterized channel (e.g. "fleet/{deviceId}/status"), the spec declares no fixed set of
 * real topics — they're only known once messages actually arrive. This returns whichever concrete
 * topics have been observed so far for a given channel id, so the topic tree can list them as they
 * show up (empty until the first message, same as MQTT Explorer's own live topic discovery).
 */
export function useDiscoveredTopics(channelId: string): TopicState[] {
  const { topics } = useTopicStore();
  return useMemo(
    () => [...topics.values()].filter((state) => state.channelId === channelId),
    [topics, channelId]
  );
}
`;

  const settingsContextTsx = `import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setLanguage, type Language } from "../i18n";

export type ThemeModePreference = "light" | "dark" | "system";

interface Settings {
  themeMode: ThemeModePreference;
  language: Language;
  autoExpand: boolean;
}

interface SettingsContextValue extends Settings {
  resolvedThemeMode: "light" | "dark";
  setThemeMode: (mode: ThemeModePreference) => void;
  setLanguagePref: (lang: Language) => void;
  setAutoExpand: (value: boolean) => void;
}

const STORAGE_KEY = "webgui.settings";
const DEFAULT_SETTINGS: Settings = { themeMode: "system", language: "en", autoExpand: false };

function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_SETTINGS;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider(props: { children: React.ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setLanguage(settings.language);
  }, [settings]);

  const resolvedThemeMode = useMemo<"light" | "dark">(() => {
    if (settings.themeMode !== "system") return settings.themeMode;
    const prefersDark =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }, [settings.themeMode]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      resolvedThemeMode,
      setThemeMode: (themeMode) => setSettings((s) => ({ ...s, themeMode })),
      setLanguagePref: (language) => setSettings((s) => ({ ...s, language })),
      setAutoExpand: (autoExpand) => setSettings((s) => ({ ...s, autoExpand })),
    }),
    [settings, resolvedThemeMode]
  );

  return <SettingsContext.Provider value={value}>{props.children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
`;

  return [
    { path: 'src/state/ConnectionContext.tsx', content: connectionContextTsx },
    { path: 'src/state/TopicStore.tsx', content: topicStoreTsx },
    { path: 'src/state/SettingsContext.tsx', content: settingsContextTsx },
  ];
}

module.exports = { buildStateFiles };
