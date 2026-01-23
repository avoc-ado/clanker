import { readFile, writeFile } from "node:fs/promises";

export interface TaskState {
  id: string;
  status:
    | "queued"
    | "running"
    | "needs_judge"
    | "rework"
    | "done"
    | "blocked"
    | "paused"
    | "failed";
  assignedSlaveId?: string;
  title?: string;
}

export interface ClankerState {
  paused: boolean;
  pausedRoles: {
    planner: boolean;
    judge: boolean;
    slave: boolean;
  };
  tasks: TaskState[];
}

export const DEFAULT_STATE: ClankerState = {
  paused: true,
  pausedRoles: {
    planner: false,
    judge: false,
    slave: false,
  },
  tasks: [],
};

export const saveState = async ({
  statePath,
  state,
}: {
  statePath: string;
  state: ClankerState;
}): Promise<void> => {
  const payload = JSON.stringify(state, null, 2);
  await writeFile(statePath, payload, "utf-8");
};

export const loadState = async ({ statePath }: { statePath: string }): Promise<ClankerState> => {
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ClankerState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      pausedRoles: {
        ...DEFAULT_STATE.pausedRoles,
        ...(parsed.pausedRoles ?? {}),
      },
      tasks: parsed.tasks ?? DEFAULT_STATE.tasks,
    } satisfies ClankerState;
  } catch {
    return DEFAULT_STATE;
  }
};
