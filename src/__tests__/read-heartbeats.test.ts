import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHeartbeats } from "../state/read-heartbeats.js";

describe("readHeartbeats", () => {
  test("reads heartbeat files", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-hb-read-"));
    await writeFile(join(root, "c1.json"), JSON.stringify({ slaveId: "c1", ts: "now" }), "utf-8");

    const heartbeats = await readHeartbeats({ heartbeatDir: root });
    expect(heartbeats.length).toBe(1);
    expect(heartbeats[0]?.slaveId).toBe("c1");
  });

  test("ignores invalid heartbeat files", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-hb-bad-"));
    await writeFile(join(root, "bad.json"), "{not json}", "utf-8");

    const heartbeats = await readHeartbeats({ heartbeatDir: root });
    expect(heartbeats.length).toBe(0);
  });

  test("returns empty when dir missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-hb-missing-"));
    const missing = join(root, "nope");
    const heartbeats = await readHeartbeats({ heartbeatDir: missing });
    expect(heartbeats.length).toBe(0);
  });
});
