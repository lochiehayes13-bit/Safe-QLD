import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { assetTimeline, getAsset, type AssetEvent, type AssetRecord } from '@/db/assetRepo';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import {
  MINIMUM_POINTS,
  formatAuDate,
  formatRate,
  instantOf,
  parseMeasurement,
  projectToThreshold,
  seriesFromEvents,
  trendHeadline,
  trendMeasurements,
  type Intervention,
  type MeasurementPoint,
  type MeasurementSeries,
  type MeasurementTrend,
  type Provenance,
  type ThresholdProjection,
} from '@/domain/measurementTrend';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Divider, EmptyState, Field, H2, Label, ResultBlock, Rowed, Screen, StatTile, Txt,
} from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';
import { ContextGate } from '@/components/ContextGate';
import { describeLoadFailure } from '@/domain/loadFailure';
import { contextId } from '@/domain/screenContext';

/**
 * One asset's measurements over its whole life.
 *
 * The timeline screen already shows what happened at each service. This shows
 * what has been happening across them, which is the question a single reading
 * cannot answer: the hydrant that passes every year at a pressure fifteen per
 * cent lower than it started at is the one worth a conversation before it
 * fails.
 *
 * Everything the trend is unsure about is on the screen rather than behind it.
 * A rate with no caveats reads as a fact, and a projected date reads as a
 * booking, so the caveats sit next to the number and the projection is drawn
 * as a range with its assumption printed underneath.
 */

/** The units this app's own routines record each measurement in. */
const ROUTINE_UNITS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const routine of SERVICE_ROUTINES) {
    for (const test of routine.tests) {
      // "kPa or kg" is not a unit — it is a key that holds two quantities, and
      // filling it in would be the app inventing which one was measured.
      if (!test.measurementKey || !test.measurementUnit || / or /.test(test.measurementUnit)) continue;
      out[test.measurementKey] = test.measurementUnit;
    }
  }
  return out;
})();

/**
 * Timeline entries that change what the asset is, rather than record it.
 *
 * "isolated" belongs here above all the others: a valve shut for tenancy works
 * is the textbook explanation for a step in a hydrant's pressure, and leaving
 * it out has the app report "no recorded cause" for a cause sitting on the
 * timeline two rows up.
 */
const INTERVENTION_KINDS = new Set([
  'replaced', 'repaired', 'cleaned', 'moved', 'isolated', 'restored', 'installed',
]);

