'use strict';

/**
 * Emits src/components/topic/{TopicDetailView,TopicBreadcrumb,ValueSection,ValueJsonView,
 * ValueRawView,ValueFieldsView,ValueDiff,HistoryList}.tsx — the right-hand detail pane: topic
 * breadcrumb, JSON/raw/field->value message inspector with change highlighting, and history.
 * Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildTopicComponentFiles() {
  const topicDetailViewTsx = `import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import type { ChannelMeta } from "../../channels";
import { TopicBreadcrumb } from "./TopicBreadcrumb";
import { ValueSection } from "./ValueSection";
import { PublishPanel } from "../publish/PublishPanel";

export function TopicDetailView(props: { channel: ChannelMeta | null; topic: string | null }): JSX.Element {
  const { t } = useTranslation();

  if (!props.channel || !props.topic) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">{t("noTopicSelected")}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <TopicBreadcrumb topic={props.topic} />
      {/* Keyed by topic (prefixed per component so the two siblings never collide on the same
          key): forces a fresh mount per selection rather than reusing the previous topic's
          component instance, so PublishPanel's editable topic field (and its form/json draft
          state) don't carry over stale values from whatever was selected before. */}
      <ValueSection key={"value-" + props.topic} channel={props.channel} topic={props.topic} />
      <PublishPanel key={"publish-" + props.topic} channel={props.channel} topic={props.topic} />
    </Box>
  );
}
`;

  const topicBreadcrumbTsx = `import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { clearHistoryForTopic } from "../../storage/history";

export function TopicBreadcrumb(props: { topic: string }): JSX.Element {
  const segments = props.topic.split("/").filter(Boolean);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      {segments.map((segment, i) => (
        <Chip key={i} label={segment} size="small" />
      ))}
      <IconButton size="small" onClick={() => void navigator.clipboard?.writeText(props.topic)}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={() => void clearHistoryForTopic(props.topic)}>
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
`;

  const valueSectionTsx = `import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import type { ChannelMeta } from "../../channels";
import { useTopicData } from "../../hooks/useTopicData";
import { getMessageTypeForChannel } from "../../codec/messageTypes";
import { ValueRawView } from "./ValueRawView";
import { ValueFieldsView } from "./ValueFieldsView";
import { ValueDiff } from "./ValueDiff";
import { HistoryList } from "./HistoryList";

type ViewMode = "json" | "raw" | "fields";

export function ValueSection(props: { channel: ChannelMeta; topic: string }): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewMode>("json");
  const state = useTopicData(props.topic);
  const type = getMessageTypeForChannel(props.channel);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="subtitle1">{t("value")}</Typography>
        {state ? (
          <Typography variant="caption" color="text.secondary">
            QoS: {state.qos} · {new Date(state.timestampMs).toLocaleString()}
          </Typography>
        ) : null}
      </Box>
      <Tabs value={view} onChange={(_, v: ViewMode) => setView(v)} sx={{ minHeight: 32, mb: 1 }}>
        <Tab value="json" label={t("viewJson")} sx={{ minHeight: 32 }} />
        <Tab value="raw" label={t("viewRaw")} sx={{ minHeight: 32 }} />
        <Tab value="fields" label={t("viewFields")} sx={{ minHeight: 32 }} />
      </Tabs>

      {!state ? (
        <Typography color="text.secondary">{t("noTopicSelected")}</Typography>
      ) : view === "json" ? (
        <ValueDiff current={state.latestDecoded} previous={state.previousDecoded} />
      ) : view === "raw" ? (
        <ValueRawView payload={state.latestPayload} />
      ) : (
        <ValueFieldsView type={type} decoded={state.latestDecoded} />
      )}

      <HistoryList topic={props.topic} />
    </Paper>
  );
}
`;

  const valueJsonViewTsx = `import Box from "@mui/material/Box";

