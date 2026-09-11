'use strict';

/**
 * Emits src/components/settings/SettingsPanel.tsx — replaces the topic tree in the left panel
 * (same panel, toggled by the top bar's hamburger icon, mirroring the MQTT Explorer reference).
 * Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildSettingsComponentFiles() {
  const content = `import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../state/SettingsContext";
import type { Language } from "../../i18n";
import type { ThemeModePreference } from "../../state/SettingsContext";

export function SettingsPanel(): JSX.Element {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, language, setLanguagePref, autoExpand, setAutoExpand } = useSettings();

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="subtitle1">{t("settings")}</Typography>

      <Box>
        <Typography variant="body2" gutterBottom>
          {t("theme")}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={themeMode}
          onChange={(_, value: ThemeModePreference | null) => value && setThemeMode(value)}
        >
          <ToggleButton value="light">{t("themeLight")}</ToggleButton>
          <ToggleButton value="dark">{t("themeDark")}</ToggleButton>
          <ToggleButton value="system">{t("themeSystem")}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box>
        <Typography variant="body2" gutterBottom>
          {t("language")}
        </Typography>
        <Select size="small" value={language} onChange={(e) => setLanguagePref(e.target.value as Language)}>
          <MenuItem value="en">English</MenuItem>
          <MenuItem value="uk">Українська</MenuItem>
        </Select>
      </Box>

      <FormControlLabel
        control={<Switch checked={autoExpand} onChange={(e) => setAutoExpand(e.target.checked)} />}
        label={t("autoExpand")}
      />
    </Box>
  );
}
`;

  return [{ path: 'src/components/settings/SettingsPanel.tsx', content }];
}

module.exports = { buildSettingsComponentFiles };
