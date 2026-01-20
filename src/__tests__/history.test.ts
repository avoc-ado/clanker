import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHistory } from "../state/history.js";

describe("writeHistory", () => {
  test("writes history note", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-history-"));
    await writeHistory({
      historyDir: root,
      taskId: "t1",
      role: "slave",
      content: "note",
    });
    const contents = await readFile(join(root, "task-t1-slave.md"), "utf-8");
    expect(contents).toBe("note");
  });
});
