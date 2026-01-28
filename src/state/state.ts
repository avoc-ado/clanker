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
  lockConflicts: LockConflictOverrides;
  promptApprovals: PromptApprovalState;
  tasks: TaskState[];
}

export interface PromptAutoApprove {
  planner: boolean;
  judge: boolean;
  slave: boolean;
}

export interface PromptApprovalRequest {
  id: string;
  key: string;
  role: "planner" | "judge" | "slave";
  kind: "planner" | "judge-task" | "slave-task";
  prompt: string;
  dispatch: string;
  createdAt: string;
  taskId?: string;
  taskTitle?: string;
  assignedSlaveId?: string;
}

export interface PromptApprovalState {
  autoApprove: PromptAutoApprove;
  queue: PromptApprovalRequest[];
  approved?: PromptApprovalRequest | null;
}

export interface LockConflictOverrides {
  enabled?: boolean;
  blockPlanner?: boolean;
}

export const DEFAULT_STATE: ClankerState = {
  paused: true,
  pausedRoles: {
    planner: false,
    judge: false,
    slave: false,
  },
  lockConflicts: {},
  promptApprovals: {
    autoApprove: {
      planner: false,
      judge: false,
      slave: false,
    },
    queue: [],
    approved: null,
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
      lockConflicts: {
        ...DEFAULT_STATE.lockConflicts,
        ...(parsed.lockConflicts ?? {}),
      },
      promptApprovals: {
        ...DEFAULT_STATE.promptApprovals,
        ...(parsed.promptApprovals ?? {}),
        autoApprove: {
          ...DEFAULT_STATE.promptApprovals.autoApprove,
          ...(parsed.promptApprovals?.autoApprove ?? {}),
        },
        queue: parsed.promptApprovals?.queue ?? DEFAULT_STATE.promptApprovals.queue,
        approved:
          parsed.promptApprovals &&
          Object.prototype.hasOwnProperty.call(parsed.promptApprovals, "approved")
            ? (parsed.promptApprovals.approved ?? null)
            : DEFAULT_STATE.promptApprovals.approved,
      },
      tasks: parsed.tasks ?? DEFAULT_STATE.tasks,
    } satisfies ClankerState;
  } catch {
    return DEFAULT_STATE;
  }
};
