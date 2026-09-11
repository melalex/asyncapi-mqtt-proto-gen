'use strict';

/**
 * Emits src/components/connections/{ConnectionsDialog,ConnectionsList,ConnectionForm}.tsx — the
 * saved-connections manager (list + add button on the left, CRUD form on the right), backed by
 * IndexedDB (src/storage/connections.ts), plaintext, local-only. Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildConnectionsComponentFiles() {
  const connectionsDialogTsx = `import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import { ConnectionsList } from "./ConnectionsList";
import { ConnectionForm } from "./ConnectionForm";
import { listConnections, ensureSeedConnections } from "../../storage/connections";
import type { SavedConnection } from "../../storage/db";

export function ConnectionsDialog(props: { open: boolean; onClose: () => void }): JSX.Element {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = (): void => {
    void listConnections().then(setConnections);
  };

  useEffect(() => {
    if (!props.open) return;
    // On first-ever open, prepopulates the store from the spec's servers section before listing
    // — a no-op on every later open (see ensureSeedConnections()'s one-time flag). refresh() runs
    // in .finally(), not .then(): a seeding failure should still let the dialog show whatever
    // connections already exist, rather than silently leaving the list stuck empty/stale.
    ensureSeedConnections()
      .catch((err) => console.error("Failed to seed connections from the spec's servers section", err))
      .finally(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const selected = connections.find((c) => c.id === selectedId) ?? null;

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="md" fullWidth>
      <Box sx={{ display: "flex", minHeight: 420 }}>
        <Box sx={{ width: 240, borderRight: 1, borderColor: "divider" }}>
          <ConnectionsList
            connections={connections}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => setSelectedId(null)}
          />
        </Box>
        <Box sx={{ flex: 1, p: 2 }}>
          <ConnectionForm
            key={selectedId ?? "new"}
            connection={selected}
            onSaved={(conn) => {
              refresh();
              setSelectedId(conn.id);
            }}
            onDeleted={() => {
              refresh();
              setSelectedId(null);
            }}
            onConnect={props.onClose}
          />
        </Box>
      </Box>
    </Dialog>
  );
}
`;

  const connectionsListTsx = `import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslation } from "react-i18next";
import type { SavedConnection } from "../../storage/db";

export function ConnectionsList(props: {
  connections: SavedConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  return (
    <Box>
      <Box sx={{ p: 1 }}>
        <IconButton onClick={props.onAdd} aria-label={t("addConnection") ?? ""}>
          <AddIcon />
        </IconButton>
      </Box>
      <List dense>
        {props.connections.map((conn) => (
          <ListItemButton key={conn.id} selected={conn.id === props.selectedId} onClick={() => props.onSelect(conn.id)}>
            <ListItemText
              primary={conn.name}
              secondary={(conn.tls ? "wss" : "ws") + "://" + conn.host + ":" + conn.port}
            />
            {/* Seeded from the spec's servers section with a caveat (e.g. "adjust the port") —
                surfaced here rather than in the row text, to keep the list scannable. */}
            {conn.description ? (
              <Tooltip title={conn.description}>
                <InfoOutlinedIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
              </Tooltip>
            ) : null}
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
`;

  const connectionFormTsx = `import { useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import { saveConnection, deleteConnection } from "../../storage/connections";
import { useConnection } from "../../state/ConnectionContext";
import type { SavedConnection } from "../../storage/db";

export function ConnectionForm(props: {
  connection: SavedConnection | null;
  onSaved: (connection: SavedConnection) => void;
  onDeleted: () => void;
  onConnect: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { connect } = useConnection();
  const c = props.connection;
  const [name, setName] = useState(c?.name ?? "");
  const [tls, setTls] = useState(c?.tls ?? false);
  const [validateCertificate, setValidateCertificate] = useState(c?.validateCertificate ?? true);
  const [host, setHost] = useState(c?.host ?? "localhost");
  const [port, setPort] = useState(c?.port ?? 9001);
  const [username, setUsername] = useState(c?.username ?? "");
  const [password, setPassword] = useState(c?.password ?? "");
  const [clientId, setClientId] = useState(c?.clientId ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleSave = async (): Promise<SavedConnection> => {
    return saveConnection({
      id: c?.id,
      name,
      protocol: tls ? "wss" : "ws",
      host,
      port,
      tls,
      validateCertificate,
      username: username || undefined,
      password: password || undefined,
      clientId: clientId || undefined,
      // No form field edits this directly — carried through unchanged from a seeded connection
      // (see storage/connections.ts's ensureSeedConnections()), dropped once there's nothing to say.
      description: c?.description,
    });
  };

  // Waits for the actual connect outcome before closing the dialog — connect() only resolves
  // once the attempt has genuinely succeeded or failed (see ConnectionContext.tsx), so incorrect
  // details keep the dialog open with an inline error instead of silently closing.
  const handleConnect = async (): Promise<void> => {
    setConnectError(null);
    setConnecting(true);
    try {
      const saved = await handleSave();
      props.onSaved(saved);
      const result = await connect(saved);
      if (result === "connected") {
        props.onConnect();
      } else {
        setConnectError(t("connectionFailed"));
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {c?.description ? <Alert severity="info">{c.description}</Alert> : null}
      <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <TextField label={t("connectionName")} value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1 }} />
        <FormControlLabel
          control={<Switch checked={validateCertificate} onChange={(e) => setValidateCertificate(e.target.checked)} />}
          label={t("validateCertificate")}
        />
        <FormControlLabel control={<Switch checked={tls} onChange={(e) => setTls(e.target.checked)} />} label={t("encryptionTls")} />
      </Box>

      <Box sx={{ display: "flex", gap: 2 }}>
        <TextField label={t("host")} value={host} onChange={(e) => setHost(e.target.value)} sx={{ flex: 1 }} />
        <TextField
          label={t("port")}
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          sx={{ width: 120 }}
        />
      </Box>

      <Box sx={{ display: "flex", gap: 2 }}>
        <TextField label={t("username")} value={username} onChange={(e) => setUsername(e.target.value)} sx={{ flex: 1 }} />
        <TextField
          label={t("password")}
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ flex: 1 }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPassword((v) => !v)} edge="end">
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <TextField label={t("clientId")} value={clientId} onChange={(e) => setClientId(e.target.value)} />

      {connectError ? (
        <Typography variant="caption" color="error">
          {connectError}
        </Typography>
      ) : null}

      <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
        {c ? (
          <Button
            color="error"
            disabled={connecting}
            onClick={() => {
              void deleteConnection(c.id).then(() => props.onDeleted());
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outlined"
          disabled={connecting}
          onClick={() => {
            void handleSave().then((saved) => props.onSaved(saved));
          }}
        >
          {t("save")}
        </Button>
        <Button
          variant="contained"
          disabled={connecting}
          startIcon={connecting ? <CircularProgress size={16} color="inherit" /> : undefined}
          onClick={() => {
            void handleConnect();
          }}
        >
          {connecting ? t("connecting") : t("connect")}
        </Button>
      </Box>
    </Box>
  );
}
`;

  return [
    { path: 'src/components/connections/ConnectionsDialog.tsx', content: connectionsDialogTsx },
    { path: 'src/components/connections/ConnectionsList.tsx', content: connectionsListTsx },
    { path: 'src/components/connections/ConnectionForm.tsx', content: connectionFormTsx },
  ];
}

module.exports = { buildConnectionsComponentFiles };
