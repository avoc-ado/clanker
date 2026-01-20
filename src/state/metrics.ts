import { readFile, writeFile } from "node:fs/promises";

export interface MetricsSnapshot {
  updatedAt: string;
  taskCount: number;
  reworkCount: number;
  conflictCount: number;
  idleMinutes: number;
  tokenBurn: number;
  burnHistory: number[];
  backlogHistory: number[];
}

export const loadMetrics = async ({ metricsPath }: { metricsPath: string }): Promise<MetricsSnapshot> => {
  try {
    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw) as MetricsSnapshot;
    return {
      ...parsed,
      burnHistory: parsed.burnHistory ?? [],
      backlogHistory: parsed.backlogHistory ?? [],
    } satisfies MetricsSnapshot;
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      taskCount: 0,
      reworkCount: 0,
      conflictCount: 0,
      idleMinutes: 0,
      tokenBurn: 0,
      burnHistory: [],
      backlogHistory: [],
    } satisfies MetricsSnapshot;
  }
};

export const saveMetrics = async ({
  metricsPath,
  metrics,
}: {
  metricsPath: string;
  metrics: MetricsSnapshot;
}): Promise<void> => {
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");
};

export const appendMetricSeries = ({
  series,
  value,
  maxLength,
}: {
  series: number[];
  value: number;
  maxLength: number;
}): number[] => {
  const next = [...series, value];
  if (next.length <= maxLength) {
    return next;
  }
  return next.slice(next.length - maxLength);
};
