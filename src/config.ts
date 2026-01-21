import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { basename, join } from "node:path";
import { getRuntimeOverrides } from "./runtime/overrides.js";

export interface ClankerConfig {
  planners: number;
  judges: number;
  slaves: number;
  tmuxFilter?: string;
  codexCommand?: string;
  promptFile?: string;
}

type ParsedConfig = Partial<ClankerConfig> & { tmuxSession?: string };

const DEFAULT_CONFIG = {
  planners: 1,
  judges: 1,
  slaves: 3,
  tmuxFilter: undefined,
  codexCommand: "codex --no-alt-screen --sandbox workspace-write",
  promptFile: undefined,
} satisfies ClankerConfig;

const CONFIG_KEYS = [
  "planners",
  "judges",
  "slaves",
  "tmuxFilter",
  "codexCommand",
  "promptFile",
] as const;

const escapeYamlString = ({ value }: { value: string }): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getDefaultTmuxFilter = ({ repoRoot }: { repoRoot: string }): string =>
  `clanker-${basename(repoRoot)}`;

const normalizeParsedConfig = ({
  parsed,
}: {
  parsed: ParsedConfig | null;
}): ParsedConfig | null => {
  if (!parsed) {
    return null;
  }
  const hasTmuxFilter = Object.prototype.hasOwnProperty.call(parsed, "tmuxFilter");
  if (hasTmuxFilter) {
    return parsed;
  }
  if (parsed.tmuxSession) {
    return {
      ...parsed,
      tmuxFilter: parsed.tmuxSession,
    } satisfies ParsedConfig;
  }
  return parsed;
};
const formatConfigTemplate = ({ config }: { config: ClankerConfig }): string => {
  const tmuxValue = config.tmuxFilter
    ? `"${escapeYamlString({ value: config.tmuxFilter })}"`
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
    "# Tmux session filter overide; leave empty to use 'clanker-<repo>''.",
    `tmuxFilter: ${tmuxValue}`,
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
    const parsedRaw = parse(raw) as ParsedConfig | null;
    const parsed = normalizeParsedConfig({ parsed: parsedRaw });
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
    const parsedRaw = parse(raw) as ParsedConfig | null;
    const parsed = normalizeParsedConfig({ parsed: parsedRaw });
    const merged = {
      ...DEFAULT_CONFIG,
      ...parsed,
    } satisfies ClankerConfig;
    const overrides = getRuntimeOverrides();
    const withOverrides = {
      ...merged,
      tmuxFilter:
        merged.tmuxFilter && merged.tmuxFilter.trim().length > 0
          ? merged.tmuxFilter
          : getDefaultTmuxFilter({ repoRoot }),
      codexCommand: overrides.codexCommand ?? merged.codexCommand,
      promptFile: overrides.promptFile ?? merged.promptFile,
    } satisfies ClankerConfig;
    return {
      ...withOverrides,
      tmuxFilter:
        withOverrides.tmuxFilter && withOverrides.tmuxFilter.trim().length > 0
          ? withOverrides.tmuxFilter
          : getDefaultTmuxFilter({ repoRoot }),
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
      tmuxFilter: getDefaultTmuxFilter({ repoRoot }),
      codexCommand:
        merged.codexCommand && merged.codexCommand.length > 0 ? merged.codexCommand : undefined,
      promptFile: merged.promptFile && merged.promptFile.length > 0 ? merged.promptFile : undefined,
    } satisfies ClankerConfig;
  }
};
