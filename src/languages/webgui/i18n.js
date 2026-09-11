'use strict';

/**
 * Emits src/i18n/{index,en,uk}.ts. Both locale files are generated from ONE shared key list
 * (TRANSLATIONS below) rather than two independently hand-typed template strings, so the two
 * languages' key sets can't structurally drift apart as new UI strings are added.
 */
const TRANSLATIONS = {
  search: { en: 'Search…', uk: 'Пошук…' },
  connect: { en: 'Connect', uk: "Під'єднати" },
  connecting: { en: 'Connecting…', uk: "З'єднання…" },
  connectionFailed: { en: 'Could not connect — check host, port and protocol.', uk: "Не вдалося під'єднатися — перевірте хост, порт і протокол." },
  disconnect: { en: 'Disconnect', uk: "Від'єднати" },
  settings: { en: 'Settings', uk: 'Налаштування' },
  theme: { en: 'Theme', uk: 'Тема' },
  themeLight: { en: 'Light', uk: 'Світла' },
  themeDark: { en: 'Dark', uk: 'Темна' },
  themeSystem: { en: 'System', uk: 'Системна' },
  language: { en: 'Language', uk: 'Мова' },
  connections: { en: 'Connections', uk: "З'єднання" },
  addConnection: { en: 'Add connection', uk: "Додати з'єднання" },
  connectionName: { en: 'Name', uk: 'Назва' },
  protocol: { en: 'Protocol', uk: 'Протокол' },
  host: { en: 'Host', uk: 'Хост' },
  port: { en: 'Port', uk: 'Порт' },
  encryptionTls: { en: 'Encryption (TLS)', uk: 'Шифрування (TLS)' },
  validateCertificate: { en: 'Validate certificate', uk: 'Перевіряти сертифікат' },
  username: { en: 'Username', uk: "Ім'я користувача" },
  password: { en: 'Password', uk: 'Пароль' },
  clientId: { en: 'Client ID', uk: 'ID клієнта' },
  delete: { en: 'Delete', uk: 'Видалити' },
  advanced: { en: 'Advanced', uk: 'Додатково' },
  save: { en: 'Save', uk: 'Зберегти' },
  cancel: { en: 'Cancel', uk: 'Скасувати' },
  topic: { en: 'Topic', uk: 'Топік' },
  value: { en: 'Value', uk: 'Значення' },
  viewJson: { en: 'JSON', uk: 'JSON' },
  viewRaw: { en: 'Raw', uk: 'Сирі дані' },
  viewFields: { en: 'Fields', uk: 'Поля' },
  history: { en: 'History', uk: 'Історія' },
  comparingWithPrevious: { en: 'Comparing with previous message', uk: 'Порівняння з попереднім повідомленням' },
  publish: { en: 'Publish', uk: 'Опублікувати' },
  publishModeJson: { en: 'JSON', uk: 'JSON' },
  publishModeForm: { en: 'Form', uk: 'Форма' },
  publishModeRaw: { en: 'Raw protobuf', uk: 'Сирий protobuf' },
  retain: { en: 'Retain', uk: 'Зберігати (retain)' },
  qos: { en: 'QoS', uk: 'QoS' },
  noTopicSelected: { en: 'Select a topic from the tree to inspect it', uk: 'Оберіть топік у дереві, щоб переглянути його' },
  pauseUpdates: { en: 'Pause updates', uk: 'Призупинити оновлення' },
  resumeUpdates: { en: 'Resume updates', uk: 'Відновити оновлення' },
  autoExpand: { en: 'Auto expand', uk: 'Авторозгортання' },
  invalidJson: { en: 'Invalid JSON', uk: 'Некоректний JSON' },
  invalidMessage: { en: 'Message does not match the schema', uk: 'Повідомлення не відповідає схемі' },
  copy: { en: 'Copy', uk: 'Копіювати' },
  clear: { en: 'Clear', uk: 'Очистити' },
};

function localeFile(lang) {
  const entries = Object.entries(TRANSLATIONS)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value[lang])},`)
    .join('\n');
  return `// Generated from the shared TRANSLATIONS key list in src/languages/webgui/i18n.js — every
// key here also exists in the other locale file; keep additions in sync there.
const resources = {
${entries}
} as const;

export default resources;
`;
}

/**
 * @returns {Array<{ path: string, content: string }>}
 */
function buildI18nFiles() {
  const indexTs = `import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import uk from "./uk";

export type Language = "en" | "uk";

const STORAGE_KEY = "webgui.language";

function detectLanguage(): Language {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored === "en" || stored === "uk") return stored;
  const browserLanguage = typeof navigator !== "undefined" ? navigator.language : "en";
  return browserLanguage.startsWith("uk") ? "uk" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, lang);
}

export default i18n;
`;

  return [
    { path: 'src/i18n/index.ts', content: indexTs },
    { path: 'src/i18n/en.ts', content: localeFile('en') },
    { path: 'src/i18n/uk.ts', content: localeFile('uk') },
  ];
}

module.exports = { buildI18nFiles, TRANSLATIONS };
