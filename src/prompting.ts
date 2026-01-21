import { isAbsolute, join } from "node:path";
import type { ClankerConfig } from "./config.js";
import { getRuntimeOverrides } from "./runtime/overrides.js";

export interface PromptSettings {
  mode: "inline" | "file";
  planPromptPath: string;
  planPromptAbsolutePath: string;
}

const resolvePromptPath = ({
  repoRoot,
  promptFile,
}: {
  repoRoot: string;
  promptFile: string;
}): { displayPath: string; absolutePath: string } => {
  if (isAbsolute(promptFile)) {
    return { displayPath: promptFile, absolutePath: promptFile };
  }
  return { displayPath: promptFile, absolutePath: join(repoRoot, promptFile) };
};

export const getPromptSettings = ({
  repoRoot,
  config,
}: {
  repoRoot: string;
  config: ClankerConfig;
}): PromptSettings => {
  const overrides = getRuntimeOverrides();
  const promptFile = overrides.promptFile ?? config.promptFile;
  if (promptFile && promptFile.trim().length > 0) {
    const resolved = resolvePromptPath({ repoRoot, promptFile });
    return {
      mode: "file",
      planPromptPath: resolved.displayPath,
      planPromptAbsolutePath: resolved.absolutePath,
    };
  }
  const fallback = ".clanker/plan-prompt.txt";
  const resolved = resolvePromptPath({ repoRoot, promptFile: fallback });
  return {
    mode: "inline",
    planPromptPath: resolved.displayPath,
    planPromptAbsolutePath: resolved.absolutePath,
  };
};

export const buildPlanFileDispatch = ({ promptPath }: { promptPath: string }): string =>
  `Open ${promptPath} and follow it exactly. Create task packets in .clanker/tasks now.`;

export const buildTaskFileDispatch = ({ taskId }: { taskId: string }): string =>
  `Open .clanker/tasks/${taskId}.json and execute it. Follow the instructions exactly.`;
