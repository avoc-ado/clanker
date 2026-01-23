import { access } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpRepo, runCli } from "./utils.js";

describe("integration: help", () => {
  test("prints help without creating state dirs", async () => {
    const root = await makeTmpRepo({ planLines: ["Goal: help."] });
    const output = await runCli({ cwd: root, args: ["--help"] });
    expect(output).toContain("Usage:");
    await expect(access(join(root, ".clanker"))).rejects.toBeDefined();
  });
});
