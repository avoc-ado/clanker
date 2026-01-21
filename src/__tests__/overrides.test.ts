import { getRuntimeOverrides, setRuntimeOverrides } from "../runtime/overrides.js";

describe("runtime overrides", () => {
  test("sets and reads overrides", () => {
    setRuntimeOverrides({
      overrides: {
        codexCommand: "codex --help",
        codexTty: true,
        disableCodex: true,
        promptFile: "prompt.txt",
      },
    });
    const overrides = getRuntimeOverrides();
    expect(overrides.codexCommand).toBe("codex --help");
    expect(overrides.codexTty).toBe(true);
    expect(overrides.disableCodex).toBe(true);
    expect(overrides.promptFile).toBe("prompt.txt");
  });
});
