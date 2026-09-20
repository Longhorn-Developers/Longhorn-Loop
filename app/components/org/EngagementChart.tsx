// Weekly engagement chart for the Analytics tab (LOOP-183).
//
// Drawn directly with react-native-svg rather than pulling in a charting
// dependency: the design is a filled Views area with two comparison lines over
// a Mon–Sun axis with no interaction, which is far less code than configuring
// a chart library and avoids adding ~100kB to the bundle for one screen.
//
// The API returns only days that had activity, so the caller passes a dense
// Mon–Sun series — see buildWeeklySeries below.
//
// ---------------------------------------------------------------------------
// WHAT THE FIGMA FRAME SPECIFIES, AND WHAT THIS DOES INSTEAD.
//
// The frame draws a card titled "VIEWS THIS WEEK" with the week's total set
// large under it, "PEAK: FRI" in the top right, a y-axis labelled 0–1000, and
// ONE filled series. All of that is here — the summary header, the axis, the
// gridlines, the fill — with one deliberate difference: the Going and Saved
// polylines stay.
//
// They stay because the data behind them is already in the response and
// already load-bearing. The tab's whole question is "did views turn into
// RSVPs", and the per-event cards below answer it with a Conv.% that would
// have no visible workings if the chart showed views alone. So Views is the
// headline series and gets the fill and the summary, and the other two sit
// behind it as thin lines with a legend — the frame's hierarchy without
// throwing away two thirds of the numbers.

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';

const CHART_HEIGHT = 140;
const PADDING_Y = 12;

/**
 * Width reserved for the y-axis labels, in viewBox units.
 *
 * The labels are real <Text> outside the SVG rather than SvgText, so this is
 * left-padding on the plot area that the label column is absolutely positioned
 * over — keeping the numbers in the app's font instead of whatever the SVG
 * renderer picks per platform.
 */
const AXIS_WIDTH = 34;

export interface DayPoint {
  label: string;
  views: number;
  going: number;
  saved: number;
}

/** Raw rows from GET /orgs/:id/analytics — sparse, only days with activity. */
export interface WeeklyRow {
  day: string;
  views: number;
  going: number;
  saved: number;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Expand the sparse API rows into a dense Mon–Sun series ending today.
 *
 * A day with no engagement is a real zero, not a gap: without this the line
 * would connect Monday straight to Thursday and imply activity that never
 * happened.
 */
export function buildWeeklySeries(rows: WeeklyRow[], today = new Date()): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const points: DayPoint[] = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    // Match SQLite's date() output, which is UTC-based ISO yyyy-mm-dd.
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    points.push({
      label: DAY_LABELS[(date.getDay() + 6) % 7],
      views: row?.views ?? 0,
      going: row?.going ?? 0,
      saved: row?.saved ?? 0,
    });
  }

  return points;
}

/**
 * The frame's "VIEWS THIS WEEK / 2,440 / PEAK: FRI" header, derived rather
 * than fetched — the daily series already contains both numbers, and asking
 * the Worker for a total it can't compute more cheaply than this would be a
 * second query for arithmetic.
 *
 * Peak is null on an all-zero week: "PEAK: MON" on a week with no views at all
 * points at a day where nothing happened, which is worse than saying nothing.
 */
export function summarizeViews(data: DayPoint[]): { total: number; peakLabel: string | null } {
  const total = data.reduce((sum, d) => sum + d.views, 0);
  if (total === 0) return { total: 0, peakLabel: null };

  const peak = data.reduce((best, d) => (d.views > best.views ? d : best), data[0]);
  return { total, peakLabel: peak.label };
}

/**
 * A round-numbered ceiling for the axis, so the labels read 0/250/500/750/1000
 * rather than 0/153/306/459/612.
 *
 * Rounds the observed max up to the next 1/4-step of its own magnitude — 612
 * becomes 750, 2,440 becomes 2,500, 7 becomes 8. Without this the gridlines
 * carry three-significant-figure labels that nobody reads.
 */
export function axisCeiling(max: number): number {
  if (max <= 4) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const step = magnitude / 4;
  return Math.ceil(max / step) * step;
}

const makeSeries = (
  c: ThemeColors,
): { key: keyof Omit<DayPoint, 'label'>; color: string; label: string }[] => [
  { key: 'views', color: c.brand, label: 'Views' },
  { key: 'going', color: c.ink, label: 'Going' },
  { key: 'saved', color: c.border, label: 'Saved' },
];

/** Gridline / label count, including both 0 and the ceiling. */
const AXIS_TICKS = 5;

