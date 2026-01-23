import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { basename, join } from "node:path";
import { getRuntimeOverrides } from "./runtime/overrides.js";

export const DEFAULT_SENTINEL = "default" as const;
type DefaultSentinel = typeof DEFAULT_SENTINEL;
type ConfigValue<T> = T | DefaultSentinel;

export interface ClankerConfig {
  planners: number;
  judges: number;
  slaves: number;
  backlog: number;
  startImmediately: boolean;
  tmuxFilter?: string;
  codexCommand?: string;
  promptFile?: string;
}

export interface ClankerConfigTemplate {
  planners: ConfigValue<number>;
  judges: ConfigValue<number>;
  slaves: ConfigValue<number>;
  backlog: ConfigValue<number>;
  startImmediately: ConfigValue<boolean>;
  tmuxFilter: ConfigValue<string>;
  codexCommand: ConfigValue<string>;
  promptFile: ConfigValue<string>;
}

export const DEFAULT_CONFIG = {
  planners: 1,
  judges: 1,
  slaves: 3,
  backlog: 3,
  startImmediately: true,
  tmuxFilter: undefined,
  codexCommand: "codex --no-alt-screen --sandbox workspace-write",
  promptFile: undefined,
} satisfies ClankerConfig;

export const CONFIG_KEYS = [
  "planners",
  "judges",
  "slaves",
  "backlog",
  "startImmediately",
  "tmuxFilter",
  "codexCommand",
  "promptFile",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

type ParsedConfig = Partial<Record<ConfigKey, unknown>> & { tmuxSession?: unknown };

const escapeYamlString = ({ value }: { value: string }): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getDefaultTmuxFilter = ({ repoRoot }: { repoRoot: string }): string =>
  `clanker-${basename(repoRoot)}`;

const isDefaultSentinel = (value: unknown): value is DefaultSentinel =>
  typeof value === "string" && value.trim().toLowerCase() === DEFAULT_SENTINEL;

const parseNumberValue = ({ value }: { value: unknown }): number | undefined => {
  if (isDefaultSentinel(value)) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const parseBooleanValue = ({ value }: { value: unknown }): boolean | undefined => {
  if (isDefaultSentinel(value)) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }
  return undefined;
};

const parseStringValue = ({ value }: { value: unknown }): string | undefined => {
  if (isDefaultSentinel(value)) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

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

const resolveTemplateNumber = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: number;
}): ConfigValue<number> => {
  if (isDefaultSentinel(value)) {
    return DEFAULT_SENTINEL;
  }
  const parsed = parseNumberValue({ value });
  if (parsed === undefined || parsed === fallback) {
    return DEFAULT_SENTINEL;
  }
  return parsed;
};

const resolveTemplateBoolean = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: boolean;
}): ConfigValue<boolean> => {
  if (isDefaultSentinel(value)) {
    return DEFAULT_SENTINEL;
  }
  const parsed = parseBooleanValue({ value });
  if (parsed === undefined || parsed === fallback) {
    return DEFAULT_SENTINEL;
  }
  return parsed;
};

const resolveTemplateString = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback?: string;
}): ConfigValue<string> => {
  if (isDefaultSentinel(value)) {
    return DEFAULT_SENTINEL;
  }
  const parsed = parseStringValue({ value });
  if (!parsed) {
    return DEFAULT_SENTINEL;
  }
  if (fallback && parsed === fallback) {
    return DEFAULT_SENTINEL;
  }
  return parsed;
};

export const buildTemplateConfig = ({
  parsed,
  repoRoot,
}: {
  parsed: ParsedConfig | null;
  repoRoot: string;
}): ClankerConfigTemplate => {
  const tmuxFallback = getDefaultTmuxFilter({ repoRoot });
  return {
    planners: resolveTemplateNumber({ value: parsed?.planners, fallback: DEFAULT_CONFIG.planners }),
    judges: resolveTemplateNumber({ value: parsed?.judges, fallback: DEFAULT_CONFIG.judges }),
    slaves: resolveTemplateNumber({ value: parsed?.slaves, fallback: DEFAULT_CONFIG.slaves }),
    backlog: resolveTemplateNumber({ value: parsed?.backlog, fallback: DEFAULT_CONFIG.backlog }),
    startImmediately: resolveTemplateBoolean({
      value: parsed?.startImmediately,
      fallback: DEFAULT_CONFIG.startImmediately,
    }),
    tmuxFilter: resolveTemplateString({
      value: parsed?.tmuxFilter ?? parsed?.tmuxSession,
      fallback: tmuxFallback,
    }),
    codexCommand: resolveTemplateString({
      value: parsed?.codexCommand,
      fallback: DEFAULT_CONFIG.codexCommand,
    }),
    promptFile: resolveTemplateString({ value: parsed?.promptFile, fallback: "" }),
  } satisfies ClankerConfigTemplate;
};

