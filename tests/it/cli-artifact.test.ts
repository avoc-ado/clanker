import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ensureExists, makeTmpRepo, runCliInteractive, runNode } from "./utils.js";

describe("integration: cli artifact", () => {
  test("plan names files and cli behavior matches", async () => {
    const planLines = [
      "Goal: create echo-cli that prints args to stdout.",
      "Requirement: planner must output a minimum of 2 task packets.",
      "Files: tools/echo-cli.js and tools/echo-cli.test.js.",
      "Behavior: echo-cli prints all args joined by space.",
      "Tests: use node:test to validate output.",
      "Ensure at least two tasks (no upper cap).",
    ];
    const root = await makeTmpRepo({ planLines });

    const toolsDir = join(root, "tools");
    const cliPath = join(toolsDir, "echo-cli.js");
    const testPath = join(toolsDir, "echo-cli.test.js");
    await mkdir(toolsDir, { recursive: true });
    await writeFile(
      cliPath,
      "const args = process.argv.slice(2);\nprocess.stdout.write(args.join(' '));\n",
      "utf-8",
    );
    await writeFile(
      testPath,
      [
        "const test = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const { execFile } = require('node:child_process');",
        "const { promisify } = require('node:util');",
        "const execFileAsync = promisify(execFile);",
        "const path = require('node:path');",
        "const cliPath = path.join(__dirname, 'echo-cli.js');",
        "",
        "test('echo-cli outputs args', async () => {",
        "  const { stdout } = await execFileAsync(process.execPath, [cliPath, 'hello', 'world']);",
        "  assert.equal(stdout.trim(), 'hello world');",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await runCliInteractive({
      cwd: root,
      args: ["resume"],
      inputLines: [],
      timeoutMs: 1500,
    });
    expect(result.timedOut).toBe(true);
    const prompt = await readFile(join(root, ".clanker", "plan-prompt.txt"), "utf-8");
    expect(prompt).toContain("tools/echo-cli.js");
    expect(prompt).toContain("tools/echo-cli.test.js");
    expect(prompt).toContain("minimum of 2 task packets");

    await ensureExists({ path: cliPath, label: "cli file" });
    await ensureExists({ path: testPath, label: "test file" });

    const testOutput = await runNode({ cwd: root, args: ["--test", testPath] });
    expect(testOutput).toContain("pass 1");

    const cliOutput = await runNode({ cwd: root, args: [cliPath, "hello", "world"] });
    expect(cliOutput.trim()).toBe("hello world");
  });
});
