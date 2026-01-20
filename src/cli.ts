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

void main({ argv: process.argv.slice(2) });
