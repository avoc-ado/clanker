import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMetricSeries, loadMetrics, saveMetrics } from "../state/metrics.js";

describe("metrics", () => {
  test("load defaults and save", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-metrics-"));
    const path = join(root, "metrics.json");

    const initial = await loadMetrics({ metricsPath: path });
    expect(initial.taskCount).toBe(0);

    const updated = { ...initial, taskCount: 2 };
    await saveMetrics({ metricsPath: path, metrics: updated });

    const raw = JSON.parse(await readFile(path, "utf-8")) as typeof updated;
    expect(raw.taskCount).toBe(2);
  });

  test("appends metric series with cap", () => {
    const next = appendMetricSeries({ series: [1, 2, 3], value: 4, maxLength: 3 });
    expect(next).toEqual([2, 3, 4]);
  });

  test("appends metric series without truncation", () => {
    const next = appendMetricSeries({ series: [1, 2], value: 3, maxLength: 5 });
    expect(next).toEqual([1, 2, 3]);
  });

  test("loadMetrics fills missing histories", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-metrics-"));
    const path = join(root, "metrics.json");
    const payload = {
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      reworkCount: 0,
      conflictCount: 0,
      idleMinutes: 0,
      tokenBurn: 0,
    };
    await writeFile(path, JSON.stringify(payload), "utf-8");
    const loaded = await loadMetrics({ metricsPath: path });
    expect(loaded.burnHistory).toEqual([]);
    expect(loaded.backlogHistory).toEqual([]);
  });
});
