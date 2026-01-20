import { computeSlaveCap } from "../scheduler.js";

describe("computeSlaveCap", () => {
  test("caps by readyCount", () => {
    const cap = computeSlaveCap({
      slaveCap: 5,
      readyCount: 2,
      phase: "execute",
      conflictRate: 0,
      integrationBacklog: 0,
      tokenBurnPerMin: 0,
      burnCap: 100,
    });
    expect(cap).toBe(2);
  });

  test("throttles in integrate phase", () => {
    const cap = computeSlaveCap({
      slaveCap: 6,
      readyCount: 6,
      phase: "integrate",
      conflictRate: 0,
      integrationBacklog: 0,
      tokenBurnPerMin: 0,
      burnCap: 100,
    });
    expect(cap).toBe(2);
  });

  test("burn cap reduces by 1", () => {
    const cap = computeSlaveCap({
      slaveCap: 3,
      readyCount: 3,
      phase: "execute",
      conflictRate: 0,
      integrationBacklog: 0,
      tokenBurnPerMin: 200,
      burnCap: 100,
    });
    expect(cap).toBe(2);
  });

  test("expands in explore phase", () => {
    const cap = computeSlaveCap({
      slaveCap: 5,
      readyCount: 4,
      phase: "explore",
      conflictRate: 0,
      integrationBacklog: 0,
      tokenBurnPerMin: 0,
      burnCap: 100,
    });
    expect(cap).toBe(5);
  });

  test("throttles on conflict or backlog", () => {
    const cap = computeSlaveCap({
      slaveCap: 6,
      readyCount: 6,
      phase: "execute",
      conflictRate: 0.2,
      integrationBacklog: 1,
      tokenBurnPerMin: 0,
      burnCap: 100,
    });
    expect(cap).toBe(2);
  });
});
