'use strict';

/**
 * Emits src/components/layout/{AppShell,TopAppBar,LeftPanel}.tsx — the persistent
 * left-panel-plus-detail-pane shell (MQTT Explorer's own layout). Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildLayoutComponentFiles() {
  const appShellTsx = `import { useState } from "react";
import Box from "@mui/material/Box";
import { TopAppBar } from "./TopAppBar";
import { LeftPanel } from "./LeftPanel";
import { TopicDetailView } from "../topic/TopicDetailView";
import { ConnectionsDialog } from "../connections/ConnectionsDialog";
import type { ChannelMeta } from "../../channels";

const LEFT_PANEL_WIDTH = 320;

/**
 * A selected channel plus the concrete topic to actually inspect/publish to — the two differ for
 * a parameterized channel (e.g. "fleet/{deviceId}/status"): \`channel.address\` is still the raw
 * "{deviceId}" pattern, but \`topic\` is either that same pattern (selected the channel itself,
 * before typing a real id to publish to) or a real discovered instance like "fleet/rover-7/status".
 */
interface Selection {
  channel: ChannelMeta;
  topic: string;
}

export function AppShell(): JSX.Element {
  const [leftPanelMode, setLeftPanelMode] = useState<"tree" | "settings">("tree");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopAppBar
        onToggleLeftPanel={() => setLeftPanelMode((m) => (m === "tree" ? "settings" : "tree"))}
        search={search}
        onSearchChange={setSearch}
        onOpenConnections={() => setConnectionsOpen(true)}
      />
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Box
          sx={{ width: LEFT_PANEL_WIDTH, flexShrink: 0, borderRight: 1, borderColor: "divider", overflow: "auto" }}
        >
          <LeftPanel
            mode={leftPanelMode}
            search={search}
            selectedChannelId={selection?.channel.id ?? null}
            selectedTopic={selection?.topic ?? null}
            onSelectChannel={(channel, topic) => setSelection({ channel, topic })}
          />
        </Box>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <TopicDetailView channel={selection?.channel ?? null} topic={selection?.topic ?? null} />
        </Box>
      </Box>
      <ConnectionsDialog open={connectionsOpen} onClose={() => setConnectionsOpen(false)} />
    </Box>
  );
}
`;

  const topAppBarTsx = `import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CableIcon from "@mui/icons-material/Cable";
import { useTranslation } from "react-i18next";
import { useConnection } from "../../state/ConnectionContext";
import { useTopicStore } from "../../state/TopicStore";
import { specTitle } from "../../channels";

export function TopAppBar(props: {
  onToggleLeftPanel: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenConnections: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { status, activeConnection, disconnect } = useConnection();
  const { paused, setPaused } = useTopicStore();

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar sx={{ gap: 2 }}>
        <IconButton edge="start" onClick={props.onToggleLeftPanel} aria-label={t("settings")}>
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" noWrap>
          {specTitle}
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            maxWidth: 400,
            px: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          <SearchIcon fontSize="small" sx={{ opacity: 0.6 }} />
          <InputBase
            placeholder={t("search") ?? ""}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            sx={{ ml: 1, flex: 1 }}
          />
        </Box>
        <Tooltip title={t(paused ? "resumeUpdates" : "pauseUpdates") ?? ""}>
          <IconButton onClick={() => setPaused(!paused)}>{paused ? <PlayArrowIcon /> : <PauseIcon />}</IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {activeConnection ? (
          <Chip
            label={activeConnection.name + " — " + status}
            color={status === "connected" ? "success" : status === "error" ? "error" : "default"}
            onDelete={disconnect}
          />
        ) : null}
        <Tooltip title={t("connections") ?? ""}>
          <IconButton onClick={props.onOpenConnections}>
            <CableIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
`;

  const leftPanelTsx = `import { TopicTree } from "../tree/TopicTree";
import { SettingsPanel } from "../settings/SettingsPanel";
import type { ChannelMeta } from "../../channels";

export function LeftPanel(props: {
  mode: "tree" | "settings";
  search: string;
  selectedChannelId: string | null;
  selectedTopic: string | null;
  onSelectChannel: (channel: ChannelMeta, topic: string) => void;
}): JSX.Element {
  return props.mode === "tree" ? (
    <TopicTree
      search={props.search}
      selectedChannelId={props.selectedChannelId}
      selectedTopic={props.selectedTopic}
      onSelectChannel={props.onSelectChannel}
    />
  ) : (
    <SettingsPanel />
  );
}
`;

  return [
    { path: 'src/components/layout/AppShell.tsx', content: appShellTsx },
    { path: 'src/components/layout/TopAppBar.tsx', content: topAppBarTsx },
    { path: 'src/components/layout/LeftPanel.tsx', content: leftPanelTsx },
  ];
}

module.exports = { buildLayoutComponentFiles };
