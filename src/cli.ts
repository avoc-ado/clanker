#!/usr/bin/env node

import { runDashboard } from "./commands/dashboard.js";
import { runDoctor } from "./commands/doctor.js";
import { runPlan } from "./commands/plan.js";
import { runPlanner } from "./commands/planner.js";
import { runHealth } from "./commands/health.js";
import { runJudge } from "./commands/judge.js";
import { runSlave } from "./commands/slave.js";
import { runStatus } from "./commands/status.js";
import { runTask } from "./commands/task.js";
import { runTail } from "./commands/tail.js";
import { runResume } from "./commands/resume.js";
import { getClankerPaths } from "./paths.js";
import { ensureStateDirs } from "./state/ensure-state.js";
import { appendEvent } from "./state/events.js";

interface CommandSpec {
  name: string;
  args: string[];
}

const parseCommand = ({ argv }: { argv: string[] }): CommandSpec => {
  const [name, ...args] = argv;
  return {
    name: name ?? "",
    args,
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
  const command = parseCommand({ argv });

  switch (command.name) {
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
    case "plan": {
      await runPlan();
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
    case "task": {
      await runTask({ args: command.args });
      return;
    }
    case "":
    default: {
      await runDashboard({});
      return;
    }
  }
};

void main({ argv: process.argv.slice(2) }).catch((error) => {
  void reportFatal({ label: "command failed", error }).finally(() => {
    process.exit(1);
  });
});
