import { chmod, mkdtemp, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireTaskLock } from "../state/task-claim.js";

const makeLocksDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "clanker-locks-"));
};

const lockPathFor = ({ locksDir, key }: { locksDir: string; key: string }): string => {
  return join(locksDir, `${key}.lock`);
};

describe("acquireTaskLock", () => {
  test("acquires and releases a lock", async () => {
    const locksDir = await makeLocksDir();
    const claim = await acquireTaskLock({ locksDir, key: "task-1" });
    expect(claim).not.toBeNull();
    await claim?.release();
    await expect(stat(lockPathFor({ locksDir, key: "task-1" }))).rejects.toThrow();
  });

  test("returns null when lock is fresh", async () => {
    const locksDir = await makeLocksDir();
    const lockPath = lockPathFor({ locksDir, key: "task-2" });
    await writeFile(
      lockPath,
      JSON.stringify({ key: "task-2", lockedAt: new Date().toISOString(), pid: 1 }, null, 2),
      "utf-8",
    );
    const claim = await acquireTaskLock({ locksDir, key: "task-2", ttlMs: 60_000 });
    expect(claim).toBeNull();
  });

  test("reclaims stale lock", async () => {
    const locksDir = await makeLocksDir();
    const lockPath = lockPathFor({ locksDir, key: "task-3" });
    const staleAt = new Date(Date.now() - 120_000).toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({ key: "task-3", lockedAt: staleAt, pid: 1 }, null, 2),
      "utf-8",
    );
    const claim = await acquireTaskLock({ locksDir, key: "task-3", ttlMs: 60_000 });
    expect(claim).not.toBeNull();
    await claim?.release();
  });

  test("reclaims stale lock when payload is invalid", async () => {
    const locksDir = await makeLocksDir();
    const lockPath = lockPathFor({ locksDir, key: "task-4" });
    await writeFile(lockPath, "bad", "utf-8");
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath, old, old);
    const claim = await acquireTaskLock({ locksDir, key: "task-4", ttlMs: 60_000 });
    expect(claim).not.toBeNull();
    await claim?.release();
  });

  test("treats missing lock target as stale", async () => {
    const locksDir = await makeLocksDir();
    const lockPath = lockPathFor({ locksDir, key: "task-5" });
    await symlink("missing-target", lockPath);
    const claim = await acquireTaskLock({ locksDir, key: "task-5", ttlMs: 60_000 });
    expect(claim).not.toBeNull();
    await claim?.release();
  });

  test("throws when lock directory is not writable", async () => {
    const locksDir = await makeLocksDir();
    await chmod(locksDir, 0o555);
    await expect(acquireTaskLock({ locksDir, key: "task-6" })).rejects.toThrow();
  });

  test("returns null when stale lock cannot be removed", async () => {
    const locksDir = await makeLocksDir();
    const lockPath = lockPathFor({ locksDir, key: "task-7" });
    const staleAt = new Date(Date.now() - 120_000).toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({ key: "task-7", lockedAt: staleAt, pid: 1 }, null, 2),
      "utf-8",
    );
    await chmod(locksDir, 0o555);
    const claim = await acquireTaskLock({ locksDir, key: "task-7", ttlMs: 60_000 });
    expect(claim).toBeNull();
  });
});
