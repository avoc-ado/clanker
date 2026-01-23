import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as readline from "node:readline";
import {
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  DEFAULT_SENTINEL,
  buildTemplateConfig,
  formatConfigTemplate,
  parseConfigFile,
  type ConfigKey,
} from "../config.js";
import { ensureConfigFile } from "../config.js";

interface PromptResult {
  didPrompt: boolean;
}

const hasOwnKey = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasConfigKey = ({ parsed, key }: { parsed: Record<string, unknown>; key: ConfigKey }) => {
  if (key === "tmuxFilter") {
    return hasOwnKey(parsed, "tmuxFilter") || hasOwnKey(parsed, "tmuxSession");
  }
  return hasOwnKey(parsed, key);
};

const ask = async ({ rl, prompt }: { rl: readline.Interface; prompt: string }): Promise<string> =>
  new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });

const isDefaultAnswer = ({ answer }: { answer: string }): boolean =>
  answer.trim().toLowerCase() === DEFAULT_SENTINEL;

const askNumber = async ({
  rl,
  label,
  fallback,
}: {
  rl: readline.Interface;
  label: string;
  fallback: number;
}): Promise<number | string> => {
  while (true) {
    const answer = await ask({ rl, prompt: `${label} (default ${fallback}): ` });
    if (!answer.trim() || isDefaultAnswer({ answer })) {
      return DEFAULT_SENTINEL;
    }
    const parsed = Number(answer);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    console.log("Invalid number. Try again.");
  }
};

const askBoolean = async ({
  rl,
  label,
  fallback,
}: {
  rl: readline.Interface;
  label: string;
  fallback: boolean;
}): Promise<boolean | string> => {
  const hint = fallback ? "Y/n" : "y/N";
  while (true) {
    const answer = await ask({ rl, prompt: `${label} (${hint}, default ${fallback}): ` });
    if (!answer.trim() || isDefaultAnswer({ answer })) {
      return DEFAULT_SENTINEL;
    }
    const normalized = answer.trim().toLowerCase();
    if (["y", "yes", "true"].includes(normalized)) {
      return true;
    }
    if (["n", "no", "false"].includes(normalized)) {
      return false;
    }
    console.log("Invalid response. Use y/n.");
  }
};

const askString = async ({
  rl,
  label,
  fallback,
}: {
  rl: readline.Interface;
  label: string;
  fallback: string;
}): Promise<string> => {
  const answer = await ask({ rl, prompt: `${label} (default ${fallback}): ` });
  if (!answer.trim() || isDefaultAnswer({ answer })) {
    return DEFAULT_SENTINEL;
  }
  return answer.trim();
};

export const runOnboardingIfNeeded = async ({
  repoRoot,
}: {
  repoRoot: string;
}): Promise<PromptResult> => {
  const configPath = join(repoRoot, "clanker.yaml");
  let raw = "";
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    raw = "";
  }
  const parsed = parseConfigFile({ raw }) ?? {};
  const missingKeys = CONFIG_KEYS.filter((key) => !hasConfigKey({ parsed, key }));

  if (missingKeys.length === 0 && raw.trim()) {
    await ensureConfigFile({ repoRoot });
    return { didPrompt: false };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const updated: Record<string, unknown> = { ...parsed };
  try {
    for (const key of missingKeys) {
      if (key === "planners") {
        updated.planners = await askNumber({
          rl,
          label: "planners",
          fallback: DEFAULT_CONFIG.planners,
        });
        continue;
      }
      if (key === "judges") {
        updated.judges = await askNumber({ rl, label: "judges", fallback: DEFAULT_CONFIG.judges });
        continue;
      }
      if (key === "slaves") {
        updated.slaves = await askNumber({ rl, label: "slaves", fallback: DEFAULT_CONFIG.slaves });
        continue;
      }
      if (key === "backlog") {
        updated.backlog = await askNumber({
          rl,
          label: "backlog",
          fallback: DEFAULT_CONFIG.backlog,
        });
        continue;
      }
      if (key === "startImmediately") {
        updated.startImmediately = await askBoolean({
          rl,
          label: "startImmediately",
          fallback: DEFAULT_CONFIG.startImmediately,
        });
        continue;
      }
      if (key === "tmuxFilter") {
        const fallback = `clanker-${repoRoot.split("/").pop() ?? "repo"}`;
        updated.tmuxFilter = await askString({ rl, label: "tmuxFilter", fallback });
        continue;
      }
      if (key === "codexCommand") {
        updated.codexCommand = await askString({
          rl,
          label: "codexCommand",
          fallback: DEFAULT_CONFIG.codexCommand,
        });
        continue;
      }
      if (key === "promptFile") {
        updated.promptFile = await askString({ rl, label: "promptFile", fallback: "" });
      }
    }
  } finally {
    rl.close();
  }

  const template = formatConfigTemplate({
    config: buildTemplateConfig({ parsed: updated, repoRoot }),
  });
  await writeFile(configPath, template, "utf-8");
  return { didPrompt: true };
};
