'use strict';

/**
 * Emits src/main.tsx, src/App.tsx, src/vite-env.d.ts, and index.html — the app's entry point and
 * provider wiring (theme, i18n, connection, topic store).
 *
 * @param {{ specTitle: string }} ctx
 * @returns {Array<{ path: string, content: string }>}
 */
function buildAppShellFiles(ctx) {
  const mainTsx = `import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error('#root element not found');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

  const appTsx = `import { useMemo } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SettingsProvider, useSettings } from "./state/SettingsContext";
import { ConnectionProvider } from "./state/ConnectionContext";
import { TopicStoreProvider } from "./state/TopicStore";
import { createAppTheme } from "./theme";
import { AppShell } from "./components/layout/AppShell";

function ThemedApp(): JSX.Element {
  const { resolvedThemeMode } = useSettings();
  const theme = useMemo(() => createAppTheme(resolvedThemeMode), [resolvedThemeMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ConnectionProvider>
        <TopicStoreProvider>
          <AppShell />
        </TopicStoreProvider>
      </ConnectionProvider>
    </ThemeProvider>
  );
}

export default function App(): JSX.Element {
  return (
    <SettingsProvider>
      <ThemedApp />
    </SettingsProvider>
  );
}
`;

  const viteEnvDts = `/// <reference types="vite/client" />
`;

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ctx.specTitle} — MQTT Explorer</title>
    <!-- Emoji favicon as an inline SVG data URI — no binary asset pipeline needed for a generated
         project. Swap the emoji below for something else if you'd like a different icon. -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📡</text></svg>" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

  return [
    { path: 'src/main.tsx', content: mainTsx },
    { path: 'src/App.tsx', content: appTsx },
    { path: 'src/vite-env.d.ts', content: viteEnvDts },
    { path: 'index.html', content: indexHtml },
  ];
}

module.exports = { buildAppShellFiles };
