'use strict';

/**
 * Emits src/diff/textDiff.ts: a thin wrapper over jsdiff's diffLines, producing the red/green
 * line-diff data the Value section renders between a topic's current and previous decoded
 * message. Static — independent of the spec.
 *
 * @returns {Array<{ path: string, content: string }>}
 */
function buildDiffFiles() {
  const content = `import { diffLines, type Change } from "diff";

export interface DiffLine {
  text: string;
  type: "added" | "removed" | "unchanged";
}

export interface DiffSummary {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Line-level diff between two decoded-message JSON strings, for the Value section's diff view. */
export function diffJsonText(previous: string | undefined, current: string): DiffSummary {
  const changes: Change[] = diffLines(previous ?? "", current);
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    const type = change.added ? "added" : change.removed ? "removed" : "unchanged";
    if (change.added) added += change.count ?? 0;
    if (change.removed) removed += change.count ?? 0;

    const segments = change.value.split("\\n");
    // diffLines keeps the trailing newline on each changed block, which produces one spurious
    // trailing empty segment per change — drop it rather than rendering a blank diff row.
    if (segments[segments.length - 1] === "" && change.value.endsWith("\\n")) segments.pop();
    for (const text of segments) lines.push({ text, type });
  }

  return { lines, added, removed };
}
`;

  return [{ path: 'src/diff/textDiff.ts', content }];
}

module.exports = { buildDiffFiles };