export default function EngagementChart({ data }: { data: DayPoint[] }) {
  const colors = useThemeColors();
  const SERIES = useMemo(() => makeSeries(colors), [colors]);

  const { total, peakLabel } = useMemo(() => summarizeViews(data), [data]);

  // Fixed viewBox width; the SVG scales to whatever the container is, so the
  // chart doesn't need to know its own pixel width.
  const width = 300;
  const plotWidth = width - AXIS_WIDTH;
  const step = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth;

  // One shared scale across all three series, so "Views" towering over "Saved"
  // stays visually true instead of each line being normalized to its own max.
  const max = Math.max(1, ...data.flatMap((d) => [d.views, d.going, d.saved]));
  const ceiling = axisCeiling(max);

  const toX = (index: number) => AXIS_WIDTH + index * step;
  const toY = (value: number) =>
    CHART_HEIGHT - PADDING_Y - (value / ceiling) * (CHART_HEIGHT - PADDING_Y * 2);

  // Ticks top-down, so tick[0] is the ceiling and sits at the top of the plot —
  // which is the order the absolutely-positioned label column needs.
  const ticks = useMemo(
    () =>
      Array.from(
        { length: AXIS_TICKS },
        (_, i) => (ceiling / (AXIS_TICKS - 1)) * (AXIS_TICKS - 1 - i),
      ),
    [ceiling],
  );

  if (data.length === 0) {
    return (
      <View className="h-[140px] items-center justify-center">
        <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
          No engagement yet.
        </Text>
      </View>
    );
  }

  // Close the Views polyline into a polygon along the baseline to get the
  // frame's fill. Built from the same toX/toY as the line so the two can't
  // drift apart.
  const baseline = CHART_HEIGHT - PADDING_Y;
  const viewsArea = [
    `${toX(0)},${baseline}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.views)}`),
    `${toX(data.length - 1)},${baseline}`,
  ].join(' ');

  return (
    <View>
      {/* --- Summary header --- */}
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="font-['Roboto-Flex'] text-[10px] font-semibold uppercase tracking-[0.7px] text-lhlSecondaryTextGrey">
            Views this week
          </Text>
          <Text className="font-['Roboto-Flex'] mt-[2px] text-[22px] font-semibold text-lhlInk">
            {total.toLocaleString()}
          </Text>
        </View>

        {peakLabel ? (
          <Text className="font-['Roboto-Flex'] text-[10px] font-semibold uppercase tracking-[0.7px] text-lhlSecondaryTextGrey">
            Peak: {peakLabel}
          </Text>
        ) : null}
      </View>

      <View className="mt-[10px]">
        <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`}>
          {/* Gridlines first, so every series paints over them. */}
          {ticks.map((value) => (
            <Line
              key={`grid-${value}`}
              x1={AXIS_WIDTH}
              x2={width}
              y1={toY(value)}
              y2={toY(value)}
              stroke={colors.divider}
              strokeWidth={0.6}
            />
          ))}

          <Polygon points={viewsArea} fill={colors.brand} fillOpacity={0.14} />

          {SERIES.map((series) => (
            <React.Fragment key={series.key}>
              <Polyline
                points={data.map((d, i) => `${toX(i)},${toY(d[series.key])}`).join(' ')}
                fill="none"
                stroke={series.color}
                // Views is the headline series; the other two are comparison
                // lines and shouldn't compete with it for weight.
                strokeWidth={series.key === 'views' ? 2.2 : 1.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((d, i) => (
                <Circle
                  key={`${series.key}-${i}`}
                  cx={toX(i)}
                  cy={toY(d[series.key])}
                  r={series.key === 'views' ? 2.6 : 1.8}
                  fill={series.color}
                />
              ))}
            </React.Fragment>
          ))}
        </Svg>

        {/* Y-axis labels, laid over the gutter the plot area leaves free.
            `pointerEvents="none"` matters: the column spans the chart's left
            edge and would otherwise swallow touches meant for the card. */}
        <View
          pointerEvents="none"
          className="absolute left-0 top-0"
          style={{ height: CHART_HEIGHT, width: `${(AXIS_WIDTH / width) * 100}%` }}
        >
          {ticks.map((value, i) => (
            <Text
              key={`label-${value}`}
              className="font-['Roboto-Flex'] absolute text-[9px] text-lhlSecondaryTextGrey"
              style={{
                // Half the ~11px line box, so the label centres on its line.
                top: PADDING_Y + (i * (CHART_HEIGHT - PADDING_Y * 2)) / (AXIS_TICKS - 1) - 5.5,
                right: 6,
              }}
            >
              {value >= 1000 ? `${value / 1000}k` : String(value)}
            </Text>
          ))}
        </View>
      </View>

      {/* Day axis, inset to clear the label gutter so each label sits under
          its own point rather than half a column to the left. */}
      <View
        className="mt-[4px] flex-row justify-between"
        style={{ paddingLeft: `${(AXIS_WIDTH / width) * 100}%` }}
      >
        {data.map((d, i) => (
          <Text
            key={`${d.label}-${i}`}
            className="font-['Roboto-Flex'] text-[10px] text-lhlSecondaryTextGrey"
          >
            {d.label}
          </Text>
        ))}
      </View>

      {/* Legend */}
      <View className="mt-[10px] flex-row justify-center gap-[16px]">
        {SERIES.map((series) => (
          <View key={series.key} className="flex-row items-center gap-[5px]">
            <View
              style={{ backgroundColor: series.color }}
              className="h-[8px] w-[8px] rounded-full"
            />
            <Text className="font-['Roboto-Flex'] text-[11px] text-lhlSecondaryTextGrey">
              {series.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
