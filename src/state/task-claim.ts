import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TASK_LOCK_TTL_MS = 60_000;

interface TaskLockPayload {
  key: string;
  lockedAt: string;
  pid: number;
}

export interface TaskClaim {
  release: () => Promise<void>;
}

const normalizeLockKey = ({ value }: { value: string }): string => {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const readLockTimestampMs = async ({ path }: { path: string }): Promise<number | null> => {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TaskLockPayload>;
    if (parsed.lockedAt) {
      const ts = new Date(parsed.lockedAt).getTime();
      if (Number.isFinite(ts)) {
        return ts;
      }
    }
  } catch {}
  try {
    const info = await stat(path);
    return info.mtimeMs;
  } catch {
    return null;
  }
};

const isLockStale = async ({
  path,
  nowMs,
  ttlMs,
}: {
  path: string;
  nowMs: number;
  ttlMs: number;
}): Promise<boolean> => {
  const lockedAtMs = await readLockTimestampMs({ path });
  if (!lockedAtMs) {
    return true;
  }
  return nowMs - lockedAtMs > ttlMs;
};

export const acquireTaskLock = async ({
  locksDir,
  key,
  ttlMs = TASK_LOCK_TTL_MS,
}: {
  locksDir: string;
  key: string;
  ttlMs?: number;
}): Promise<TaskClaim | null> => {
  await mkdir(locksDir, { recursive: true });
  const normalized = normalizeLockKey({ value: key });
  const path = join(locksDir, `${normalized}.lock`);
  const nowMs = Date.now();
  const payload: TaskLockPayload = {
    key,
    lockedAt: new Date(nowMs).toISOString(),
    pid: process.pid,
  };

  const writeLock = async (): Promise<TaskClaim> => {
    await writeFile(path, JSON.stringify(payload, null, 2), { encoding: "utf-8", flag: "wx" });
    return {
      release: async () => {
        await unlink(path).catch(() => {});
      },
    };
  };

  try {
    return await writeLock();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") {
      throw error;
    }
  }

  const stale = await isLockStale({ path, nowMs, ttlMs });
  if (!stale) {
    return null;
  }
  await unlink(path).catch(() => {});
  try {
    return await writeLock();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return null;
    }
    throw error;
  }
};
