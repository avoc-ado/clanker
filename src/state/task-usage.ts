import type { TaskRecord, TaskUsage } from "./tasks.js";

export interface TaskUsageInput {
  tokens?: number;
  cost?: number;
  judgeTokens?: number;
  judgeCost?: number;
}

export const hasUsage = ({ usage }: { usage: TaskUsageInput | undefined }): boolean => {
  if (!usage) {
    return false;
  }
  return (
    typeof usage.tokens === "number" ||
    typeof usage.cost === "number" ||
    typeof usage.judgeTokens === "number" ||
    typeof usage.judgeCost === "number"
  );
};

export const mergeTaskUsage = ({
  task,
  usage,
}: {
  task: TaskRecord;
  usage: TaskUsageInput;
}): TaskUsage => {
  return {
    tokens: usage.tokens ?? task.usage?.tokens ?? 0,
    cost: usage.cost ?? task.usage?.cost ?? 0,
    judgeTokens: usage.judgeTokens ?? task.usage?.judgeTokens,
    judgeCost: usage.judgeCost ?? task.usage?.judgeCost,
  };
};

export const applyTaskUsage = ({
  task,
  usage,
}: {
  task: TaskRecord;
  usage: TaskUsageInput;
}): TaskUsage | null => {
  if (!hasUsage({ usage })) {
    return null;
  }
  const next = mergeTaskUsage({ task, usage });
  task.usage = next;
  return next;
};
