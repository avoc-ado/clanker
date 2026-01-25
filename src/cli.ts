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
import { getRepoRoot } from "./repo-root.js";
import yargs from "yargs";

interface CommandSpec {
  name: string;
  args: string[];
}

interface ParsedArgs {
  command: CommandSpec;
  helpRequested: boolean;
  attachRequested: boolean;
  tmuxRequested: boolean;
  overrides: {
    codexCommand?: string;
    codexTty?: boolean;
    disableCodex?: boolean;
    promptFile?: string;
  };
}

const parseArgs = ({ argv }: { argv: string[] }): ParsedArgs => {
  const parser = yargs(argv)
    .parserConfiguration({ "unknown-options-as-args": true })
    .option("codex-command", { type: "string" })
    .option("codex-tty", { type: "boolean", default: false })
    .option("disable-codex", { type: "boolean", default: false })
    .option("prompt-file", { type: "string" })
    .option("attach", { type: "boolean", default: false })
    .option("tmux", { type: "boolean", default: false })
    .option("help", { type: "boolean", alias: "h", default: false })
    .help(false)
    .version(false);
  const parsed = parser.parseSync();
  const rawArgs = parsed._ as unknown[];
  const parsedArgs = rawArgs.map((value) => String(value));
  const [name, ...args] = parsedArgs;
  return {
    command: {
      name: name ?? "",
      args,
    },
    helpRequested: Boolean(parsed.help),
    attachRequested: Boolean(parsed.attach),
    tmuxRequested: Boolean(parsed.tmux),
    overrides: {
      codexCommand: parsed.codexCommand ? String(parsed.codexCommand) : undefined,
      codexTty: parsed.codexTty ? true : undefined,
      disableCodex: parsed.disableCodex ? true : undefined,
      promptFile: parsed.promptFile ? String(parsed.promptFile) : undefined,
    },
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
    const repoRoot = getRepoRoot();
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
      const [idRaw] = command.args;
      await runPlanner({ idRaw });
      return;
    }
    case "judge": {
      const [idRaw] = command.args;
      await runJudge({ idRaw });
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
      const forceTmux = parsed.attachRequested || parsed.tmuxRequested;
      await runLaunch({ attach: parsed.attachRequested, forceTmux });
      return;
    }
  }
};

void main({ argv: process.argv.slice(2) }).catch((error) => {
  void reportFatal({ label: "command failed", error }).finally(() => {
    process.exit(1);
  });
});
