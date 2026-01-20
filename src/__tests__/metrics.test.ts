import { mkdtemp, readFile } from "node:fs/promises";
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
});
