import { jest } from "@jest/globals";

const execFileMock = jest.fn<
  void,
  [
    string,
    string[] | undefined,
    { cwd?: string } | undefined,
    (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ]
>();
const execFileErrors: Array<Error | null> = [];

jest.unstable_mockModule("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[] | undefined,
    options: { cwd?: string } | undefined,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    const resolvedCallback =
      typeof options === "function"
        ? (options as (error: Error | null, result: { stdout: string; stderr: string }) => void)
        : callback;
    const resolvedOptions =
      typeof options === "function" ? undefined : (options as { cwd?: string } | undefined);
    execFileMock(file, args, resolvedOptions, resolvedCallback ?? (() => undefined));
    const nextError = execFileErrors.shift() ?? null;
    if (resolvedCallback) {
      resolvedCallback(nextError, { stdout: "", stderr: "" });
    }
    return {} as unknown;
  },
}));

const { launchIterm } = await import("../iterm.js");

describe("launchIterm", () => {
  beforeEach(() => {
    execFileMock.mockClear();
    execFileErrors.length = 0;
    process.env.CLANKER_ITERM_STUB_COMMAND = "cd '/tmp/repo'; echo one";
    delete process.env.CLANKER_IT_MODE;
  });

  afterEach(() => {
    delete process.env.CLANKER_ITERM_STUB_COMMAND;
    delete process.env.CLANKER_IT_MODE;
  });

  test("runs stub command when configured", async () => {
    await launchIterm({ cwd: "/tmp/repo", commands: ["ignored"] });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0] ?? [];
    expect(file).toBe("sh");
    expect(args).toEqual(["-c", "cd '/tmp/repo'; echo one"]);
    expect(options?.cwd).toBe("/tmp/repo");
  });

  test("runs stub mode when requested", async () => {
    delete process.env.CLANKER_ITERM_STUB_COMMAND;
    process.env.CLANKER_IT_MODE = "stub";

    await launchIterm({ cwd: "/tmp/repo", commands: ["ignored"] });

    const [file, args] = execFileMock.mock.calls[0] ?? [];
    expect(file).toBe("sh");
    expect(args?.[1]).toContain("cd '/tmp/repo'; echo one");
  });

  test("uses osascript when not stubbed", async () => {
    delete process.env.CLANKER_ITERM_STUB_COMMAND;

    await launchIterm({ cwd: "/tmp/repo", commands: ["echo one"] });

    expect(execFileMock.mock.calls[0]?.[0]).toBe("osascript");
    expect(execFileMock.mock.calls[1]?.[0]).toBe("osascript");
  });

  test("throws when iTerm is unavailable", async () => {
    delete process.env.CLANKER_ITERM_STUB_COMMAND;
    execFileErrors.push(new Error("missing iterm"));

    await expect(launchIterm({ cwd: "/tmp/repo", commands: ["echo one"] })).rejects.toThrow(
      "iTerm2 is required on macOS",
    );
  });
});