export function ValueJsonView(props: { decoded: Record<string, unknown> | undefined }): JSX.Element {
  const text = props.decoded !== undefined ? JSON.stringify(props.decoded, null, 2) : "";
  return (
    <Box component="pre" sx={{ m: 0, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
      {text}
    </Box>
  );
}
`;

  const valueRawViewTsx = `import { useState } from "react";
import Box from "@mui/material/Box";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import { bytesToHex, bytesToBase64 } from "../../utils/bytes";

type Encoding = "hex" | "base64";

export function ValueRawView(props: { payload: Uint8Array }): JSX.Element {
  const [encoding, setEncoding] = useState<Encoding>("hex");
  const text = encoding === "hex" ? bytesToHex(props.payload) : bytesToBase64(props.payload);

  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={encoding}
        onChange={(_, v: Encoding | null) => v && setEncoding(v)}
        sx={{ mb: 1 }}
      >
        <ToggleButton value="hex">hex</ToggleButton>
        <ToggleButton value="base64">base64</ToggleButton>
      </ToggleButtonGroup>
      <Box
        component="pre"
        sx={{ m: 0, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        {text}
      </Box>
    </Box>
  );
}
`;

  const valueFieldsViewTsx = `import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import type { Type } from "protobufjs/light";
import { useFieldSchema } from "../../hooks/useFieldSchema";

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ValueFieldsView(props: { type: Type; decoded: Record<string, unknown> | undefined }): JSX.Element {
  const schema = useFieldSchema(props.type);

  return (
    <Table size="small">
      <TableBody>
        {schema.map((field) => (
          <TableRow key={field.name}>
            <TableCell sx={{ fontWeight: 600, width: "35%" }}>{field.name}</TableCell>
            <TableCell sx={{ fontFamily: "monospace" }}>{formatValue(props.decoded?.[field.name])}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
`;

  const valueDiffTsx = `import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { diffJsonText } from "../../diff/textDiff";
import { ValueJsonView } from "./ValueJsonView";

export function ValueDiff(props: {
  current: Record<string, unknown> | undefined;
  previous: Record<string, unknown> | undefined;
}): JSX.Element {
  const { t } = useTranslation();

  if (props.previous === undefined) {
    return <ValueJsonView decoded={props.current} />;
  }

  const currentText = JSON.stringify(props.current, null, 2) ?? "";
  const previousText = JSON.stringify(props.previous, null, 2);
  const { lines, added, removed } = diffJsonText(previousText, currentText);

  return (
    <Box>
      <Box component="pre" sx={{ m: 0, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
        {lines.map((line, i) => (
          <Box
            key={i}
            component="div"
            sx={{
              bgcolor: line.type === "added" ? "success.main" : line.type === "removed" ? "error.main" : undefined,
              color: line.type !== "unchanged" ? "common.white" : undefined,
              opacity: line.type !== "unchanged" ? 0.85 : 1,
              px: 0.5,
            }}
          >
            {(line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  ") + line.text}
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t("comparingWithPrevious")}: +{added} -{removed}
      </Typography>
    </Box>
  );
}
`;

  const historyListTsx = `import { useEffect, useState } from "react";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTranslation } from "react-i18next";
import { getHistoryForTopic } from "../../storage/history";
import type { HistoryEntry } from "../../storage/db";
import { useTopicData } from "../../hooks/useTopicData";

export function HistoryList(props: { topic: string }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const state = useTopicData(props.topic);
  const count = state?.messageCount ?? 0;

  useEffect(() => {
    if (!open) return;
    void getHistoryForTopic(props.topic, 100).then(setEntries);
  }, [open, props.topic, state?.messageCount]);

  return (
    <Box sx={{ mt: 1 }}>
      <ListItemButton onClick={() => setOpen((o) => !o)} sx={{ px: 0 }}>
        <ListItemText primary={t("history")} />
        {/* A plain inline Chip, not MUI's Badge — Badge positions its counter absolutely
            *relative to its children*, and rendering it with no children (as a bare standalone
            counter) leaves it unanchored: in a real browser it can end up covering the row and
            silently swallowing clicks meant for this button, even though it displays correctly. */}
        {count > 0 ? (
          <Chip label={count > 99 ? "99+" : count} size="small" color="primary" sx={{ mr: 1 }} />
        ) : null}
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List dense sx={{ maxHeight: 240, overflow: "auto" }}>
          {entries.map((entry) => (
            <ListItemButton key={entry.id} dense>
              <ListItemText
                primary={new Date(entry.timestampMs).toLocaleString()}
                secondary={entry.decoded ? JSON.stringify(entry.decoded).slice(0, 80) : entry.decodeError}
              />
            </ListItemButton>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
`;

  return [
    { path: 'src/components/topic/TopicDetailView.tsx', content: topicDetailViewTsx },
    { path: 'src/components/topic/TopicBreadcrumb.tsx', content: topicBreadcrumbTsx },
    { path: 'src/components/topic/ValueSection.tsx', content: valueSectionTsx },
    { path: 'src/components/topic/ValueJsonView.tsx', content: valueJsonViewTsx },
    { path: 'src/components/topic/ValueRawView.tsx', content: valueRawViewTsx },
    { path: 'src/components/topic/ValueFieldsView.tsx', content: valueFieldsViewTsx },
    { path: 'src/components/topic/ValueDiff.tsx', content: valueDiffTsx },
    { path: 'src/components/topic/HistoryList.tsx', content: historyListTsx },
  ];
}

module.exports = { buildTopicComponentFiles };