export default function MeasurementTrendScreen() {
  const t = useTheme();
  const { id: idParam, key: keyParam } = useLocalSearchParams<{ id?: string; key?: string }>();
  /*
   * This screen is reached from an asset, and it is also in the manifest by
   * name — so search and a stale link both open it with no asset at all. It
   * used to return out of its loader before setting either flag, which left
   * the gate below on "Loading…" for the rest of the session.
   */
  const id = contextId(idParam);
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [selected, setSelected] = useState<string | undefined>(keyParam);
  const [thresholdText, setThresholdText] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const a = await getAsset(id);
      setAsset(a);
      setMissing(!a);
      setEvents(a ? await assetTimeline(a.id, 500) : []);
    } catch (e) {
      setFailed(describeLoadFailure(e, 'this asset'));
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const built = useMemo(
    () => seriesFromEvents(id ?? '', events, { assetName: asset?.name, units: ROUTINE_UNITS }),
    [id, events, asset?.name],
  );

  const interventions: Intervention[] = useMemo(
    () => events
      .filter((e) => INTERVENTION_KINDS.has(e.kind))
      .map((e) => ({ at: e.occurredAt, what: e.summary })),
    [events],
  );

  const series: MeasurementSeries | undefined =
    built.series.find((s) => s.key === selected) ?? built.series[0];

  const trend = useMemo(
    () => (series ? trendMeasurements(series, { interventions }) : undefined),
    [series, interventions],
  );

  /**
   * The pass value, read with the same parser as the readings themselves.
   *
   * Stripping a comma and calling parseFloat turns "1,2" into 12 and "3.5.5"
   * into 3.5 without a word. This screen's whole argument is that a number
   * nobody can read is refused rather than guessed at, and the threshold — the
   * one number a projected date is measured against — cannot be the exception.
   */
  const thresholdParse = useMemo(
    () => (thresholdText.trim() ? parseMeasurement(thresholdText) : undefined),
    [thresholdText],
  );
  const thresholdValue = thresholdParse?.ok ? thresholdParse.value : undefined;
  // A unit typed with the value wins: "3.5 bar" against kPa readings is a
  // conversion the module can do, and is not the technician's mistake.
  const thresholdUnit = thresholdParse?.ok ? thresholdParse.unit ?? trend?.unit : undefined;

  const projection: ThresholdProjection | undefined = useMemo(
    () => (trend && thresholdValue !== undefined
      ? projectToThreshold(trend, { value: thresholdValue, unit: thresholdUnit })
      : undefined),
    [trend, thresholdValue, thresholdUnit],
  );

  if (!id) return <ContextGate kind="asset" what="every measurement recorded" title="Measurement trend" />;

  if (!asset) {
    return (
      <>
        <Stack.Screen options={{ title: 'Measurement trend' }} />
        <RecordGate missing={missing} what="asset" failed={failed} onRetry={() => { void load(); }} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Measurement trend' }} />
      <Screen>
        <View>
          <Txt size="xl" weight="700">{asset.name}</Txt>
          <Txt size="sm" tone="muted">
            {[asset.code, asset.level, asset.room].filter(Boolean).join(' · ') || 'Measurement history'}
          </Txt>
        </View>

        {!built.series.length ? (
          <EmptyState
            title="No measurements recorded"
            body={
              'Nothing on this asset’s timeline carries a number. Trends are built from the values '
              + 'routines record — pressures, voltages, durations — so this fills in as the asset is '
              + 'serviced.'
            }
          />
        ) : (
          <>
            <View style={{ gap: t.space(1.5) }}>
              <Label>Measurement</Label>
              <Rowed gap={2} wrap>
                {built.series.map((s) => (
                  <Chip
                    key={s.key}
                    label={`${s.key} (${s.points.length})`}
                    selected={s.key === series?.key}
                    onPress={() => setSelected(s.key)}
                  />
                ))}
              </Rowed>
            </View>

            {trend && series ? (
              <TrendBody
                trend={trend}
                series={series}
                projection={projection}
                thresholdText={thresholdText}
                thresholdError={thresholdParse && !thresholdParse.ok ? thresholdParse.reason : undefined}
                onThresholdChange={setThresholdText}
              />
            ) : null}
          </>
        )}

        {built.rejected.length ? (
          <Card>
            <Label>Readings left out</Label>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: t.space(1) }}>
              These were recorded against this asset but could not be turned into a number. They are
              listed rather than dropped, because a series quietly missing its awkward readings
              trends beautifully and means nothing.
            </Txt>
            <View style={{ gap: t.space(1), marginTop: t.space(2) }}>
              {built.rejected.map((r, i) => (
                <Txt key={`${r.key}-${r.at}-${i}`} size="sm">
                  <Txt size="sm" mono tone="accent">{formatAuDate(r.at)}</Txt>
                  {`  ${r.key}: ${r.reason}`}
                </Txt>
              ))}
            </View>
          </Card>
        ) : null}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function TrendBody({
  trend,
  series,
  projection,
  thresholdText,
  thresholdError,
  onThresholdChange,
}: {
  trend: MeasurementTrend;
  series: MeasurementSeries;
  projection?: ThresholdProjection;
  thresholdText: string;
  thresholdError?: string;
  onThresholdChange: (v: string) => void;
}) {
  const points = trend.status === 'trend' ? trend.used : series.points;

  /**
   * What may be drawn as one line.
   *
   * On a refusal the readings have not been normalised, so a series refused
   * for mixed units still holds the volts and the kilopascals that got it
   * refused. Drawn together they make a shape, and a shape is read as a trend
   * by anyone who does not stop to check the axis — which is exactly what the
   * refusal was for. The reading list below prints each with its own unit
   * instead.
   */
  const chartable = trend.status === 'trend'
    ? trend.used
    : new Set(series.points.map((p) => p.unit ?? '')).size <= 1 ? series.points : [];

  // In the trend's own unit, whatever unit it was typed in: the module hands
  // back the converted figure, so the rule sits where the readings are.
  const chartThreshold = projection && trend.unit !== undefined && projection.unit === trend.unit
    ? projection.threshold
    : undefined;

  const tone = trend.interpretation === 'deteriorating'
    ? 'fail'
    : trend.interpretation === 'improving' ? 'pass' : 'accent';

  return (
    <>
      {trend.status === 'trend' ? (
        <ResultBlock
          label={series.key}
          value={trend.direction === 'flat' ? 'Steady' : formatRate(trend.ratePerYear ?? 0, trend.unit)}
          tone={tone}
          detail={trendHeadline(trend)}
        />
      ) : (
        <Banner
          tone="warn"
          title={
            trend.status === 'insufficient'
              ? `Not enough readings to trend (${trend.used.length} of ${MINIMUM_POINTS})`
              : 'No trend from these readings'
          }
          body={trend.refusal}
        />
      )}

      {chartable.length >= 2 ? (
        <Sparkline points={chartable} threshold={chartThreshold} stepAt={trend.step?.to.at} />
      ) : series.points.length >= 2 ? (
        <Banner
          tone="info"
          title="These readings are not drawn as a line"
          body={
            'They are not all in one unit, so a single line through them would make a shape out '
            + 'of two different measurements. They are listed below exactly as they were recorded.'
          }
        />
      ) : null}

      {trend.status === 'trend' ? (
        <Rowed gap={2}>
          <StatTile label="First" value={`${round(trend.first?.value)}${unitSuffix(trend.unit)}`} />
          <StatTile label="Latest" value={`${round(trend.last?.value)}${unitSuffix(trend.unit)}`} />
          <StatTile
            label="Change"
            value={trend.changePercent === undefined ? '—' : `${trend.changePercent > 0 ? '+' : ''}${trend.changePercent.toFixed(1)}%`}
            tone={trend.interpretation === 'deteriorating' ? 'fail' : 'default'}
          />
        </Rowed>
      ) : null}

      {trend.status === 'trend' ? (
        <Rowed gap={2} wrap>
          <Chip label={`${trend.used.length} readings`} />
          <Chip label={`${Math.round((trend.spanDays ?? 0) / 30.4)} months`} />
          <Chip
            label={`${trend.confidence} confidence`}
            tone={trend.confidence === 'high' ? 'pass' : trend.confidence === 'medium' ? 'warn' : 'fail'}
          />
          {trend.shape ? <Chip label={SHAPE_LABEL[trend.shape] ?? trend.shape} tone={trend.shape === 'drift' ? 'default' : 'warn'} /> : null}
          {trend.significant === false ? <Chip label="not statistically clear" tone="warn" /> : null}
        </Rowed>
      ) : null}

      {trend.step ? (
        <Banner
          tone={trend.step.explanation ? 'info' : 'warn'}
          title={
            trend.step.distinguishable
              ? `Step change on ${formatAuDate(trend.step.to.at)}, not a gradual decline`
              : `Large change across a ${trend.step.days}-day gap`
          }
          body={trend.step.message}
        />
      ) : null}

      {trend.cautions
        .filter((c) => c.code !== 'confounded')
        .map((c, i) => (
          <Banner key={`${c.code}-${i}`} tone={c.code === 'seasonal' ? 'warn' : 'info'} title={CAUTION_TITLE[c.code] ?? 'Caution'} body={c.message} />
        ))}

      <Divider />

      <H2>When does it cross a threshold?</H2>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
        Enter the pass value this asset is measured against — the design duty off the block plan,
        the manufacturer&apos;s minimum, whatever the office holds. Nothing is assumed: no threshold
        ships in this app.
      </Txt>
      <Field
        label={`Threshold${trend.unit ? ` (${trend.unit})` : ''}`}
        value={thresholdText}
        onChangeText={onThresholdChange}
        keyboardType="decimal-pad"
        placeholder="e.g. 350"
        suffix={trend.unit}
        hint={
          thresholdError
            ? `That is not a value this app can read: ${thresholdError.replace(/\.$/, '')}.`
            : trend.unit
              ? undefined
              : 'These readings carry no unit, so a threshold cannot be compared with them.'
        }
      />

      {projection ? <ProjectionCard projection={projection} /> : null}

      <Divider />

      <H2>Readings</H2>
      <Card>
        {points.map((p, i) => (
          <View key={`${p.at}-${i}`}>
            {i ? <Divider /> : null}
            <Rowed gap={3} align="baseline">
              <Txt size="sm" mono tone="accent" style={{ width: 84 }}>{formatAuDate(p.at)}</Txt>
              <Txt size="md" weight="700">{round(p.value)}{unitSuffix(p.unit ?? trend.unit)}</Txt>
              {p.technician ? <Txt size="xs" tone="faint">{p.technician}</Txt> : null}
            </Rowed>
          </View>
        ))}
      </Card>

      <Sources cautions={trend.cautions} />
    </>
  );
}

const SHAPE_LABEL: Record<string, string> = {
  drift: 'gradual drift',
  step: 'step change',
  unclear: 'not a clear pattern',
};

const CAUTION_TITLE: Record<string, string> = {
  seasonal: 'This may be a season, not a trend',
  sparse: 'Fitted from very few readings',
  scatter: 'The readings scatter',
  step: 'A step change is present',
  'step-in-gap': 'A step and a decline cannot be separated here',
  'no-variation': 'Every reading is identical',
  'unit-unstated': 'A unit is missing',
  'unit-converted': 'Units were converted',
  'same-day-readings': 'More than one reading on a day',
  'perfect-fit': 'The readings sit exactly on a line',
  'excluded-readings': 'Some readings were left out',
  'unknown-key': 'This measurement is not one the app knows',
};

function ProjectionCard({ projection }: { projection: ThresholdProjection }) {
  const t = useTheme();
  const tone = projection.status === 'crossed'
    ? 'fail'
    : projection.status === 'projected' ? 'warn' : 'accent';

  return (
    <Card>
      <Label>{projection.kind === 'minimum' ? 'Falls below' : 'Rises above'} {projection.threshold}{unitSuffix(projection.unit)}</Label>
      <Txt size="lg" weight="700" tone={tone} style={{ marginTop: t.space(1) }}>
        {projection.label}
      </Txt>
      {projection.yearsEarliest !== undefined ? (
        <Txt size="sm" tone="muted" style={{ marginTop: 2 }}>
          {projection.yearsLatest !== undefined
            ? `${projection.yearsEarliest} to ${projection.yearsLatest} years away`
            : `at least ${projection.yearsEarliest} years away`}
          {` · from ${projection.basedOn} readings`}
        </Txt>
      ) : null}
      {projection.reason ? (
        <Txt size="sm" style={{ marginTop: t.space(2), lineHeight: 19 }}>{projection.reason}</Txt>
      ) : null}
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(3), lineHeight: 19 }}>
        {projection.assumption}
      </Txt>
      {projection.cautions.map((c, i) => (
        <Txt key={i} size="sm" tone="warn" style={{ marginTop: t.space(2), lineHeight: 19 }}>{c.message}</Txt>
      ))}
    </Card>
  );
}

