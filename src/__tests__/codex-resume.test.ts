import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractResumeCommand, findResumeCommand } from "../codex/resume.js";

describe("findResumeCommand", () => {
  test("returns null when no resume command present", () => {
    const text = "done\nno resume here";
    expect(findResumeCommand({ text })).toBeNull();
  });

  test("extracts resume command from line", () => {
    const text = "ok\nResume with: codex resume abc-123 --no-alt-screen";
    expect(findResumeCommand({ text })).toBe("codex resume abc-123 --no-alt-screen");
  });

  test("returns last resume command", () => {
    const text = [
      "codex resume old-1",
      "some output",
      "codex resume new-2 --sandbox workspace-write",
    ].join("\n");
    expect(findResumeCommand({ text })).toBe("codex resume new-2 --sandbox workspace-write");
  });

  test("extractResumeCommand reads file when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-resume-"));
    const logPath = join(dir, "log.txt");
    await writeFile(logPath, "codex resume abc-123\n", "utf-8");
    const command = await extractResumeCommand({ logPath });
    expect(command).toBe("codex resume abc-123");
    await rm(dir, { recursive: true, force: true });
  });

  test("extractResumeCommand returns null when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clanker-resume-missing-"));
    const logPath = join(dir, "missing.txt");
    const command = await extractResumeCommand({ logPath });
    expect(command).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