const formatConfigValue = ({ value }: { value: ConfigValue<number | boolean> }): string => {
  if (value === DEFAULT_SENTINEL) {
    return DEFAULT_SENTINEL;
  }
  return `${value}`;
};

const formatConfigString = ({ value }: { value: ConfigValue<string> }): string => {
  if (value === DEFAULT_SENTINEL) {
    return DEFAULT_SENTINEL;
  }
  return `"${escapeYamlString({ value })}"`;
};

export const formatConfigTemplate = ({ config }: { config: ClankerConfigTemplate }): string => {
  return [
    `# default: ${DEFAULT_CONFIG.planners}. Number of Planner terminals.`,
    `planners: ${formatConfigValue({ value: config.planners })}`,
    "",
    `# default: ${DEFAULT_CONFIG.judges}. Number of Judge terminals.`,
    `judges: ${formatConfigValue({ value: config.judges })}`,
    "",
    `# default: ${DEFAULT_CONFIG.slaves}. Number of Slave terminals.`,
    `slaves: ${formatConfigValue({ value: config.slaves })}`,
    "",
    `# default: ${DEFAULT_CONFIG.backlog}. Queued task backlog target.`,
    `backlog: ${formatConfigValue({ value: config.backlog })}`,
    "",
    `# default: ${DEFAULT_CONFIG.startImmediately}. Start in /resume state.`,
    `startImmediately: ${formatConfigValue({ value: config.startImmediately })}`,
    "",
    "# default: clanker-<repo>. Tmux session filter override.",
    `tmuxFilter: ${formatConfigString({ value: config.tmuxFilter })}`,
    "",
    `# default: ${DEFAULT_CONFIG.codexCommand}. Command used to launch Codex CLI.`,
    `codexCommand: ${formatConfigString({ value: config.codexCommand })}`,
    "",
    '# default: "". (testing/automation) Prompt file path for plan dispatch.',
    `promptFile: ${formatConfigString({ value: config.promptFile })}`,
    "",
  ].join("\n");
};

const resolveConfigNumber = ({ value, fallback }: { value: unknown; fallback: number }): number =>
  parseNumberValue({ value }) ?? fallback;

const resolveConfigBoolean = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: boolean;
}): boolean => parseBooleanValue({ value }) ?? fallback;

const resolveConfigString = ({ value }: { value: unknown }): string | undefined =>
  parseStringValue({ value });

export const parseConfigFile = ({ raw }: { raw: string }): ParsedConfig | null => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsedRaw = parse(raw) as ParsedConfig | null;
    return normalizeParsedConfig({ parsed: parsedRaw });
  } catch {
    return null;
  }
};

export const ensureConfigFile = async ({ repoRoot }: { repoRoot: string }): Promise<void> => {
  const configPath = join(repoRoot, "clanker.yaml");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = parseConfigFile({ raw });
    const template = formatConfigTemplate({
      config: buildTemplateConfig({ parsed, repoRoot }),
    });
    if (!raw.trim() || raw !== template) {
      await writeFile(configPath, template, "utf-8");
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      const template = formatConfigTemplate({
        config: buildTemplateConfig({ parsed: null, repoRoot }),
      });
      await writeFile(configPath, template, "utf-8");
    }
  }
};

export const loadConfig = async ({ repoRoot }: { repoRoot: string }): Promise<ClankerConfig> => {
  const configPath = join(repoRoot, "clanker.yaml");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = parseConfigFile({ raw });
    const merged = {
      planners: resolveConfigNumber({
        value: parsed?.planners,
        fallback: DEFAULT_CONFIG.planners,
      }),
      judges: resolveConfigNumber({ value: parsed?.judges, fallback: DEFAULT_CONFIG.judges }),
      slaves: resolveConfigNumber({ value: parsed?.slaves, fallback: DEFAULT_CONFIG.slaves }),
      backlog: resolveConfigNumber({ value: parsed?.backlog, fallback: DEFAULT_CONFIG.backlog }),
      startImmediately: resolveConfigBoolean({
        value: parsed?.startImmediately,
        fallback: DEFAULT_CONFIG.startImmediately,
      }),
      tmuxFilter: resolveConfigString({ value: parsed?.tmuxFilter ?? parsed?.tmuxSession }),
      codexCommand: resolveConfigString({ value: parsed?.codexCommand }),
      promptFile: resolveConfigString({ value: parsed?.promptFile }),
    } satisfies ClankerConfig;
    const overrides = getRuntimeOverrides();
    const withOverrides = {
      ...merged,
      tmuxFilter:
        merged.tmuxFilter && merged.tmuxFilter.trim().length > 0
          ? merged.tmuxFilter
          : getDefaultTmuxFilter({ repoRoot }),
      codexCommand: overrides.codexCommand ?? merged.codexCommand ?? DEFAULT_CONFIG.codexCommand,
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
