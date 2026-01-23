import { formatDateDivider, formatShortTime } from "../dashboard/stream-format.js";

describe("stream format", () => {
  test("formatShortTime uses HH:MM", () => {
    const date = new Date(2025, 0, 2, 3, 4, 5);
    expect(formatShortTime({ date })).toBe("03:04");
  });

  test("formatDateDivider includes label", () => {
    const date = new Date(2025, 0, 2, 3, 4, 5);
    const divider = formatDateDivider({ date });
    expect(divider).toContain("----");
    expect(divider).toContain("2025");
  });
});