/**
 * Where the cautions come from.
 *
 * A technician standing in front of a client saying "the pressure is down
 * because the street is busier in summer" needs to be able to say who says so.
 */
function Sources({ cautions }: { cautions: MeasurementTrend['cautions'] }) {
  const t = useTheme();
  const seen = new Set<string>();
  const sources: Provenance[] = [];
  for (const c of cautions) {
    if (!c.provenance || seen.has(c.provenance.source)) continue;
    seen.add(c.provenance.source);
    sources.push(c.provenance);
  }
  if (!sources.length) return null;

  return (
    <>
      <H2>What else moves this number</H2>
      <Card>
        {sources.map((s, i) => (
          <View key={s.source}>
            {i ? <Divider /> : null}
            <Txt size="sm" style={{ lineHeight: 19 }}>{s.fact}</Txt>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
              {s.source} · {s.confidence} confidence{s.url ? `\n${s.url}` : ''}
            </Txt>
          </View>
        ))}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

const CHART_HEIGHT = 140;

/**
 * The history as a line.
 *
 * Drawn here rather than pulled from a chart library: the whole picture is a
 * polyline, a threshold rule and a dot per service, and a dependency would cost
 * more than it saves. The vertical axis deliberately does not start at zero —
 * a 5% fall in residual pressure is invisible against a zero baseline, and it
 * is exactly what this screen exists to show — so the range is printed beside
 * it and the shape is never presented on its own.
 */
function Sparkline({
  points,
  threshold,
  stepAt,
}: {
  points: MeasurementPoint[];
  threshold?: number;
  stepAt?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);

  const times = points.map((p) => instantOf(p.at));
  const usable = points.filter((_, i) => times[i] !== undefined);
  if (usable.length < 2 || width <= 0) {
    return <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }} />;
  }

  const xs = usable.map((p) => instantOf(p.at)!);
  const ys = usable.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const values = threshold !== undefined ? [...ys, threshold] : ys;
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const padY = (maxY - minY) * 0.12 || Math.abs(maxY * 0.05) || 1;

  const left = 8;
  const right = width - 8;
  const top = 10;
  const bottom = CHART_HEIGHT - 10;

  const px = (x: number) => (maxX === minX ? left : left + ((x - minX) / (maxX - minX)) * (right - left));
  const py = (y: number) => {
    const lo = minY - padY;
    const hi = maxY + padY;
    return hi === lo ? (top + bottom) / 2 : bottom - ((y - lo) / (hi - lo)) * (bottom - top);
  };

  const stepMs = instantOf(stepAt ?? '');

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: t.space(1) }}>
      <Svg width={width} height={CHART_HEIGHT}>
        {threshold !== undefined ? (
          <Line
            x1={left}
            y1={py(threshold)}
            x2={right}
            y2={py(threshold)}
            stroke={t.color.fail}
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        ) : null}
        <Polyline
          points={usable.map((p, i) => `${px(xs[i]!)},${py(p.value)}`).join(' ')}
          fill="none"
          stroke={t.color.accent}
          strokeWidth={2}
        />
        {usable.map((p, i) => (
          <Circle
            key={`${p.at}-${i}`}
            cx={px(xs[i]!)}
            cy={py(p.value)}
            r={stepMs !== undefined && xs[i] === stepMs ? 6 : 4}
            fill={stepMs !== undefined && xs[i] === stepMs ? t.color.warn : t.color.accent}
          />
        ))}
      </Svg>
      <Rowed gap={2}>
        <Txt size="xs" tone="faint">{formatAuDate(usable[0]!.at)}</Txt>
        <Txt size="xs" tone="faint" style={{ flex: 1, textAlign: 'center' }}>
          {`${round(minY)} to ${round(maxY)}${unitSuffix(usable[0]!.unit)} — the scale does not start at zero`}
        </Txt>
        <Txt size="xs" tone="faint">{formatAuDate(usable[usable.length - 1]!.at)}</Txt>
      </Rowed>
    </View>
  );
}

const unitSuffix = (unit?: string): string => (unit ? ` ${unit}` : '');

function round(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  return value.toFixed(magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2);
}
