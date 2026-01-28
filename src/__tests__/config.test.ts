import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildTemplateConfig,
  ensureConfigFile,
  ensureGitignoreEntry,
  loadConfig,
  parseConfigFile,
} from "../config.js";

describe("loadConfig", () => {
  test("returns defaults when no file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(3);
    expect(config.backlog).toBe(1);
    expect(config.lockConflictsEnabled).toBe(true);
    expect(config.lockConflictsBlockPlanner).toBe(false);
    expect(config.startImmediately).toBe(false);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
    expect(config.promptFile).toBeUndefined();
  });

  test("writes defaults when missing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: default");
    expect(raw).toContain("judges: default");
    expect(raw).toContain("slaves: default");
    expect(raw).toContain("backlog: default");
    expect(raw).toContain("lockConflictsEnabled: default");
    expect(raw).toContain("lockConflictsBlockPlanner: default");
    expect(raw).toContain("startImmediately: default");
    expect(raw).toContain("codexCommand: default");
    expect(raw).toContain("promptFile");
  });

  test("adds .clanker to gitignore on first write", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await ensureConfigFile({ repoRoot: root });
    const gitignorePath = join(root, ".gitignore");
    const raw = await readFile(gitignorePath, "utf-8");
    const entries = raw.split(/\r?\n/).filter((line) => line.trim() === ".clanker");
    expect(entries).toHaveLength(1);
    await ensureConfigFile({ repoRoot: root });
    const rawAgain = await readFile(gitignorePath, "utf-8");
    const entriesAgain = rawAgain.split(/\r?\n/).filter((line) => line.trim() === ".clanker");
    expect(entriesAgain).toHaveLength(1);
  });

  test("ensureGitignoreEntry appends when missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const gitignorePath = join(root, ".gitignore");
    await writeFile(gitignorePath, "node_modules\n", "utf-8");
    await ensureGitignoreEntry({ repoRoot: root, entry: ".clanker" });
    const raw = await readFile(gitignorePath, "utf-8");
    expect(raw).toContain("node_modules");
    expect(raw).toContain(".clanker");
  });

  test("ensureGitignoreEntry is idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const gitignorePath = join(root, ".gitignore");
    await writeFile(gitignorePath, "node_modules\n.clanker\n", "utf-8");
    await ensureGitignoreEntry({ repoRoot: root, entry: ".clanker" });
    const raw = await readFile(gitignorePath, "utf-8");
    const entries = raw.split(/\r?\n/).filter((line) => line.trim() === ".clanker");
    expect(entries).toHaveLength(1);
  });

  test("fills missing keys with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "slaves: 2\n", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(2);
    expect(config.backlog).toBe(1);
    expect(config.lockConflictsEnabled).toBe(true);
    expect(config.lockConflictsBlockPlanner).toBe(false);
    expect(config.startImmediately).toBe(false);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
    expect(config.promptFile).toBeUndefined();
  });

  test("reformats config when all keys present", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const contents =
      "planners: 2\njudges: 1\nslaves: 4\nbacklog: 5\nlockConflictsEnabled: true\nlockConflictsBlockPlanner: false\nstartImmediately: false\ntmuxFilter: dev\ncodexCommand: codex\npromptFile: prompt.txt\n";
    await writeFile(join(root, "clanker.yaml"), contents, "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: 2");
    expect(raw).toContain("judges: default");
    expect(raw).toContain("slaves: 4");
    expect(raw).toContain("backlog: 5");
    expect(raw).toContain("lockConflictsEnabled: default");
    expect(raw).toContain("lockConflictsBlockPlanner: default");
    expect(raw).toContain("startImmediately: default");
    expect(raw).toContain('tmuxFilter: "dev"');
    expect(raw).toContain('codexCommand: "codex"');
    expect(raw).toContain('promptFile: "prompt.txt"');
  });

  test("writes template with tmuxFilter and empty codexCommand", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), 'tmuxFilter: dev\ncodexCommand: ""\n', "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain('tmuxFilter: "dev"');
    expect(raw).toContain("codexCommand: default");
    expect(raw).toContain("promptFile");
  });

  test("replaces empty config file with defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), "", "utf-8");
    await ensureConfigFile({ repoRoot: root });
    const raw = await readFile(join(root, "clanker.yaml"), "utf-8");
    expect(raw).toContain("planners: default");
    expect(raw).toContain("judges: default");
    expect(raw).toContain("slaves: default");
    expect(raw).toContain("backlog: default");
    expect(raw).toContain("lockConflictsEnabled: default");
    expect(raw).toContain("lockConflictsBlockPlanner: default");
    expect(raw).toContain("startImmediately: default");
    expect(raw).toContain("promptFile");
  });

  test("loads config from file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      "planners: 2\njudges: 2\nslaves: 5\nbacklog: 4\nlockConflictsEnabled: false\nlockConflictsBlockPlanner: true\nstartImmediately: false\ntmuxFilter: dev\ncodexCommand: codex\npromptFile: plan.txt\n",
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(2);
    expect(config.judges).toBe(2);
    expect(config.slaves).toBe(5);
    expect(config.backlog).toBe(4);
    expect(config.lockConflictsEnabled).toBe(false);
    expect(config.lockConflictsBlockPlanner).toBe(true);
    expect(config.startImmediately).toBe(false);
    expect(config.tmuxFilter).toBe("dev");
    expect(config.codexCommand).toBe("codex");
    expect(config.promptFile).toBe("plan.txt");
  });

  test("treats default sentinel as default values", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      "planners: default\njudges: default\nslaves: default\nbacklog: default\nlockConflictsEnabled: default\nlockConflictsBlockPlanner: default\nstartImmediately: default\ntmuxFilter: default\ncodexCommand: default\npromptFile: default\n",
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
    expect(config.judges).toBe(1);
    expect(config.slaves).toBe(3);
    expect(config.backlog).toBe(1);
    expect(config.lockConflictsEnabled).toBe(true);
    expect(config.lockConflictsBlockPlanner).toBe(false);
    expect(config.startImmediately).toBe(false);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
    expect(config.codexCommand).toBe("codex --no-alt-screen --sandbox workspace-write");
    expect(config.promptFile).toBeUndefined();
  });

  test("parses string numbers and booleans", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(
      join(root, "clanker.yaml"),
      'planners: "2"\nstartImmediately: "false"\ntmuxFilter: ""\n',
      "utf-8",
    );
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(2);
    expect(config.startImmediately).toBe(false);
    expect(config.tmuxFilter).toBe(`clanker-${basename(root)}`);
  });

  test("parses blank number strings as defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    await writeFile(join(root, "clanker.yaml"), 'planners: "   "\n', "utf-8");
    const config = await loadConfig({ repoRoot: root });
    expect(config.planners).toBe(1);
  });

  test("buildTemplateConfig keeps defaults as sentinel", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-config-"));
    const parsed = {
      planners: "default",
      judges: 1,
      lockConflictsEnabled: "default",
      lockConflictsBlockPlanner: "default",
      startImmediately: "default",
      tmuxFilter: `clanker-${basename(root)}`,
      codexCommand: "default",
      promptFile: "default",
    };
    const template = buildTemplateConfig({ parsed, repoRoot: root });
    expect(template.planners).toBe("default");
    expect(template.judges).toBe("default");
    expect(template.lockConflictsEnabled).toBe("default");
    expect(template.lockConflictsBlockPlanner).toBe("default");
    expect(template.startImmediately).toBe("default");
    expect(template.tmuxFilter).toBe("default");
    expect(template.codexCommand).toBe("default");
    expect(template.promptFile).toBe("default");
  });

  test("normalizes legacy tmuxSession field", () => {
    const parsed = parseConfigFile({ raw: "tmuxSession: legacy\n" });
    expect(parsed?.tmuxFilter).toBe("legacy");
  });

  test("parseConfigFile returns null on invalid yaml", () => {
    const parsed = parseConfigFile({ raw: "bad: [\n" });
    expect(parsed).toBeNull();
  });
});
