import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextPack } from "../context/context-pack.js";

describe("buildContextPack", () => {
  test("loads plan docs and history", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ctx-"));
    const docsDir = join(root, "docs");
    const historyDir = join(root, ".clanker", "history");
    await mkdir(docsDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(docsDir, "plan-test.md"), "plan", "utf-8");
    await writeFile(join(historyDir, "task-1-slave.md"), "summary", "utf-8");

    const pack = await buildContextPack({ repoRoot: root, historyDir });
    const titles = pack.entries.map((entry) => entry.title);
    expect(titles).toContain("plan-test.md");
    expect(titles).toContain("task-1-slave.md");
  });

  test("handles missing docs directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ctx-missing-"));
    const historyDir = join(root, ".clanker", "history");
    await mkdir(historyDir, { recursive: true });

    const pack = await buildContextPack({ repoRoot: root, historyDir });
    expect(pack.entries.length).toBe(0);
  });

  test("skips empty docs and handles missing history", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ctx-empty-"));
    const docsDir = join(root, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(join(docsDir, "plan-empty.md"), "", "utf-8");

    const pack = await buildContextPack({ repoRoot: root, historyDir: join(root, ".clanker", "history") });
    expect(pack.entries.length).toBe(0);
  });

  test("handles unreadable doc file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ctx-missing-file-"));
    const docsDir = join(root, "docs");
    const historyDir = join(root, ".clanker", "history");
    await mkdir(docsDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });
    const planPath = join(docsDir, "plan-ghost.md");
    await writeFile(planPath, "temp", "utf-8");
    await import("node:fs/promises").then(({ chmod }) => chmod(planPath, 0o000));

    const pack = await buildContextPack({ repoRoot: root, historyDir });
    expect(pack.entries.length).toBe(0);
  });
});
