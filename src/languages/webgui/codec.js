'use strict';

/**
 * Emits src/codec/{root,messageTypes,fieldSchema,codec}.ts — the protobufjs-reflection layer
 * that replaces per-channel generated encode/decode code. Static — independent of the spec;
 * every message shape is handled generically at runtime.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildCodecFiles() {
  const rootTs = `/**
 * Loads the compiled protobuf reflection root. \`npm run proto\` compiles every proto/*.proto file
 * into src/generated/messages.js via \`pbjs -t json-module\`, whose default export is already a
 * resolved protobufjs/light Root — no Root.fromJSON call is needed here.
 */
import type { Root } from "protobufjs/light";
// @ts-expect-error -- src/generated/messages.js has no declaration file (compiled by pbjs, not tsc)
import generatedRoot from "../generated/messages.js";

const root = generatedRoot as Root;
root.resolveAll();

export default root;
`;

  const messageTypesTs = `import type { Type } from "protobufjs/light";
import type { ChannelMeta } from "../channels";
import root from "./root";

const cache = new Map<string, Type>();

/** Looks up (and memoizes) the reflective protobufjs Type for a proto package + message name. */
export function getMessageType(protoPackage: string, protoMessageType: string): Type {
  const key = protoPackage + "." + protoMessageType;
  let type = cache.get(key);
  if (!type) {
    type = root.lookupType(key);
    cache.set(key, type);
  }
  return type;
}

/** Convenience wrapper reading the two IR fields straight off a channel. */
export function getMessageTypeForChannel(channel: ChannelMeta): Type {
  return getMessageType(channel.protoPackage, channel.protoMessageType);
}
`;

  const fieldSchemaTs = `import { Enum, Type, type Field } from "protobufjs/light";

export type FieldKind = "scalar" | "enum" | "message" | "map";

export interface FieldSchema {
  name: string;
  id: number;
  protoType: string;
  kind: FieldKind;
  repeated: boolean;
  map: boolean;
  keyType?: string;
  enumValues?: Record<string, number>;
  nestedFields?: FieldSchema[];
  nestedTypeName?: string;
}

/**
 * Walks a reflective protobufjs Type's fields into a plain, JSON-serializable schema describing
 * every field — drives both the read-only field->value view and the auto-generated publish form,
 * for any message shape the spec declares, without per-message hand code.
 *
 * Guards against cyclic/self-referential message types (legal in proto3) via \`seen\`, the set of
 * fully-qualified type names already visited on the current recursion path: an already-visited
 * type stops recursing (nestedFields omitted) instead of overflowing the stack.
 */
export function buildFieldSchema(type: Type, seen: Set<string> = new Set()): FieldSchema[] {
  type.resolveAll();
  const nextSeen = new Set(seen);
  nextSeen.add(type.fullName);

  return type.fieldsArray.map((field: Field): FieldSchema => {
    field.resolve();
    const resolved = field.resolvedType;

    let kind: FieldKind = "scalar";
    let enumValues: Record<string, number> | undefined;
    let nestedFields: FieldSchema[] | undefined;
    let nestedTypeName: string | undefined;

    if (resolved instanceof Enum) {
      kind = "enum";
      enumValues = { ...resolved.values };
    } else if (resolved instanceof Type) {
      kind = "message";
      nestedTypeName = resolved.fullName;
      if (!nextSeen.has(resolved.fullName)) {
        nestedFields = buildFieldSchema(resolved, nextSeen);
      }
    }

    return {
      name: field.name,
      id: field.id,
      protoType: field.type,
      kind: field.map ? "map" : kind,
      repeated: field.repeated,
      map: !!field.map,
      keyType: field.map ? (field as unknown as { keyType: string }).keyType : undefined,
      enumValues,
      nestedFields,
      nestedTypeName,
    };
  });
}
`;

  const codecTs = `import type { Type } from "protobufjs/light";

export interface DecodeResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

/** Encodes a plain object into protobuf binary, throwing a readable error if it doesn't match the schema. */
export function encodeMessage(type: Type, obj: unknown): Uint8Array {
  const problem = type.verify(obj as Record<string, unknown>);
  if (problem) {
    throw new Error("Invalid " + type.fullName + " message: " + problem);
  }
  const message = type.fromObject(obj as Record<string, unknown>);
  return type.encode(message).finish();
}

/** Decodes protobuf binary into a plain object, catching malformed input rather than throwing. */
export function decodeMessage(type: Type, bytes: Uint8Array): DecodeResult {
  try {
    const message = type.decode(bytes);
    const value = type.toObject(message, { enums: String, longs: String, defaults: true }) as Record<
      string,
      unknown
    >;
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
`;

  return [
    { path: 'src/codec/root.ts', content: rootTs },
    { path: 'src/codec/messageTypes.ts', content: messageTypesTs },
    { path: 'src/codec/fieldSchema.ts', content: fieldSchemaTs },
    { path: 'src/codec/codec.ts', content: codecTs },
  ];
}

module.exports = { buildCodecFiles };
