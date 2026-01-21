import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ensureConfigFile, loadConfig } from "../config.js";

describe("loadConfig", () => {
  test("returns defaults when no file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(3);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
    expect(config.promptFile).toBeUndefined();
  });

  test("writes defaults when missing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: 1");
    expect(raw).toContain("judges: 1");
    expect(raw).toContain("slaves: 3");
    expect(raw).toContain("codex --no-alt-screen --sandbox workspace-write");
    expect(raw).toContain("promptFile");
  });

  test("fills missing keys with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "slaves: 2\n", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(2);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
    expect(config.promptFile).toBeUndefined();
  });

  test("preserves config when all keys present", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const contents =
      "planners: 2\njudges: 1\nslaves: 4\ntmuxFilter: dev\ncodexCommand: codex\npromptFile: prompt.txt\n";
    await writeFile(join(root, "clanker.yaml"), contents, "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toBe(contents);
  });

  test("writes template with tmuxFilter and empty codexCommand", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), 'tmuxFilter: dev\ncodexCommand: ""\n', "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain('tmuxFilter: "dev"');
    expect(raw).toContain('codexCommand: ""');
    expect(raw).toContain("promptFile");
  });

  test("replaces empty config file with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: 1");
    expect(raw).toContain("judges: 1");
    expect(raw).toContain("slaves: 3");
    expect(raw).toContain("promptFile");
  });

  test("loads config from file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      "planners: 2\njudges: 2\nslaves: 5\ntmuxFilter: dev\ncodexCommand: codex\npromptFile: plan.txt\n",
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(2);
    expect(config.judges).toBe(2);
    expect(config.slaves).toBe(5);
    expect(config.tmuxFilter).toBe("dev");
    expect(config.codexCommand).toBe("codex");
    expect(config.promptFile).toBe("plan.txt");
  });
});
