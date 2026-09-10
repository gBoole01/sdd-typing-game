'use client';

import type { CaretStyle, Settings, TestMode, Theme } from '@typing-game/contracts';
import { useRef, useState } from 'react';

import { updateSettingsAction } from '@/app/(account)/actions';

/**
 * Spec 001 § 6 `/account/settings`. Saved per field on change, debounced, and
 * applied optimistically: these writes are small, idempotent, and a stale toggle
 * is a visible lie.
 *
 * The optimistic value is held in component state rather than `useOptimistic`.
 * `useOptimistic` scopes its value to the transition that set it, and the spec
 * also requires a 500 ms debounce — so the transition would end long before the
 * write began and the control would snap back while the user watched. The
 * observable contract, immediate apply and revert-on-failure, is unchanged.
 */

const DEBOUNCE_MS = 500;

const CARET_STYLES: Array<[CaretStyle, string]> = [
  ['OFF', 'Off'],
  ['BLOCK', 'Block'],
  ['UNDERLINE', 'Underline'],
  ['SMOOTH', 'Smooth'],
];

const THEMES: Array<[Theme, string]> = [
  ['SYSTEM', 'System'],
  ['LIGHT', 'Light'],
  ['DARK', 'Dark'],
];

const MODES: Array<[TestMode, string]> = [
  ['TIME', 'Time'],
  ['WORDS', 'Words'],
  ['QUOTE', 'Quote'],
];

const DURATIONS = [15, 30, 60, 120] as const;

export function SettingsForm({ settings }: { settings: Settings }): React.ReactElement {
  const [saved, setSaved] = useState(settings);
  const [values, setValues] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = useRef<Partial<Settings>>({});

  function change(update: Partial<Settings>): void {
    const next = { ...values, ...update };
    setValues(next);
    patch.current = { ...patch.current, ...update };

    // Rapid changes coalesce into one write; the last value wins.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), DEBOUNCE_MS);
  }

  async function save(next: Settings): Promise<void> {
    const pending = patch.current;
    patch.current = {};

    const result = await updateSettingsAction(pending);

    if (result && result.ok === false) {
      setValues(saved);
      setError("We couldn't save that change.");
      return;
    }

    setSaved(next);
    setError(null);
  }

  const radioGroup = <T extends string | number>(
    legend: string,
    name: string,
    options: Array<[T, string]>,
    selected: T,
    onSelect: (value: T) => void,
  ): React.ReactElement => (
    <fieldset>
      <legend>{legend}</legend>
      {options.map(([value, label]) => (
        <span key={String(value)}>
          <input
            id={`${name}-${value}`}
            type="radio"
            name={name}
            checked={selected === value}
            onChange={() => onSelect(value)}
          />
          <label htmlFor={`${name}-${value}`}>{label}</label>
        </span>
      ))}
    </fieldset>
  );

  return (
    <form aria-label="Typing preferences">
      {error ? <p role="alert">{error}</p> : null}

      {radioGroup('Caret style', 'caretStyle', CARET_STYLES, values.caretStyle, (caretStyle) =>
        change({ caretStyle }),
      )}

      {radioGroup('Theme', 'theme', THEMES, values.theme, (theme) => change({ theme }))}

      {radioGroup(
        'Default duration (seconds)',
        'defaultDuration',
        DURATIONS.map((value) => [value, String(value)] as [number, string]),
        values.defaultDuration,
        (defaultDuration) =>
          change({ defaultDuration: defaultDuration as Settings['defaultDuration'] }),
      )}

      {radioGroup('Default mode', 'defaultMode', MODES, values.defaultMode, (defaultMode) =>
        change({ defaultMode }),
      )}

      <input
        id="soundEnabled"
        type="checkbox"
        checked={values.soundEnabled}
        onChange={(event) => change({ soundEnabled: event.target.checked })}
      />
      <label htmlFor="soundEnabled">Sound</label>

      <input
        id="blindMode"
        type="checkbox"
        checked={values.blindMode}
        onChange={(event) => change({ blindMode: event.target.checked })}
      />
      <label htmlFor="blindMode">Blind mode</label>

      <input
        id="stopOnError"
        type="checkbox"
        checked={values.stopOnError}
        onChange={(event) => change({ stopOnError: event.target.checked })}
      />
      <label htmlFor="stopOnError">Stop on error</label>

      <label htmlFor="language">Language</label>
      <select
        id="language"
        value={values.language}
        onChange={(event) => change({ language: event.target.value })}
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="pt-BR">Português (Brasil)</option>
      </select>
    </form>
  );
}
