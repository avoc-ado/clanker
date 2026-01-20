import { readFile, writeFile } from "node:fs/promises";

export interface TaskState {
  id: string;
  status: "queued" | "running" | "needs_judge" | "rework" | "done" | "blocked" | "paused" | "handoff_fix";
  assignedSlaveId?: string;
  title?: string;
}

export interface ClankerState {
  paused: boolean;
  tasks: TaskState[];
}

export const DEFAULT_STATE: ClankerState = {
  paused: true,
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
      tasks: parsed.tasks ?? DEFAULT_STATE.tasks,
    } satisfies ClankerState;
  } catch {
    return DEFAULT_STATE;
  }
};
