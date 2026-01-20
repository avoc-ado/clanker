import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarball, installPackedDeps, packWorkspace, runNodeWithPnp } from "./utils.js";

describe("integration: pack", () => {
  test("packed artifact runs from clean dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-pack-"));
    const tarPath = await packWorkspace({ outDir: root });
    const pkgRoot = await extractTarball({ tarPath, outDir: join(root, "unpacked") });
    await installPackedDeps({ pkgRoot });
    const output = await runNodeWithPnp({
      cwd: pkgRoot,
      args: [join(pkgRoot, "dist", "cli.js"), "status"],
      pnpRoot: pkgRoot,
    });
    expect(output).toContain("slaves=");
  }, 20_000);
});
