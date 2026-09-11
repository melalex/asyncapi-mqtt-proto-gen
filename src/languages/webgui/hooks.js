'use strict';

/**
 * Emits src/hooks/{useTopicData,useFieldSchema,useSearch}.ts — small reusable hooks composing
 * the state/codec layers. Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildHookFiles() {
  const useTopicDataTs = `export { useTopicState as useTopicData } from "../state/TopicStore";
`;

  const useFieldSchemaTs = `import { useMemo } from "react";
import type { Type } from "protobufjs/light";
import { buildFieldSchema, type FieldSchema } from "../codec/fieldSchema";

/** Memoized field schema for a reflective protobufjs Type, recomputed only when the type changes. */
export function useFieldSchema(type: Type): FieldSchema[] {
  return useMemo(() => buildFieldSchema(type), [type]);
}
`;

  const useSearchTs = `import { useMemo } from "react";
import type { ChannelMeta } from "../channels";

/** Filters channels by id/address substring match (case-insensitive), memoized on inputs. */
export function useSearch(channels: ChannelMeta[], search: string): ChannelMeta[] {
  return useMemo(() => {
    if (!search) return channels;
    const needle = search.toLowerCase();
    return channels.filter(
      (c) => c.id.toLowerCase().includes(needle) || c.address.toLowerCase().includes(needle)
    );
  }, [channels, search]);
}
`;

  return [
    { path: 'src/hooks/useTopicData.ts', content: useTopicDataTs },
    { path: 'src/hooks/useFieldSchema.ts', content: useFieldSchemaTs },
    { path: 'src/hooks/useSearch.ts', content: useSearchTs },
  ];
}

module.exports = { buildHookFiles };
