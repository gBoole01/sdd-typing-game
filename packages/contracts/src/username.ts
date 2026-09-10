import { CONFUSABLES } from './confusables.generated';

/**
 * Spec 001 § 4 *Username normalisation*.
 *
 * | Stage   | Rule |
 * | Accept  | NFKC, then 3–20 code points each matching [\p{L}\p{N}_] |
 * | Script  | At most one script besides Common and Inherited |
 * | Store   | confusable-skeleton(casefold(NFKC(username))) |
 * | Compare | Uniqueness and the reserved list, both on the skeleton |
 */

/** § 7. Matched against the skeleton, so homoglyph spellings are caught too. */
export const RESERVED_USERNAMES = [
  'admin',
  'root',
  'api',
  'me',
  'settings',
  'login',
  'logout',
  'register',
  'null',
  'undefined',
  'support',
  'moderator',
  'anonymous',
  'guest',
] as const;

export type ReservedUsername = (typeof RESERVED_USERNAMES)[number];

export type UsernameCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'RESERVED'; normalized: string }
  | { ok: false; reason: 'INVALID_FORMAT' }
  | { ok: false; reason: 'MIXED_SCRIPT'; scripts: string[] };

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

const ALLOWED_CHARACTER = /^[\p{L}\p{N}_]$/u;

/**
 * Scripts a username may plausibly be written in. `Common` and `Inherited` are
 * deliberately absent: digits and `_` are Common, and treating them as a script
 * would make `nico_1` a mixed-script name.
 */
const SCRIPTS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Arabic',
  'Hebrew',
  'Armenian',
  'Georgian',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Tibetan',
  'Myanmar',
  'Khmer',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Ethiopic',
  'Cherokee',
  'Mongolian',
] as const;

const SCRIPT_MATCHERS: ReadonlyArray<readonly [string, RegExp]> = SCRIPTS.map((script) => [
  script,
  new RegExp(`\\p{Script=${script}}`, 'u'),
]);

const RESERVED_SKELETONS: ReadonlySet<string> = new Set(
  RESERVED_USERNAMES.map((reserved) => skeleton(reserved)),
);

/**
 * Applied once, not to a fixed point: the TR39 table maps confusable forms onto
 * prototypes, and the prototypes are not themselves keys.
 */
function skeleton(input: string): string {
  let mapped = '';
  for (const character of input) mapped += CONFUSABLES.get(character) ?? character;
  return mapped.normalize('NFKC');
}

export function usernameSkeleton(input: string): string {
  return skeleton(input.normalize('NFKC').toLowerCase());
}

/** Every script present besides Common and Inherited, in a stable order. */
export function detectScripts(input: string): string[] {
  const present: string[] = [];

  for (const character of input) {
    for (const [script, matcher] of SCRIPT_MATCHERS) {
      if (matcher.test(character) && !present.includes(script)) present.push(script);
    }
  }

  return present;
}

/**
 * Order matters and is load-bearing. The reserved list is consulted **first**,
 * on the skeleton, so `аdmin` spelled with a Cyrillic `а` is 409 RESERVED rather
 * than a 400 for mixed script (§ 4, and § 9's test table), and so `me` — which
 * is shorter than the minimum — is reserved rather than malformed (§ 7).
 */
export function checkUsername(input: string): UsernameCheck {
  const normalized = usernameSkeleton(input);

  if (RESERVED_SKELETONS.has(normalized)) {
    return { ok: false, reason: 'RESERVED', normalized };
  }

  const canonical = input.normalize('NFKC');
  const characters = [...canonical];

  if (
    characters.length < USERNAME_MIN_LENGTH ||
    characters.length > USERNAME_MAX_LENGTH ||
    !characters.every((character) => ALLOWED_CHARACTER.test(character))
  ) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }

  const scripts = detectScripts(canonical);
  if (scripts.length > 1) {
    return { ok: false, reason: 'MIXED_SCRIPT', scripts };
  }

  return { ok: true, normalized };
}

/** "looks like Latin and Cyrillic mixed" is actionable; "invalid" is not (§ 4). */
export function describeMixedScript(scripts: readonly string[]): string {
  return `Looks like ${scripts.join(' and ')} mixed in one username. Use a single script.`;
}
