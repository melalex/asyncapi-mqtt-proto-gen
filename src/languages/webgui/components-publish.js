'use strict';

/**
 * Emits src/components/publish/{PublishPanel,PublishJsonEditor,PublishFormEditor,
 * PublishFormField,PublishRawEditor}.tsx — the three publish modes (JSON, auto-generated HTML
 * form, raw protobuf bytes). Static — independent of the spec (forms are built generically from
 * runtime protobufjs reflection, see src/codec/fieldSchema.ts).
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildPublishComponentFiles() {
  const publishPanelTsx = `import { useCallback, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import ClearIcon from "@mui/icons-material/Clear";
import SendIcon from "@mui/icons-material/Send";
import { useTranslation } from "react-i18next";
import type { ChannelMeta } from "../../channels";
import { useConnection } from "../../state/ConnectionContext";
import { PublishJsonEditor } from "./PublishJsonEditor";
import { PublishFormEditor } from "./PublishFormEditor";
import { PublishRawEditor } from "./PublishRawEditor";
import { getMessageTypeForChannel } from "../../codec/messageTypes";

type PublishMode = "json" | "form" | "raw";
type Qos = 0 | 1 | 2;

export function PublishPanel(props: { channel: ChannelMeta; topic: string }): JSX.Element {
  const { t } = useTranslation();
  const { transport } = useConnection();
  // Seeded from props.topic once — TopicDetailView mounts a fresh PublishPanel per topic (key=
  // topic) specifically so this local, further-editable copy always starts from the right value
  // instead of carrying over a previously-selected topic's text into the new selection.
  const [topic, setTopic] = useState(props.topic);
  const [mode, setMode] = useState<PublishMode>("form");
  const [qos, setQos] = useState<Qos>(0);
  // Always shown (matches the MQTT Explorer reference), default-checked from the spec's retain
  // intent for this channel — the user can still override it per publish.
  const [retain, setRetain] = useState(props.channel.retain);
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const type = useMemo(() => getMessageTypeForChannel(props.channel), [props.channel]);

  // Stable identity across renders: each editor's useEffect depends on this callback, so an
  // inline lambda here would re-trigger it on every render (parent state update -> new lambda
  // identity -> effect re-fires -> parent state update -> ...), an infinite render loop. The
  // setState calls it closes over are themselves identity-stable, so an empty dep array is safe.
  const handleEditorChange = useCallback((bytes: Uint8Array | null, err: string | null) => {
    setPendingBytes(bytes);
    setError(err);
  }, []);

  const canPublish = pendingBytes !== null && !error;

  const handlePublish = (): void => {
    if (!pendingBytes || !transport) return;
    transport.publish(topic, pendingBytes, retain, qos);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        {t("publish")}
      </Typography>
      <TextField
        fullWidth
        size="small"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        label={t("topic")}
        InputProps={{
          endAdornment: (
            <IconButton size="small" onClick={() => setTopic("")}>
              <ClearIcon fontSize="small" />
            </IconButton>
          ),
        }}
        sx={{ mb: 2 }}
      />

      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, v: PublishMode | null) => v && setMode(v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="raw">{t("publishModeRaw")}</ToggleButton>
        <ToggleButton value="form">{t("publishModeForm")}</ToggleButton>
        <ToggleButton value="json">{t("publishModeJson")}</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ mb: 2 }}>
        {mode === "json" ? (
          <PublishJsonEditor type={type} onChange={handleEditorChange} />
        ) : mode === "form" ? (
          <PublishFormEditor type={type} onChange={handleEditorChange} />
        ) : (
          <PublishRawEditor onChange={handleEditorChange} />
        )}
        {error ? (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        ) : null}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Select size="small" value={qos} onChange={(e) => setQos(Number(e.target.value) as Qos)}>
          <MenuItem value={0}>QoS 0</MenuItem>
          <MenuItem value={1}>QoS 1</MenuItem>
          <MenuItem value={2}>QoS 2</MenuItem>
        </Select>
        <FormControlLabel
          control={<Checkbox checked={retain} onChange={(e) => setRetain(e.target.checked)} />}
          label={t("retain")}
        />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<SendIcon />} disabled={!canPublish || !transport} onClick={handlePublish}>
          {t("publish")}
        </Button>
      </Box>
    </Paper>
  );
}
`;

  const publishJsonEditorTsx = `import { useEffect, useState } from "react";
import TextField from "@mui/material/TextField";
import type { Type } from "protobufjs/light";
import { encodeMessage } from "../../codec/codec";

export function PublishJsonEditor(props: {
  type: Type;
  onChange: (bytes: Uint8Array | null, error: string | null) => void;
}): JSX.Element {
  const [text, setText] = useState("{}");
  const { onChange, type } = props;

  useEffect(() => {
    try {
      const obj: unknown = JSON.parse(text);
      const bytes = encodeMessage(type, obj);
      onChange(bytes, null);
    } catch (err) {
      onChange(null, err instanceof Error ? err.message : "Invalid JSON");
    }
  }, [text, type, onChange]);

  return (
    <TextField
      fullWidth
      multiline
      minRows={6}
      value={text}
      onChange={(e) => setText(e.target.value)}
      sx={{ "& textarea": { fontFamily: "monospace" } }}
    />
  );
}
`;

  const publishFormFieldTsx = `import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FieldSchema } from "../../codec/fieldSchema";

const NUMERIC_PROTO_TYPES = /^(u?int|s?int|s?fixed)(32|64)$|^float$|^double$/;

export function PublishFormField(props: {
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const { field, value, onChange } = props;

  if (field.repeated || field.map) {
    // Repeated/map fields are edited as raw JSON here — a full dedicated list/key-value editor is
    // out of scope for the auto-generated form; the JSON publish mode remains the full-fidelity
    // escape hatch for these shapes.
    return (
      <TextField
        fullWidth
        size="small"
        label={field.name + " (JSON)"}
        value={value !== undefined ? JSON.stringify(value) : ""}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value) as unknown);
          } catch {
            // ignore until valid JSON is typed
          }
        }}
      />
    );
  }

  if (field.kind === "enum" && field.enumValues) {
    const names = Object.keys(field.enumValues);
    return (
      <TextField
        fullWidth
        select
        size="small"
        label={field.name}
        value={(value as string | undefined) ?? names[0]}
        onChange={(e) => onChange(e.target.value)}
      >
        {names.map((name) => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (field.kind === "message" && field.nestedFields) {
    const nestedValue = (value as Record<string, unknown>) ?? {};
    return (
      <Box sx={{ pl: 2, borderLeft: 2, borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
          {field.name}
        </Typography>
        {field.nestedFields.map((nested) => (
          <PublishFormField
            key={nested.name}
            field={nested}
            value={nestedValue[nested.name]}
            onChange={(v) => onChange({ ...nestedValue, [nested.name]: v })}
          />
        ))}
      </Box>
    );
  }

  if (field.protoType === "bool") {
    return (
      <FormControlLabel
        control={<Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} />}
        label={field.name}
      />
    );
  }

  const isNumeric = NUMERIC_PROTO_TYPES.test(field.protoType);

  return (
    <TextField
      fullWidth
      size="small"
      label={field.name}
      type={isNumeric ? "number" : "text"}
      value={(value as string | number | undefined) ?? ""}
      onChange={(e) => onChange(isNumeric ? Number(e.target.value) : e.target.value)}
    />
  );
}
`;

  const publishFormEditorTsx = `import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import type { Type } from "protobufjs/light";
import { useFieldSchema } from "../../hooks/useFieldSchema";
import { encodeMessage } from "../../codec/codec";
import { PublishFormField } from "./PublishFormField";

export function PublishFormEditor(props: {
  type: Type;
  onChange: (bytes: Uint8Array | null, error: string | null) => void;
}): JSX.Element {
  const schema = useFieldSchema(props.type);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const { onChange, type } = props;

  useEffect(() => {
    try {
      const bytes = encodeMessage(type, values);
      onChange(bytes, null);
    } catch (err) {
      onChange(null, err instanceof Error ? err.message : "Invalid message");
    }
  }, [values, type, onChange]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {schema.map((field) => (
        <PublishFormField
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
        />
      ))}
    </Box>
  );
}
`;

  const publishRawEditorTsx = `import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import { hexToBytes, base64ToBytes } from "../../utils/bytes";

type Encoding = "hex" | "base64";

export function PublishRawEditor(props: {
  onChange: (bytes: Uint8Array | null, error: string | null) => void;
}): JSX.Element {
  const [encoding, setEncoding] = useState<Encoding>("hex");
  const [text, setText] = useState("");
  const { onChange } = props;

  useEffect(() => {
    if (!text.trim()) {
      onChange(null, null);
      return;
    }
    try {
      const bytes = encoding === "hex" ? hexToBytes(text) : base64ToBytes(text);
      onChange(bytes, null);
    } catch (err) {
      onChange(null, err instanceof Error ? err.message : "Invalid bytes");
    }
  }, [text, encoding, onChange]);

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
      <TextField
        fullWidth
        multiline
        minRows={4}
        placeholder={encoding === "hex" ? "deadbeef..." : "base64..."}
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ "& textarea": { fontFamily: "monospace" } }}
      />
    </Box>
  );
}
`;

  return [
    { path: 'src/components/publish/PublishPanel.tsx', content: publishPanelTsx },
    { path: 'src/components/publish/PublishJsonEditor.tsx', content: publishJsonEditorTsx },
    { path: 'src/components/publish/PublishFormField.tsx', content: publishFormFieldTsx },
    { path: 'src/components/publish/PublishFormEditor.tsx', content: publishFormEditorTsx },
    { path: 'src/components/publish/PublishRawEditor.tsx', content: publishRawEditorTsx },
  ];
}

module.exports = { buildPublishComponentFiles };
