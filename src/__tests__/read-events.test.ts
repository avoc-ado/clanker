import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecentEvents } from "../state/read-events.js";

describe("readRecentEvents", () => {
  test("reads last events", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-events-"));
    const path = join(root, "events.log");
    const lines = [
      JSON.stringify({ ts: "t1", type: "A", msg: "one" }),
      JSON.stringify({ ts: "t2", type: "B", msg: "two" }),
    ].join("\n");
    await writeFile(path, lines, "utf-8");

    const events = await readRecentEvents({ eventsLog: path, limit: 1 });
    expect(events.length).toBe(1);
    expect(events[0]?.msg).toBe("two");
  });

  test("ignores invalid lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-events-bad-"));
    const path = join(root, "events.log");
    const lines = ["{bad json}", JSON.stringify({ ts: "t3", type: "C", msg: "ok" })].join("\n");
    await writeFile(path, lines, "utf-8");

    const events = await readRecentEvents({ eventsLog: path, limit: 2 });
    expect(events.length).toBe(1);
    expect(events[0]?.msg).toBe("ok");
  });

  test("returns empty when file missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-events-missing-"));
    const path = join(root, "missing.log");
    const events = await readRecentEvents({ eventsLog: path, limit: 2 });
    expect(events.length).toBe(0);
  });
});
