import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { join } from "node:path";

export interface ClankerConfig {
  slaves: number;
  tmuxSession?: string;
  codexCommand?: string;
}

const DEFAULT_CONFIG = {
  slaves: 3,
  tmuxSession: undefined,
  codexCommand: undefined,
} satisfies ClankerConfig;

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
      tmuxSession: merged.tmuxSession && merged.tmuxSession.length > 0 ? merged.tmuxSession : undefined,
      codexCommand: merged.codexCommand && merged.codexCommand.length > 0 ? merged.codexCommand : undefined,
    } satisfies ClankerConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
};
