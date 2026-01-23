#!/usr/bin/env node

import { runDashboard } from "./commands/dashboard.js";
import { runDoctor } from "./commands/doctor.js";
import { runLaunch } from "./commands/launch.js";
import { runPlanner } from "./commands/planner.js";
import { runHealth } from "./commands/health.js";
import { runJudge } from "./commands/judge.js";
import { runRelaunch } from "./commands/relaunch.js";
import { runSlave } from "./commands/slave.js";
import { runStatus } from "./commands/status.js";
import { runTask } from "./commands/task.js";
import { runTail } from "./commands/tail.js";
import { runResume } from "./commands/resume.js";
import { getClankerPaths } from "./paths.js";
import { ensureStateDirs } from "./state/ensure-state.js";
import { appendEvent } from "./state/events.js";
import { setRuntimeOverrides } from "./runtime/overrides.js";
import { getCliHelp } from "./cli-help.js";

interface CommandSpec {
  name: string;
  args: string[];
}

interface ParsedArgs {
  command: CommandSpec;
  helpRequested: boolean;
  overrides: {
    codexCommand?: string;
    codexTty?: boolean;
    disableCodex?: boolean;
    promptFile?: string;
  };
}

const requireFlagValue = ({ value, flag }: { value: string | undefined; flag: string }): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
};

const parseArgs = ({ argv }: { argv: string[] }): ParsedArgs => {
  const overrides: ParsedArgs["overrides"] = {};
  const remaining: string[] = [];
  let helpRequested = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "-h" || arg === "--help") {
      helpRequested = true;
      continue;
    }
    if (arg === "--codex-command") {
      overrides.codexCommand = requireFlagValue({ value: argv[i + 1], flag: "--codex-command" });
      i += 1;
      continue;
    }
    if (arg.startsWith("--codex-command=")) {
      overrides.codexCommand = requireFlagValue({
        value: arg.slice("--codex-command=".length),
        flag: "--codex-command",
      });
      continue;
    }
    if (arg === "--codex-tty") {
      overrides.codexTty = true;
      continue;
    }
    if (arg === "--disable-codex") {
      overrides.disableCodex = true;
      continue;
    }
    if (arg === "--prompt-file") {
      overrides.promptFile = requireFlagValue({ value: argv[i + 1], flag: "--prompt-file" });
      i += 1;
      continue;
    }
    if (arg.startsWith("--prompt-file=")) {
      overrides.promptFile = requireFlagValue({
        value: arg.slice("--prompt-file=".length),
        flag: "--prompt-file",
      });
      continue;
    }
    remaining.push(arg);
  }
  const [name, ...args] = remaining;
  return {
    command: {
      name: name ?? "",
      args,
    },
    helpRequested,
    overrides,
  };
};

const reportFatal = async ({ label, error }: { label: string; error: unknown }): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`${label}: ${message}`);
  if (stack) {
    console.error(stack);
  }
  try {
    const repoRoot = process.cwd();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "FATAL",
        msg: `${label}: ${message}`,
        data: stack ? { stack } : undefined,
      },
    });
  } catch {}
};

process.on("uncaughtException", (error) => {
  void reportFatal({ label: "uncaughtException", error }).finally(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (error) => {
  void reportFatal({ label: "unhandledRejection", error }).finally(() => {
    process.exit(1);
  });
});

const main = async ({ argv }: { argv: string[] }): Promise<void> => {
  const parsed = parseArgs({ argv });
  if (parsed.helpRequested || parsed.command.name === "help") {
    console.log(getCliHelp());
    return;
  }
  setRuntimeOverrides({ overrides: parsed.overrides });
  const command = parsed.command;

  switch (command.name) {
    case "dashboard": {
      await runDashboard({});
      return;
    }
    case "slave": {
      const [idRaw] = command.args;
      await runSlave({ idRaw });
      return;
    }
    case "status": {
      await runStatus({});
      return;
    }
    case "doctor": {
      await runDoctor({ args: command.args });
      return;
    }
    case "planner": {
      await runPlanner();
      return;
    }
    case "judge": {
      await runJudge();
      return;
    }
    case "health": {
      await runHealth();
      return;
    }
    case "tail": {
      await runTail({ args: command.args });
      return;
    }
    case "resume": {
      await runResume();
      return;
    }
    case "relaunch": {
      await runRelaunch({ args: command.args });
      return;
    }
    case "task": {
      await runTask({ args: command.args });
      return;
    }
    case "":
    default: {
      await runLaunch();
      return;
    }
  }
};

void main({ argv: process.argv.slice(2) }).catch((error) => {
  void reportFatal({ label: "command failed", error }).finally(() => {
    process.exit(1);
  });
});
