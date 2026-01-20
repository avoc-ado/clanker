import type { TaskRecord } from "./tasks.js";

export interface LockState {
  lockedDirs: Set<string>;
  lockedFiles: Set<string>;
  lockedFileTopDirs: Set<string>;
}

const normalizePath = ({ value }: { value: string }): string => {
  return value.trim().replace(/^\.\//, "").replace(/\/+$/, "");
};

const topLevelDir = ({ value }: { value: string }): string => {
  const normalized = normalizePath({ value });
  const [head] = normalized.split("/");
  return head ?? normalized;
};

const getTaskLocks = ({ task }: { task: TaskRecord }): { dirs: string[]; files: string[] } => {
  const files = (task.ownerFiles ?? [])
    .map((file) => normalizePath({ value: file }))
    .filter((file) => file.length > 0);
  if (files.length > 0) {
    return { dirs: [], files };
  }
  const dirs = (task.ownerDirs ?? [])
    .map((dir) => topLevelDir({ value: dir }))
    .filter((dir) => dir.length > 0);
  return { dirs, files: [] };
};

export const buildLockState = ({ tasks }: { tasks: TaskRecord[] }): LockState => {
  const lockedDirs = new Set<string>();
  const lockedFiles = new Set<string>();
  const lockedFileTopDirs = new Set<string>();

  for (const task of tasks) {
    const locks = getTaskLocks({ task });
    for (const dir of locks.dirs) {
      lockedDirs.add(dir);
    }
    for (const file of locks.files) {
      lockedFiles.add(file);
      lockedFileTopDirs.add(topLevelDir({ value: file }));
    }
  }

  return { lockedDirs, lockedFiles, lockedFileTopDirs };
};

export const hasLockConflict = ({ task, lockState }: { task: TaskRecord; lockState: LockState }): boolean => {
  const locks = getTaskLocks({ task });
  if (locks.dirs.length > 0) {
    return locks.dirs.some(
      (dir) => lockState.lockedDirs.has(dir) || lockState.lockedFileTopDirs.has(dir),
    );
  }
  if (locks.files.length > 0) {
    return locks.files.some(
      (file) =>
        lockState.lockedFiles.has(file) || lockState.lockedDirs.has(topLevelDir({ value: file })),
    );
  }
  return false;
};

export const countLockConflicts = ({ tasks }: { tasks: TaskRecord[] }): number => {
  const lockCounts = new Map<string, number>();
  for (const task of tasks) {
    const locks = getTaskLocks({ task });
    const keys =
      locks.dirs.length > 0
        ? locks.dirs.map((dir) => `dir:${dir}`)
        : locks.files.map((file) => `file:${normalizePath({ value: file })}`);
    for (const key of keys) {
      lockCounts.set(key, (lockCounts.get(key) ?? 0) + 1);
    }
  }

  let conflicts = 0;
  for (const count of lockCounts.values()) {
    if (count > 1) {
      conflicts += 1;
    }
  }
  return conflicts;
};
