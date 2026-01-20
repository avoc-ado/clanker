import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  test("returns defaults when no file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const config = await loadConfig({ repoRoot: root });
    expect(config.slaves).toBe(3);
    expect(config.tmuxSession).toBeUndefined();
    expect(config.codexCommand).toBeUndefined();
  });

  test("loads config from file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      "slaves: 5\ntmuxSession: dev\ncodexCommand: c\n",
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.slaves).toBe(5);
    expect(config.tmuxSession).toBe("dev");
    expect(config.codexCommand).toBe("c");
  });
});
