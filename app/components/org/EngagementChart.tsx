// Weekly engagement line chart for the Analytics tab (LOOP-183).
//
// Drawn directly with react-native-svg rather than pulling in a charting
// dependency: the design is three smooth polylines over a Mon–Sun axis with no
// interaction, which is far less code than configuring a chart library and
// avoids adding ~100kB to the bundle for one screen.
//
// The API returns only days that had activity, so the caller passes a dense
// Mon–Sun series — see buildWeeklySeries below.

import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

const CHART_HEIGHT = 140;
const PADDING_Y = 12;

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

const makeSeries = (
  c: ThemeColors,
): { key: keyof Omit<DayPoint, 'label'>; color: string; label: string }[] => [
  { key: 'views', color: c.brand, label: 'Views' },
  { key: 'going', color: c.ink, label: 'Going' },
  { key: 'saved', color: c.border, label: 'Saved' },
];

export default function EngagementChart({ data }: { data: DayPoint[] }) {
  const colors = useThemeColors();
  const SERIES = useMemo(() => makeSeries(colors), [colors]);

  // Fixed viewBox width; the SVG scales to whatever the container is, so the
  // chart doesn't need to know its own pixel width.
  const width = 300;
  const step = data.length > 1 ? width / (data.length - 1) : width;

  // One shared scale across all three series, so "Views" towering over "Saved"
  // stays visually true instead of each line being normalized to its own max.
  const max = Math.max(1, ...data.flatMap((d) => [d.views, d.going, d.saved]));

  const toY = (value: number) =>
    CHART_HEIGHT - PADDING_Y - (value / max) * (CHART_HEIGHT - PADDING_Y * 2);

  if (data.length === 0) {
    return (
      <View className="h-[140px] items-center justify-center">
        <Text className="font-['Roboto-Flex'] text-[12px] text-lhlSecondaryTextGrey">
          No engagement yet.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`}>
        {SERIES.map((series) => (
          <React.Fragment key={series.key}>
            <Polyline
              points={data.map((d, i) => `${i * step},${toY(d[series.key])}`).join(' ')}
              fill="none"
              stroke={series.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {data.map((d, i) => (
              <Circle
                key={`${series.key}-${i}`}
                cx={i * step}
                cy={toY(d[series.key])}
                r={2.5}
                fill={series.color}
              />
            ))}
          </React.Fragment>
        ))}
      </Svg>

      {/* Day axis */}
      <View className="mt-[4px] flex-row justify-between">
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
