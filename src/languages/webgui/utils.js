'use strict';

/**
 * Emits src/utils/bytes.ts (hex/base64 <-> Uint8Array, for the raw view/publish editor) and
 * src/utils/format.ts (small display helpers). Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildUtilFiles() {
  const bytesTs = `/** Hex/base64 <-> Uint8Array conversions for the raw message view and raw-bytes publish mode. */

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\\s+/g, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
`;

  const formatTs = `/** Small display helpers shared by the message/history views. */

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}
`;

  return [
    { path: 'src/utils/bytes.ts', content: bytesTs },
    { path: 'src/utils/format.ts', content: formatTs },
  ];
}

module.exports = { buildUtilFiles };
