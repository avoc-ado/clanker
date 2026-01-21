import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { basename, join } from "node:path";

export interface ClankerConfig {
  planners: number;
  judges: number;
  slaves: number;
  tmuxSession?: string;
  codexCommand?: string;
}

const DEFAULT_CONFIG = {
  planners: 1,
  judges: 1,
  slaves: 3,
  tmuxSession: undefined,
  codexCommand: "codex --no-alt-screen --sandbox workspace-write",
} satisfies ClankerConfig;

const CONFIG_KEYS = ["planners", "judges", "slaves", "tmuxSession", "codexCommand"] as const;

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
    return {
      ...merged,
      tmuxSession:
        merged.tmuxSession && merged.tmuxSession.trim().length > 0
          ? merged.tmuxSession
          : getDefaultTmuxSession({ repoRoot }),
      codexCommand:
        merged.codexCommand && merged.codexCommand.length > 0 ? merged.codexCommand : undefined,
    } satisfies ClankerConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
};
