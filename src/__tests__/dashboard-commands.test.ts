import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDashboardCommands,
  makeDashboardCommandHandler,
} from "../dashboard/dashboard-commands.js";
import { ClankerRole } from "../prompting/role-prompts.js";

describe("dashboard commands", () => {
  test("handles slash commands and updates history", async () => {
    const lines: string[] = [];
    const pausedCalls: Array<{ paused: boolean; role: ClankerRole | "all" }> = [];
    const focusCalls: number[] = [];
    const relaunchCalls: Array<{ args: string[] }> = [];
    const setPaused = async ({ paused, role }: { paused: boolean; role: ClankerRole | "all" }) => {
      pausedCalls.push({ paused, role });
    };
    const toggleFocus = async () => {
      focusCalls.push(1);
    };
    const runRelaunch = async ({ args }: { args: string[] }) => {
      relaunchCalls.push({ args });
    };
    const getAutoApprove = async () => ({
      planner: false,
      judge: false,
      slave: false,
    });
    const setAutoApprove = async () => undefined;
    let lockSettings = { enabled: true, blockPlanner: false };
    const getLockSettings = async () => lockSettings;
    const setLockSettings = async ({
      enabled,
      blockPlanner,
    }: {
      enabled?: boolean;
      blockPlanner?: boolean;
    }) => {
      lockSettings = {
        enabled: enabled ?? lockSettings.enabled,
        blockPlanner: blockPlanner ?? lockSettings.blockPlanner,
      };
    };
    const tempDir = await mkdtemp(join(tmpdir(), "clanker-commands-"));
    const commandHistoryPath = join(tempDir, "history.json");
    const tasksDir = join(tempDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      join(tasksDir, "t1.json"),
      JSON.stringify({ id: "t1", status: "queued", prompt: "do work" }, null, 2),
      "utf-8",
    );

    const commands = buildDashboardCommands({
      paths: {
        repoRoot: tempDir,
        stateDir: join(tempDir, "state"),
        eventsLog: join(tempDir, "events.log"),
        statePath: join(tempDir, "state.json"),
        tasksDir,
        historyDir: join(tempDir, "history"),
        heartbeatDir: join(tempDir, "heartbeat"),
        metricsPath: join(tempDir, "metrics.json"),
        logsDir: join(tempDir, "logs"),
        locksDir: join(tempDir, "locks"),
        archiveDir: join(tempDir, "archive"),
        archiveTasksDir: join(tempDir, "archive", "tasks"),
        commandHistoryPath,
      },
      writeLine: (line) => lines.push(line),
      setPaused,
      toggleFocus,
      runRelaunch,
      getAutoApprove,
      setAutoApprove,
      getLockSettings,
      setLockSettings,
    });

    const commandHistory: string[] = [];
    const handler = makeDashboardCommandHandler({
      commands,
      commandHistory,
      commandHistoryPath,
      maxEntries: 10,
      writeLine: (line) => lines.push(line),
      onHistoryUpdated: (history) => {
        lines.push(`history:${history.length}`);
      },
      formatLine: (line) => `> ${line}`,
    });

    handler("hello");
    handler("   ");
    handler("/pause wrong");
    handler("/resume nope");
    handler("/resume planner");
    handler("/resume");
    handler("/pause judge");
    handler("/pause slave");
    handler("/focus");
    handler("/relaunch --fresh slave-1");
    handler("/task t1 nope");
    handler("/task t1 done");
    handler("/task");
    handler("/task missing queued");
    handler("/locks status");
    handler("/locks off");
    handler("/lock-backpressure on");
    handler("/lock-backpressure status");
    handler("/pa");
    handler("/nope");
    handler("/help");
    handler("/");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines.some((line) => line.includes("commands must start"))).toBe(true);
    expect(lines.some((line) => line.includes("usage: /pause"))).toBe(true);
    expect(pausedCalls).toContainEqual({ paused: false, role: ClankerRole.Planner });
    expect(pausedCalls).toContainEqual({ paused: false, role: "all" });
    expect(pausedCalls).toContainEqual({ paused: true, role: ClankerRole.Judge });
    expect(pausedCalls).toContainEqual({ paused: true, role: ClankerRole.Slave });
    expect(focusCalls.length).toBeGreaterThan(0);
    expect(relaunchCalls).toContainEqual({ args: ["--fresh", "slave-1"] });
    expect(commandHistory.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("invalid status"))).toBe(true);
    expect(lines.some((line) => line.includes("matches for /pa"))).toBe(true);
    expect(lines.some((line) => line.includes("unknown command"))).toBe(true);
    expect(lockSettings.enabled).toBe(false);
    expect(lockSettings.blockPlanner).toBe(true);

    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test("reports command failures", async () => {
    const lines: string[] = [];
    const commandHistory: string[] = [];
    const tempDir = await mkdtemp(join(tmpdir(), "clanker-commands-error-"));
    const handler = makeDashboardCommandHandler({
      commands: [
        {
          name: "boom",
          description: "explode",
          usage: "/boom",
          run: async () => {
            throw new Error("boom");
          },
        },
      ],
      commandHistory,
      commandHistoryPath: join(tempDir, "history.json"),
      maxEntries: 10,
      writeLine: (line) => lines.push(line),
      onHistoryUpdated: () => undefined,
    });

    handler("/boom");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines.some((line) => line.includes("command failed"))).toBe(true);

    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test("handles auto-approve toggles", async () => {
    const lines: string[] = [];
    let autoApprove = { planner: false, judge: true, slave: false };
    const tempDir = await mkdtemp(join(tmpdir(), "clanker-auto-approve-"));
    const commands = buildDashboardCommands({
      paths: {
        repoRoot: tempDir,
        stateDir: join(tempDir, "state"),
        eventsLog: join(tempDir, "events.log"),
        statePath: join(tempDir, "state.json"),
        tasksDir: join(tempDir, "tasks"),
        historyDir: join(tempDir, "history"),
        heartbeatDir: join(tempDir, "heartbeat"),
        metricsPath: join(tempDir, "metrics.json"),
        logsDir: join(tempDir, "logs"),
        locksDir: join(tempDir, "locks"),
        archiveDir: join(tempDir, "archive"),
        archiveTasksDir: join(tempDir, "archive", "tasks"),
        commandHistoryPath: join(tempDir, "command-history.json"),
      },
      writeLine: (line) => lines.push(line),
      setPaused: async () => undefined,
      toggleFocus: async () => undefined,
      runRelaunch: async () => undefined,
      getAutoApprove: async () => autoApprove,
      setAutoApprove: async ({ role, enabled }) => {
        autoApprove = { ...autoApprove, [role]: enabled };
      },
      getLockSettings: async () => ({ enabled: true, blockPlanner: false }),
      setLockSettings: async () => undefined,
    });
    const handler = makeDashboardCommandHandler({
      commands,
      commandHistory: [],
      commandHistoryPath: join(tempDir, "command-history.json"),
      maxEntries: 10,
      writeLine: (line) => lines.push(line),
      onHistoryUpdated: () => undefined,
    });

    handler("/auto-approve status");
    handler("/auto-approve planner on");
    handler("/auto-approve planner nope");
    handler("/auto-approve nope on");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines.some((line) => line.includes("auto-approve planner=off"))).toBe(true);
    expect(autoApprove.planner).toBe(true);
    expect(lines.some((line) => line.includes("usage: /auto-approve"))).toBe(true);

    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
});
