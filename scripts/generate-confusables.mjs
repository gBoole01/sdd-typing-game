#!/usr/bin/env node
/**
 * Regenerates `packages/contracts/src/confusables.generated.ts` from the Unicode
 * TR39 confusables table (spec 001 § 4 *Username normalisation*).
 *
 * The table is restricted to sources in the Latin, Greek and Cyrillic scripts —
 * the set that matters for a Latin-script reserved list. It is generated, never
 * hand-edited: a hand-maintained homoglyph table drifts from Unicode silently,
 * and the failure mode is a reserved name that a homoglyph spelling walks past.
 *
 *   node scripts/generate-confusables.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://www.unicode.org/Public/security/latest/confusables.txt';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'contracts',
  'src',
  'confusables.generated.ts',
);

const IN_SCOPE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]$/u;

const text = await fetch(SOURCE_URL).then((response) => {
  if (!response.ok) throw new Error(`${SOURCE_URL} responded ${response.status}`);
  return response.text();
});

const codePoints = (field) =>
  field
    .trim()
    .split(/\s+/)
    .map((hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .join('');

const mappings = new Map();

for (const line of text.split('\n')) {
  const payload = line.split('#')[0].trim();
  if (payload.length === 0) continue;

  const [rawSource, rawTarget] = payload.split(';');
  if (!rawSource || !rawTarget) continue;

  const source = codePoints(rawSource);
  const target = codePoints(rawTarget);

  // One code point in, and only where the character is one this project's
  // usernames can contain at all.
  if ([...source].length !== 1 || !IN_SCOPE.test(source)) continue;
  if (source === target) continue;

  mappings.set(source, target);
}

const entries = [...mappings.entries()].sort(([a], [b]) =>
  a.codePointAt(0) - b.codePointAt(0),
);

const escape = (value) =>
  [...value]
    .map((character) => `\\u{${character.codePointAt(0).toString(16).toUpperCase()}}`)
    .join('');

const body = entries
  .map(([source, target]) => `  ['${escape(source)}', '${escape(target)}'],`)
  .join('\n');

writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit.
// Regenerate with: node scripts/generate-confusables.mjs
// Source: ${SOURCE_URL}
// Scope: sources in the Latin, Greek and Cyrillic scripts (spec 001 § 4).
// Entries: ${entries.length}

export const CONFUSABLES: ReadonlyMap<string, string> = new Map([
${body}
]);
`,
  'utf8',
);

console.log(`wrote ${entries.length} mappings to ${OUT}`);
