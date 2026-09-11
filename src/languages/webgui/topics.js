'use strict';

/**
 * Emits src/topics.ts: AsyncAPI channel-parameter handling ({dishId}-style dynamic topic
 * segments). Static — independent of the spec; every channel's address is inspected generically
 * at runtime rather than requiring generation-time parameter extraction.
 *
 * A channel address containing a `{param}` segment isn't a literal MQTT topic — the generator
 * previously subscribed to that literal string (including the braces), which can never match any
 * real published topic, so parameterized channels silently never received anything. These helpers
 * convert such an address into an MQTT `+`-wildcard subscribe filter, and match a concrete
 * received topic back to its declaring channel.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTopicsFile() {
  const content = `import type { ChannelMeta } from "./channels";

/** True if a channel's address contains AsyncAPI {param} placeholders (dynamic topic segments). */
export function hasParameters(channel: ChannelMeta): boolean {
  return /\\{[^}]+\\}/.test(channel.address);
}

/**
 * The MQTT subscribe filter for a channel: each {param} segment becomes a single-level '+'
 * wildcard (matching AsyncAPI's own convention for MQTT parameterized channels). A channel with
 * no parameters subscribes to its address unchanged.
 */
export function subscribeFilterFor(channel: ChannelMeta): string {
  return channel.address.replace(/\\{[^}]+\\}/g, "+");
}

/**
 * True if a concrete MQTT topic matches a channel's address pattern, segment by segment — a
 * {param} segment matches exactly one non-empty topic segment, the same semantics as MQTT's own
 * '+' wildcard.
 */
export function matchesAddress(channel: ChannelMeta, topic: string): boolean {
  const patternSegments = channel.address.split("/");
  const topicSegments = topic.split("/");
  if (patternSegments.length !== topicSegments.length) return false;
  return patternSegments.every(
    (segment, i) => (/^\\{[^}]+\\}$/.test(segment) && topicSegments[i].length > 0) || segment === topicSegments[i]
  );
}

/** Finds the channel (if any) whose address pattern matches a concrete received topic. */
export function findChannelForTopic(channels: ChannelMeta[], topic: string): ChannelMeta | undefined {
  return channels.find((c) => matchesAddress(c, topic));
}
`;

  return [{ path: 'src/topics.ts', content }];
}

module.exports = { buildTopicsFile };
