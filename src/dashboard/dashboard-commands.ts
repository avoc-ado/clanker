import type { ClankerPaths } from "../paths.js";
import { loadTask } from "../state/tasks.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { appendHistoryEntry, saveCommandHistory } from "../state/command-history.js";
import {
  filterSlashCommands,
  formatSlashCommandList,
  parseSlashInput,
  type SlashCommandDefinition,
} from "../commands/slash-commands.js";
import { ClankerRole } from "../prompting/role-prompts.js";

export interface SlashCommandHandler extends SlashCommandDefinition {
  run: ({ args }: { args: string }) => Promise<string | null> | string | null;
}

export type CommandHandler = (value: string) => void;

export const buildDashboardCommands = ({
  paths,
  writeLine,
  setPaused,
  toggleFocus,
  runRelaunch,
  getAutoApprove,
  setAutoApprove,
}: {
  paths: ClankerPaths;
  writeLine: (line: string) => void;
  setPaused: ({ paused, role }: { paused: boolean; role: ClankerRole | "all" }) => Promise<void>;
  toggleFocus: () => Promise<void>;
  runRelaunch: ({ args }: { args: string[] }) => Promise<void>;
  getAutoApprove: () => Promise<{ planner: boolean; judge: boolean; slave: boolean }>;
  setAutoApprove: ({
    role,
    enabled,
  }: {
    role: "planner" | "judge" | "slave";
    enabled: boolean;
  }) => Promise<void>;
}): SlashCommandHandler[] => {
  const parseRoleArg = ({ args, commandName }: { args: string; commandName: string }) => {
    const token = args.trim().split(/\s+/)[0];
    if (!token) {
      return "all";
    }
    if (token === "planner") {
      return ClankerRole.Planner;
    }
    if (token === "judge") {
      return ClankerRole.Judge;
    }
    if (token === "slave") {
      return ClankerRole.Slave;
    }
    writeLine(`usage: /${commandName} [planner|judge|slave]`);
    return null;
  };
  const parseAutoApproveRole = ({
    token,
  }: {
    token: string;
  }): "planner" | "judge" | "slave" | null => {
    if (token === "planner") {
      return "planner";
    }
    if (token === "judge") {
      return "judge";
    }
    if (token === "slave") {
      return "slave";
    }
    return null;
  };

  const commands: SlashCommandHandler[] = [];
  const writeHelp = () => {
    writeLine(formatSlashCommandList({ commands }).join("\n"));
    return "listed commands";
  };
  commands.push({
    name: "help",
    description: "list dashboard slash commands",
    usage: "/help",
    run: writeHelp,
  });
  commands.push(
    {
      name: "resume",
      description: "resume queued work",
      usage: "/resume",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "resume" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: false, role });
        return "resumed work";
      },
    },
    {
      name: "pause",
      description: "pause new work",
      usage: "/pause",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "pause" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: true, role });
        return "paused work";
      },
    },
    {
      name: "auto-approve",
      description: "toggle prompt auto-approval per role",
      usage: "/auto-approve [status|planner|judge|slave] [on|off]",
      run: async ({ args }) => {
        const tokens = args
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 0);
        if (tokens.length === 0 || tokens[0] === "status") {
          const status = await getAutoApprove();
          writeLine(
            `auto-approve planner=${status.planner ? "on" : "off"} judge=${status.judge ? "on" : "off"} slave=${status.slave ? "on" : "off"}`,
          );
          return "auto-approve status";
        }
        if (tokens.length < 2) {
          writeLine("usage: /auto-approve [status|planner|judge|slave] [on|off]");
          return null;
        }
        const roleToken = tokens[0] ?? "";
        const role = parseAutoApproveRole({ token: roleToken });
        if (!role) {
          writeLine("usage: /auto-approve [status|planner|judge|slave] [on|off]");
          return null;
        }
        const toggle = tokens[1]?.toLowerCase();
        if (toggle !== "on" && toggle !== "off") {
          writeLine("usage: /auto-approve [status|planner|judge|slave] [on|off]");
          return null;
        }
        await setAutoApprove({ role, enabled: toggle === "on" });
        return `auto-approve ${role} ${toggle}`;
      },
    },
    {
      name: "focus",
      description: "toggle focus to last active slave pane",
      usage: "/focus",
      run: async () => {
        await toggleFocus();
        return "toggled focus";
      },
    },
    {
      name: "relaunch",
      description: "relaunch codex agents",
      usage: "/relaunch [--fresh] [target]",
      run: async ({ args }) => {
        const parts = args.length > 0 ? args.split(/\s+/) : [];
        await runRelaunch({ args: parts });
        return "relaunch requested";
      },
    },
    {
      name: "task",
      description: "set a task status",
      usage: "/task <id> <status>",
      run: async ({ args }) => {
        const [id, status] = args.split(/\s+/);
        if (!id || !status) {
          writeLine("usage: /task <id> <status>");
          return null;
        }
        if (!TASK_SCHEMA.status.includes(status)) {
          writeLine(`invalid status: ${status}`);
          return null;
        }
        const task = await loadTask({ tasksDir: paths.tasksDir, id });
        if (!task) {
          writeLine(`task not found: ${id}`);
          return null;
        }
        await transitionTaskStatus({ task, status: status as typeof task.status, paths });
        return `task ${id} -> ${status}`;
      },
    },
  );
  return commands;
};

export const makeDashboardCommandHandler = ({
  commands,
  commandHistory,
  commandHistoryPath,
  maxEntries,
  writeLine,
  onHistoryUpdated,
  formatLine,
}: {
  commands: SlashCommandHandler[];
  commandHistory: string[];
  commandHistoryPath: string;
  maxEntries: number;
  writeLine: (line: string) => void;
  onHistoryUpdated: (history: string[]) => void;
  formatLine?: (line: string) => string;
}): CommandHandler => {
  const formatOutput = formatLine ?? ((line: string) => line);
  return (raw: string) => {
    const value = raw.trim();
    if (!value) {
      return;
    }
    const parsed = parseSlashInput({ input: value });
    if (!parsed.hasLeadingSlash) {
      writeLine(formatOutput("commands must start with '/'"));
      return;
    }

    const nextHistory = appendHistoryEntry({
      entries: commandHistory,
      entry: value,
      maxEntries,
    });
    commandHistory.splice(0, commandHistory.length, ...nextHistory);
    onHistoryUpdated(commandHistory);
    void saveCommandHistory({ path: commandHistoryPath, entries: commandHistory, maxEntries });

    if (parsed.name.length === 0) {
      const lines = formatSlashCommandList({ commands });
      writeLine(formatOutput(["commands:", ...lines].join("\n")));
      return;
    }

    const { exact, matches } = filterSlashCommands({ commands, token: parsed.name });
    if (!exact || exact.name.toLowerCase() !== parsed.name.toLowerCase()) {
      if (matches.length > 0) {
        const lines = formatSlashCommandList({ commands: matches });
        writeLine(formatOutput([`matches for /${parsed.name}:`, ...lines].join("\n")));
      } else {
        writeLine(formatOutput(`unknown command: /${parsed.name}`));
      }
      return;
    }

    const runArgs = parsed.rest.trim();
    const commandLabel = runArgs.length > 0 ? `/${exact.name} ${runArgs}` : `/${exact.name}`;
    Promise.resolve(exact.run({ args: runArgs }))
      .then((result) => {
        if (!result) {
          return;
        }
        writeLine(formatOutput(`ran ${commandLabel} (${result})`));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writeLine(formatOutput(`command failed: ${message}`));
      });
  };
};
