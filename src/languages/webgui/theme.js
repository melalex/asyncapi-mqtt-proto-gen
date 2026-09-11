'use strict';

/**
 * Emits src/theme.ts: MUI light/dark theme tokens. Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildThemeFiles() {
  const content = `import { createTheme, type Theme } from "@mui/material/styles";

export type ThemeMode = "light" | "dark";

export function createAppTheme(mode: ThemeMode): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === "dark" ? "#4fc3f7" : "#1565c0" },
      background:
        mode === "dark" ? { default: "#121212", paper: "#1e1e1e" } : { default: "#f5f5f5", paper: "#ffffff" },
    },
    shape: { borderRadius: 6 },
  });
}
`;

  return [{ path: 'src/theme.ts', content }];
}

module.exports = { buildThemeFiles };
