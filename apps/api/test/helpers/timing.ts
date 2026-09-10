/**
 * Timing-equality assertions (spec 001 § 9, resolved Q19).
 *
 * 25 samples of each branch after 5 warm-ups, comparing **medians** within
 * 50 ms. Medians because CI scheduling produces outliers that would drag a
 * mean; 50 ms because it sits below the 50–150 ms Argon2 floor (§ 8) that a
 * real leak would show up as. A failure here under `--runInBand` is a genuine
 * enumeration oracle, not flake.
 */
export const TIMING_WARMUPS = 5;
export const TIMING_SAMPLES = 25;
export const TIMING_TOLERANCE_MS = 50;

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median() of an empty sample set');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * `beforeSample` is where the throttler is reset: every endpoint measured here
 * is rate-limited well below 30 requests, so without it the tail of each run
 * measures the 429 path rather than the branch under test.
 */
export async function sampleMedian(
  run: () => Promise<unknown>,
  options: { beforeSample?: () => Promise<void> } = {},
): Promise<number> {
  const durations: number[] = [];

  for (let attempt = 0; attempt < TIMING_WARMUPS + TIMING_SAMPLES; attempt += 1) {
    await options.beforeSample?.();

    const started = process.hrtime.bigint();
    await run();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    if (attempt >= TIMING_WARMUPS) durations.push(elapsedMs);
  }

  return median(durations);
}

export function expectComparableMedians(a: number, b: number, label: string): void {
  const difference = Math.abs(a - b);

  if (difference > TIMING_TOLERANCE_MS) {
    throw new Error(
      `${label}: medians differ by ${difference.toFixed(1)} ms, tolerance ${TIMING_TOLERANCE_MS} ms ` +
        `(${a.toFixed(1)} ms vs ${b.toFixed(1)} ms). This is a timing oracle, not flake.`,
    );
  }

  expect(difference).toBeLessThanOrEqual(TIMING_TOLERANCE_MS);
}
