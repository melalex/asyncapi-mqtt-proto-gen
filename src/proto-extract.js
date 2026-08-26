'use strict';

/**
 * Pulls the `package` declaration and the top-level `message`/`enum` declarations out of a raw
 * proto3 schema text (as embedded verbatim in an AsyncAPI message's
 * `payload.schema`). This is a pragmatic brace-matching scanner, not a full proto grammar parser:
 * it is only expected to understand the well-formatted, single-package, no-`import` subset of
 * proto3 that AsyncAPI specs embed inline. Anything fancier (imports, options, nested packages
 * spread across the same schema block, block comments) is out of scope and will either be ignored
 * or cause a clear error rather than silently producing wrong output.
 *
 * @param {string} schemaText raw proto3 source, e.g. the value of `payload.schema`
 * @returns {{ package: string, declarations: Array<{ kind: 'message'|'enum', name: string, text: string }> }}
 */
function extractProtoDeclarations(schemaText) {
  const lines = String(schemaText).replace(/\r\n/g, '\n').split('\n');

  const packageMatch = schemaText.match(/^\s*package\s+([\w.]+)\s*;/m);
  if (!packageMatch) {
    throw new Error('proto schema is missing a "package X;" declaration');
  }
  const packageName = packageMatch[1];

  const declarations = [];
  let depth = 0;
  let current = null; // { kind, name, lines: string[] }
  let pendingComments = [];

  const countBraceDelta = (line) => {
    // Naive: doesn't account for braces inside string/comment content. Proto3 messages in
    // practice never put literal braces in field/enum names, so this holds for the supported subset.
    let delta = 0;
    for (const ch of line) {
      if (ch === '{') delta += 1;
      else if (ch === '}') delta -= 1;
    }
    return delta;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (depth === 0) {
      if (trimmed === '' || /^syntax\s*=/.test(trimmed) || /^package\s+/.test(trimmed)) {
        pendingComments = [];
        continue;
      }
      if (trimmed.startsWith('//')) {
        pendingComments.push(line);
        continue;
      }
      const declMatch = trimmed.match(/^(message|enum)\s+(\w+)\s*\{/);
      if (declMatch) {
        current = { kind: declMatch[1], name: declMatch[2], lines: [...pendingComments, line] };
        pendingComments = [];
        depth += countBraceDelta(line);
        if (depth === 0) {
          declarations.push({ kind: current.kind, name: current.name, text: current.lines.join('\n') });
          current = null;
        }
        continue;
      }
      // Unsupported top-level content (e.g. `import`, `option`). Ignore rather than fail hard,
      // since it doesn't stop us from extracting the message/enum declarations we do understand.
      pendingComments = [];
      continue;
    }

    // Inside a declaration body: just accumulate lines (including any nested message/enum) until
    // brace depth returns to 0.
    current.lines.push(line);
    depth += countBraceDelta(line);
    if (depth === 0) {
      declarations.push({ kind: current.kind, name: current.name, text: current.lines.join('\n') });
      current = null;
    }
  }

  if (depth !== 0 || current !== null) {
    throw new Error(`proto schema for package "${packageName}" has an unterminated message/enum block`);
  }

  return { package: packageName, declarations };
}

module.exports = { extractProtoDeclarations };
