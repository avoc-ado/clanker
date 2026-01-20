import { formatIdleLine } from "../tui/idle-line.js";

describe("formatIdleLine", () => {
  test("formats minutes", () => {
    expect(formatIdleLine({ idleMinutes: 5 })).toBe("5m");
  });

  test("formats hours", () => {
    expect(formatIdleLine({ idleMinutes: 120 })).toBe("2h");
  });

  test("formats days", () => {
    expect(formatIdleLine({ idleMinutes: 60 * 24 * 2 })).toBe("2d");
  });
});
