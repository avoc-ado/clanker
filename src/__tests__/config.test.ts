import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfigFile, loadConfig } from "../config.js";

describe("loadConfig", () => {
  test("returns defaults when no file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(3);
    expect(config.tmuxSession).toBeUndefined();
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
  });

  test("writes defaults when missing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: 1");
    expect(raw).toContain("judges: 1");
    expect(raw).toContain("slaves: 3");
    expect(raw).toContain("codex --no-alt-screen --sandbox workspace-write");
  });

  test("fills missing keys with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "slaves: 2\n", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(2);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
  });

  test("preserves config when all keys present", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const contents = "planners: 2\njudges: 1\nslaves: 4\ntmuxSession: dev\ncodexCommand: codex\n";
    await writeFile(join(root, "clanker.yaml"), contents, "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toBe(contents);
  });

  test("writes template with tmuxSession and empty codexCommand", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), 'tmuxSession: dev\ncodexCommand: ""\n', "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain('tmuxSession: "dev"');
    expect(raw).toContain('codexCommand: ""');
  });

  test("replaces empty config file with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: 1");
    expect(raw).toContain("judges: 1");
    expect(raw).toContain("slaves: 3");
  });

  test("loads config from file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      "planners: 2\njudges: 2\nslaves: 5\ntmuxSession: dev\ncodexCommand: codex\n",
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(2);
    expect(config.judges).toBe(2);
    expect(config.slaves).toBe(5);
    expect(config.tmuxSession).toBe("dev");
    expect(config.codexCommand).toBe("codex");
  });
});
