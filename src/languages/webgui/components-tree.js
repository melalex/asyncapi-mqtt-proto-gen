'use strict';

/**
 * Emits src/components/tree/{TopicTree,TopicTreeNode}.tsx — the left-panel topic tree, grouped
 * by tag (via src/channels.ts, itself built from the shared channel-groups.js). Static —
 * independent of the spec (the tree renders whatever channels.ts declares).
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTreeComponentFiles() {
  const topicTreeTsx = `import List from "@mui/material/List";
import { flatChannels, channelGroups, type ChannelMeta } from "../../channels";
import { TopicTreeNode } from "./TopicTreeNode";

function matches(channel: ChannelMeta, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return channel.id.toLowerCase().includes(needle) || channel.address.toLowerCase().includes(needle);
}

export function TopicTree(props: {
  search: string;
  selectedChannelId: string | null;
  selectedTopic: string | null;
  onSelectChannel: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  const visibleFlat = flatChannels.filter((c) => matches(c, props.search));
  const visibleGroups = channelGroups
    .map((g) => ({ ...g, channels: g.channels.filter((c) => matches(c, props.search)) }))
    .filter((g) => g.channels.length > 0);

  return (
    <List dense disablePadding>
      {visibleGroups.map((group) => (
        <TopicTreeNode
          key={group.name}
          label={group.name}
          channels={group.channels}
          selectedChannelId={props.selectedChannelId}
          selectedTopic={props.selectedTopic}
          onSelectChannel={props.onSelectChannel}
        />
      ))}
      {visibleFlat.map((channel) => (
        <TopicTreeNode
          key={channel.id}
          label={channel.id}
          channels={[channel]}
          leaf
          selectedChannelId={props.selectedChannelId}
          selectedTopic={props.selectedTopic}
          onSelectChannel={props.onSelectChannel}
        />
      ))}
    </List>
  );
}
`;

  const topicTreeNodeTsx = `import { useState } from "react";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTopicData } from "../../hooks/useTopicData";
import { useDiscoveredTopics } from "../../state/TopicStore";
import { hasParameters } from "../../topics";
import type { ChannelMeta } from "../../channels";

function PlainChannelRow(props: {
  channel: ChannelMeta;
  selected: boolean;
  onSelect: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  const state = useTopicData(props.channel.address);
  const preview = state?.latestDecoded ? JSON.stringify(state.latestDecoded) : undefined;

  return (
    <ListItemButton
      selected={props.selected}
      onClick={() => props.onSelect(props.channel, props.channel.address)}
      sx={{ pl: 4 }}
    >
      <ListItemText
        primary={props.channel.id}
        secondary={preview ? preview.slice(0, 60) : undefined}
        primaryTypographyProps={{ variant: "body2" }}
        secondaryTypographyProps={{ variant: "caption", noWrap: true }}
      />
    </ListItemButton>
  );
}

/**
 * A channel whose address contains AsyncAPI {param} placeholders (e.g. "fleet/{deviceId}/status")
 * has no fixed real topic — the spec doesn't enumerate device ids, so there's nothing to select
 * until a message actually arrives. Subscribing uses an MQTT '+' wildcard (see
 * ConnectionContext.tsx); this renders whichever concrete topics have shown up so far as an
 * expandable sub-list, same spirit as MQTT Explorer's own live topic discovery. The channel
 * itself is still selectable (its row's primary click) — for publishing to an id that hasn't sent
 * anything yet, with the raw "{param}" pattern as an editable starting point in the Topic field.
 */
function ParameterizedChannelRow(props: {
  channel: ChannelMeta;
  selectedTopic: string | null;
  onSelect: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const discovered = useDiscoveredTopics(props.channel.id);

  return (
    <>
      <ListItemButton
        selected={props.selectedTopic === props.channel.address}
        onClick={() => {
          props.onSelect(props.channel, props.channel.address);
          setOpen((o) => !o);
        }}
        sx={{ pl: 4 }}
      >
        <ListItemText
          primary={props.channel.id}
          secondary={
            discovered.length === 0
              ? "no instances discovered yet"
              : discovered.length + " instance" + (discovered.length === 1 ? "" : "s") + " discovered"
          }
          primaryTypographyProps={{ variant: "body2" }}
          secondaryTypographyProps={{ variant: "caption" }}
        />
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List dense disablePadding>
          {discovered.map((state) => {
            const preview = state.latestDecoded ? JSON.stringify(state.latestDecoded) : undefined;
            return (
              <ListItemButton
                key={state.topic}
                selected={props.selectedTopic === state.topic}
                onClick={() => props.onSelect(props.channel, state.topic)}
                sx={{ pl: 6 }}
              >
                <ListItemText
                  primary={state.topic}
                  secondary={preview ? preview.slice(0, 60) : undefined}
                  primaryTypographyProps={{ variant: "body2" }}
                  secondaryTypographyProps={{ variant: "caption", noWrap: true }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Collapse>
    </>
  );
}

function ChannelRow(props: {
  channel: ChannelMeta;
  selectedChannelId: string | null;
  selectedTopic: string | null;
  onSelect: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  if (hasParameters(props.channel)) {
    return <ParameterizedChannelRow channel={props.channel} selectedTopic={props.selectedTopic} onSelect={props.onSelect} />;
  }
  return (
    <PlainChannelRow
      channel={props.channel}
      selected={props.selectedChannelId === props.channel.id}
      onSelect={props.onSelect}
    />
  );
}

export function TopicTreeNode(props: {
  label: string;
  channels: ChannelMeta[];
  leaf?: boolean;
  selectedChannelId: string | null;
  selectedTopic: string | null;
  onSelectChannel: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);

  if (props.leaf) {
    const channel = props.channels[0];
    return (
      <ChannelRow
        channel={channel}
        selectedChannelId={props.selectedChannelId}
        selectedTopic={props.selectedTopic}
        onSelect={props.onSelectChannel}
      />
    );
  }

  return (
    <>
      <ListItemButton onClick={() => setOpen((o) => !o)}>
        <ListItemText
          primary={props.label}
          secondary={props.channels.length + " topics"}
          primaryTypographyProps={{ fontWeight: 600 }}
        />
        {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List dense disablePadding>
          {props.channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              selectedChannelId={props.selectedChannelId}
              selectedTopic={props.selectedTopic}
              onSelect={props.onSelectChannel}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
}
`;

  return [
    { path: 'src/components/tree/TopicTree.tsx', content: topicTreeTsx },
    { path: 'src/components/tree/TopicTreeNode.tsx', content: topicTreeNodeTsx },
  ];
}

module.exports = { buildTreeComponentFiles };
