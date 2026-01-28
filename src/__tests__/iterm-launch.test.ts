import { jest } from "@jest/globals";

const execFileMock = jest.fn();

jest.unstable_mockModule("node:child_process", () => ({
  execFile: execFileMock,
}));

const { launchIterm } = await import("../iterm.js");

describe("launchIterm", () => {
  test("throws friendly error when osascript fails", async () => {
    execFileMock.mockReset();
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        callback(new Error("missing iterm"));
      }
    });
    await expect(launchIterm({ cwd: "/tmp/repo", commands: ["echo one"] })).rejects.toThrow(
      "iTerm2 is required on macOS",
    );
  });
});
