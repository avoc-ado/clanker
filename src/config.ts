import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { basename, join } from "node:path";
import { getRuntimeOverrides } from "./runtime/overrides.js";

export interface ClankerConfig {
  planners: number;
  judges: number;
  slaves: number;
  tmuxSession?: string;
  codexCommand?: string;
  promptFile?: string;
}

const DEFAULT_CONFIG = {
  planners: 1,
  judges: 1,
  slaves: 3,
  tmuxSession: undefined,
  codexCommand: "codex --no-alt-screen --sandbox workspace-write",
  promptFile: undefined,
} satisfies ClankerConfig;

const CONFIG_KEYS = [
  "planners",
  "judges",
  "slaves",
  "tmuxSession",
  "codexCommand",
  "promptFile",
] as const;

const escapeYamlString = ({ value }: { value: string }): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getDefaultTmuxSession = ({ repoRoot }: { repoRoot: string }): string =>
  `clanker-${basename(repoRoot)}`;

const formatConfigTemplate = ({ config }: { config: ClankerConfig }): string => {
  const tmuxValue = config.tmuxSession
    ? `"${escapeYamlString({ value: config.tmuxSession })}"`
    : '""';
  const codexValue = config.codexCommand
    ? `"${escapeYamlString({ value: config.codexCommand })}"`
    : '""';
  const promptValue = config.promptFile
    ? `"${escapeYamlString({ value: config.promptFile })}"`
    : '""';
  return [
    "# (experimental) Number of Planner terminals.",
    `planners: ${config.planners}`,
    "",
    "# (experimental) Number of Judge terminals.",
    `judges: ${config.judges}`,
    "",
    "# Number of Slave terminals.",
    `slaves: ${config.slaves}`,
    "",
    "# Tmux session filter; leave empty to use clanker-<repo>.",
    `tmuxSession: ${tmuxValue}`,
    "",
    "# Command used to launch Codex CLI.",
    `codexCommand: ${codexValue}`,
    "",
    "# (testing/automation) Prompt file path for plan dispatch.",
    `promptFile: ${promptValue}`,
    "",
  ].join("\n");
};

export const ensureConfigFile = async ({ repoRoot }: { repoRoot: string }): Promise<void> => {
  const configPath = join(repoRoot, "clanker.yaml");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = parse(raw) as Partial<ClankerConfig> | null;
    if (!parsed) {
      await writeFile(configPath, formatConfigTemplate({ config: DEFAULT_CONFIG }), "utf-8");
      return;
    }
    const merged = {
      ...DEFAULT_CONFIG,
      ...parsed,
    } satisfies ClankerConfig;
    const hasAllKeys = CONFIG_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(parsed, key),
    );
    if (!hasAllKeys) {
      await writeFile(configPath, formatConfigTemplate({ config: merged }), "utf-8");
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      await writeFile(configPath, formatConfigTemplate({ config: DEFAULT_CONFIG }), "utf-8");
    }
  }
};

export const loadConfig = async ({ repoRoot }: { repoRoot: string }): Promise<ClankerConfig> => {
  const configPath = join(repoRoot, "clanker.yaml");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = parse(raw) as Partial<ClankerConfig> | null;
    const merged = {
      ...DEFAULT_CONFIG,
      ...parsed,
    } satisfies ClankerConfig;
    const overrides = getRuntimeOverrides();
    const withOverrides = {
      ...merged,
      codexCommand: overrides.codexCommand ?? merged.codexCommand,
      promptFile: overrides.promptFile ?? merged.promptFile,
    } satisfies ClankerConfig;
    return {
      ...withOverrides,
      tmuxSession:
        withOverrides.tmuxSession && withOverrides.tmuxSession.trim().length > 0
          ? withOverrides.tmuxSession
          : getDefaultTmuxSession({ repoRoot }),
      codexCommand:
        withOverrides.codexCommand && withOverrides.codexCommand.length > 0
          ? withOverrides.codexCommand
          : undefined,
      promptFile:
        withOverrides.promptFile && withOverrides.promptFile.length > 0
          ? withOverrides.promptFile
          : undefined,
    } satisfies ClankerConfig;
  } catch {
    const overrides = getRuntimeOverrides();
    const merged = {
      ...DEFAULT_CONFIG,
      codexCommand: overrides.codexCommand ?? DEFAULT_CONFIG.codexCommand,
      promptFile: overrides.promptFile ?? DEFAULT_CONFIG.promptFile,
    } satisfies ClankerConfig;
    return {
      ...merged,
      tmuxSession: getDefaultTmuxSession({ repoRoot }),
      codexCommand:
        merged.codexCommand && merged.codexCommand.length > 0 ? merged.codexCommand : undefined,
      promptFile: merged.promptFile && merged.promptFile.length > 0 ? merged.promptFile : undefined,
    } satisfies ClankerConfig;
  }
};
