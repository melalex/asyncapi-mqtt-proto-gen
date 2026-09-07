'use strict';

const { slugify, assertValidIdentifier } = require('./naming');

/**
 * Splits a channel list into tag groups plus the ungrouped remainder, so every backend renders
 * the same client shape:
 *
 *   messageBus.<tagName>.<channel>.publish/subscribe/address   — channels that carry tags
 *   messageBus.<channel>.publish/subscribe/address             — channels with no tags
 *
 * `<tagName>` is `slugify(tag)` (lower_snake_case), identical across all four languages. A channel
 * with several tags is a member of every one of those groups. Two tag strings that slugify to the
 * same name collapse into one group (members deduplicated by `keyOf`).
 *
 * `keyOf(channel)` returns the per-language accessor identifier for a channel (the raw channel id
 * for cpp/js/ts, the snake_cased attribute name for python) — used both to dedupe group members
 * and to detect a group name that would collide with an untagged channel's top-level accessor.
 *
 * @param {Array<{ id: string, tags?: string[] }>} channels shared-IR channels (optionally view-modeled)
 * @param {(channel: object) => string} [keyOf] accessor-name extractor; defaults to `c => c.id`
 * @returns {{
 *   flat: Array<object>,
 *   groups: Array<{ name: string, tags: string[], channels: Array<object> }>
 * }} `flat` in spec order; `groups` sorted by name, each group's `channels` in spec order
 */
function groupChannels(channels, keyOf = (c) => c.id) {
  const flat = [];
  const groups = new Map(); // slug -> { name, tags: Set, channels: [], memberKeys: Set }

  for (const channel of channels) {
    const tags = channel.tags || [];
    if (tags.length === 0) {
      flat.push(channel);
      continue;
    }
    for (const tag of tags) {
      const name = assertValidIdentifier(slugify(tag), `Tag "${tag}"`);
      let group = groups.get(name);
      if (!group) {
        group = { name, tags: new Set(), channels: [], memberKeys: new Set() };
        groups.set(name, group);
      }
      group.tags.add(tag);
      const key = keyOf(channel);
      if (!group.memberKeys.has(key)) {
        group.memberKeys.add(key);
        group.channels.push(channel);
      }
    }
  }

  const flatKeys = new Set(flat.map(keyOf));
  for (const name of groups.keys()) {
    if (flatKeys.has(name)) {
      throw new Error(
        `Tag group "${name}" collides with untagged channel "${name}"; rename the tag or the channel.`
      );
    }
  }

  return {
    flat,
    groups: [...groups.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((g) => ({ name: g.name, tags: [...g.tags], channels: g.channels })),
  };
}

module.exports = { groupChannels };
