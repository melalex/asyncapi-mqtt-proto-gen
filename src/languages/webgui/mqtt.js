'use strict';

/**
 * Emits src/mqtt/{MqttTransport,MqttJsTransport,FakeMqttTransport}.ts — this backend's own
 * independently-authored transport (same posture as js/ts, each with their own copy in their own
 * target dialect; not shared at runtime across backends). Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildMqttFiles() {
  const transportTs = `/** Duck-typed MQTT transport interface. Browsers can only speak MQTT over WebSocket, not raw TCP. */

export type MqttConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface MqttConfig {
  /** Broker URL — must point at a websocket listener (e.g. Mosquitto's \`protocol websockets\`), not the usual TCP 1883 port. */
  url: string;
  clientId?: string;
  username?: string;
  password?: string;
  /** Disable to accept a self-signed/invalid TLS certificate (mirrors the "Validate certificate" toggle). */
  rejectUnauthorized?: boolean;
}

export interface MqttTransport {
  connect(): void;
  disconnect(): void;
  publish(topic: string, payload: Uint8Array, retain?: boolean, qos?: 0 | 1 | 2): void;
  subscribe(topic: string): void;
  setMessageHandler(handler: (topic: string, payload: Uint8Array, retain: boolean) => void): void;
  setStatusHandler(handler: (status: MqttConnectionStatus) => void): void;
}
`;

  const mqttJsTransportTs = `import { Buffer } from "buffer";
import mqtt, { type MqttClient } from "mqtt";
import type { MqttConfig, MqttConnectionStatus, MqttTransport } from "./MqttTransport";

/** MqttTransport implementation backed by MQTT.js over WebSocket. */
export class MqttJsTransport implements MqttTransport {
  private client: MqttClient | null = null;
  private readonly subscriptions = new Set<string>();
  private messageHandler: ((topic: string, payload: Uint8Array, retain: boolean) => void) | null = null;
  private statusHandler: ((status: MqttConnectionStatus) => void) | null = null;

  constructor(private readonly config: MqttConfig) {}

  connect(): void {
    this.emitStatus("connecting");
    const client = mqtt.connect(this.config.url, {
      clientId: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
      rejectUnauthorized: this.config.rejectUnauthorized,
    });
    this.client = client;

    client.on("connect", () => {
      this.emitStatus("connected");
      for (const topic of this.subscriptions) client.subscribe(topic);
    });
    client.on("close", () => this.emitStatus("disconnected"));
    client.on("error", () => this.emitStatus("error"));
    client.on("message", (topic, payload, packet) => {
      this.messageHandler?.(topic, new Uint8Array(payload), !!packet.retain);
    });
  }

  disconnect(): void {
    this.client?.end(true);
    this.client = null;
    this.emitStatus("disconnected");
  }

  publish(topic: string, payload: Uint8Array, retain = false, qos: 0 | 1 | 2 = 0): void {
    // mqtt.js's published typings require string | Buffer, not a plain Uint8Array; \`buffer\`
    // (already a transitive dependency of mqtt.js's own browser bundle) works standalone in the
    // browser without needing a global Buffer polyfill configured in the bundler.
    this.client?.publish(topic, Buffer.from(payload), { retain, qos });
  }

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
    this.client?.subscribe(topic);
  }

  setMessageHandler(handler: (topic: string, payload: Uint8Array, retain: boolean) => void): void {
    this.messageHandler = handler;
  }

  setStatusHandler(handler: (status: MqttConnectionStatus) => void): void {
    this.statusHandler = handler;
  }

  private emitStatus(status: MqttConnectionStatus): void {
    this.statusHandler?.(status);
  }
}
`;

  const fakeMqttTransportTs = `import type { MqttConnectionStatus, MqttTransport } from "./MqttTransport";

export interface PublishedMessage {
  topic: string;
  payload: Uint8Array;
  retain: boolean;
  qos: number;
}

/** In-memory MqttTransport used by tests — no real broker required. */
export class FakeMqttTransport implements MqttTransport {
  published: PublishedMessage[] = [];
  subscribedTopics: string[] = [];
  connected = false;
  private messageHandler: ((topic: string, payload: Uint8Array, retain: boolean) => void) | null = null;
  private statusHandler: ((status: MqttConnectionStatus) => void) | null = null;

  connect(): void {
    this.connected = true;
    this.statusHandler?.("connected");
  }

  disconnect(): void {
    this.connected = false;
    this.statusHandler?.("disconnected");
  }

  publish(topic: string, payload: Uint8Array, retain = false, qos: 0 | 1 | 2 = 0): void {
    this.published.push({ topic, payload, retain, qos });
  }

  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }

  setMessageHandler(handler: (topic: string, payload: Uint8Array, retain: boolean) => void): void {
    this.messageHandler = handler;
  }

  setStatusHandler(handler: (status: MqttConnectionStatus) => void): void {
    this.statusHandler = handler;
  }

  /** Test helper: simulate the broker delivering \`payload\` on \`topic\`. */
  deliver(topic: string, payload: Uint8Array, retain = false): void {
    this.messageHandler?.(topic, payload, retain);
  }
}
`;

  return [
    { path: 'src/mqtt/MqttTransport.ts', content: transportTs },
    { path: 'src/mqtt/MqttJsTransport.ts', content: mqttJsTransportTs },
    { path: 'src/mqtt/FakeMqttTransport.ts', content: fakeMqttTransportTs },
  ];
}

module.exports = { buildMqttFiles };
