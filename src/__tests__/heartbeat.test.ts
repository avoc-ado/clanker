import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHeartbeat } from "../state/heartbeat.js";

describe("writeHeartbeat", () => {
  test("writes heartbeat file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-hb-"));
    await writeHeartbeat({ heartbeatDir: root, slaveId: "c1" });
    const raw = await readFile(join(root, "c1.json"), "utf-8");
    const parsed = JSON.parse(raw) as { slaveId: string };
    expect(parsed.slaveId).toBe("c1");
  });
});
