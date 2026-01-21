import { join } from "node:path";
import type { ClankerConfig } from "../config.js";
import { buildPlanFileDispatch, buildTaskFileDispatch, getPromptSettings } from "../prompting.js";
import { setRuntimeOverrides } from "../runtime/overrides.js";

const makeConfig = ({ promptFile }: { promptFile?: string }): ClankerConfig => ({
  planners: 1,
  judges: 1,
  slaves: 1,
  tmuxFilter: undefined,
  codexCommand: "codex",
  promptFile,
});

describe("prompting", () => {
  afterEach(() => {
    setRuntimeOverrides({ overrides: {} });
  });

  test("defaults to inline prompt with fallback file path", () => {
    const repoRoot = "/tmp/clanker";
    const config = makeConfig({});
    const settings = getPromptSettings({ repoRoot, config });
    expect(settings.mode).toBe("inline");
    expect(settings.planPromptPath).toBe(".clanker/plan-prompt.txt");
    expect(settings.planPromptAbsolutePath).toBe(join(repoRoot, ".clanker/plan-prompt.txt"));
  });

  test("uses config promptFile for file mode", () => {
    const repoRoot = "/tmp/clanker";
    const config = makeConfig({ promptFile: "prompt.txt" });
    const settings = getPromptSettings({ repoRoot, config });
    expect(settings.mode).toBe("file");
    expect(settings.planPromptPath).toBe("prompt.txt");
    expect(settings.planPromptAbsolutePath).toBe(join(repoRoot, "prompt.txt"));
  });

  test("runtime override wins for promptFile", () => {
    const repoRoot = "/tmp/clanker";
    const config = makeConfig({ promptFile: "prompt.txt" });
    setRuntimeOverrides({ overrides: { promptFile: "/abs/prompt.md" } });
    const settings = getPromptSettings({ repoRoot, config });
    expect(settings.mode).toBe("file");
    expect(settings.planPromptPath).toBe("/abs/prompt.md");
    expect(settings.planPromptAbsolutePath).toBe("/abs/prompt.md");
  });

  test("builds file dispatch prompts", () => {
    expect(buildPlanFileDispatch({ promptPath: "prompt.txt" })).toContain("prompt.txt");
    expect(buildTaskFileDispatch({ taskId: "t1" })).toContain(".clanker/tasks/t1.json");
  });
});
