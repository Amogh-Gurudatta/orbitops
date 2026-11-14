// Builds the "historical vs live" series for the satellite study chart: rollup history (average and
// min/max band), the 24 h baseline resampled onto the same time axis, and the live tail from the
// socket appended after the last history bucket.

/** Linear interpolation of (srcT, srcV) at each targetT; null outside the source span or across gaps. */
export function resampleLinear(
  srcT: readonly number[],
  srcV: readonly (number | null)[],
  targetT: readonly number[],
): (number | null)[] {
  const out: (number | null)[] = [];
  let j = 0;
  for (const t of targetT) {
    if (srcT.length === 0 || t < srcT[0]! || t > srcT[srcT.length - 1]!) {
      out.push(null);
      continue;
    }
    while (j < srcT.length - 2 && srcT[j + 1]! < t) j++;
    const t0 = srcT[j]!;
    const t1 = srcT[Math.min(j + 1, srcT.length - 1)]!;
    const v0 = srcV[j] ?? null;
    const v1 = srcV[Math.min(j + 1, srcT.length - 1)] ?? null;
    if (t === t0) out.push(v0);
    else if (t === t1) out.push(v1);
    else if (v0 === null || v1 === null) out.push(null);
    else out.push(v0 + ((v1 - v0) * (t - t0)) / (t1 - t0));
  }
  return out;
}

export interface StudyInputs {
  /** History: epoch ms with aligned value arrays (raw units). */
  histT: readonly number[];
  avg: readonly (number | null)[];
  min: readonly (number | null)[];
  max: readonly (number | null)[];
  /** Baseline (epoch ms, already shifted onto the requested range) and its average. */
  baseT: readonly number[];
  baseAvg: readonly (number | null)[];
  /** Live tail: epoch seconds with NaN-gapped values. */
  liveT: ArrayLike<number>;
  liveV: ArrayLike<number>;
  /** Multiplier to display units (batSoc 0..1 -> %). */
  scale: number;
  /** Minimum spacing kept between live points, seconds (thins 10 Hz data for a long x-axis). */
  liveSpacingS: number;
  /** Live points inside the last history bucket are already represented by it, seconds. */
  bucketS: number;
}

export interface StudySeries {
  /** Epoch seconds. */
  t: number[];
  /** AVG, BASELINE, MIN, MAX - the order the StripChart styles them (grey / dashed / dotted). */
  series: (number | null)[][];
}

const scaled = (values: readonly (number | null)[], scale: number) =>
  values.map((v) => (v === null ? null : v * scale));

export function composeStudySeries(input: StudyInputs): StudySeries {
  const { scale } = input;
  const t = input.histT.map((ms) => ms / 1000);
  const avg = scaled(input.avg, scale);
  const min = scaled(input.min, scale);
  const max = scaled(input.max, scale);

  // Live points are kept from the end of the last history bucket on, thinned to `liveSpacingS`.
  let nextAllowed = (t.at(-1) ?? -Infinity) + input.bucketS;
  for (let i = 0; i < input.liveT.length; i++) {
    const lt = input.liveT[i]!;
    const lv = input.liveV[i]!;
    if (Number.isNaN(lv) || lt < nextAllowed) continue;
    t.push(lt);
    avg.push(lv * scale);
    min.push(null);
    max.push(null);
    nextAllowed = lt + input.liveSpacingS;
  }

  const baseline = resampleLinear(
    input.baseT.map((ms) => ms / 1000),
    scaled(input.baseAvg, scale),
    t,
  );
  return { t, series: [avg, baseline, min, max] };
}
