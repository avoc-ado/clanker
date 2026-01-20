import { makeTmpRepo, runCli } from "./utils.js";

describe("integration: tail usage formatting", () => {
  test("tail output includes tok and judge cost", async () => {
    const root = await makeTmpRepo({ planLines: ["Goal: tail usage."] });

    await runCli({ cwd: root, args: ["task", "add", "t-tail", "do work"] });
    await runCli({
      cwd: root,
      args: [
        "task",
        "note",
        "t-tail",
        "slave",
        "--tok",
        "1500",
        "--cost",
        "2.5",
        "--judge-cost",
        "0.5",
        "note",
      ],
    });

    const output = await runCli({ cwd: root, args: ["tail", "--limit=1", "--no-follow"] });
    expect(output).toContain("tok");
    expect(output).toContain("judge $0.5");
  });
});
