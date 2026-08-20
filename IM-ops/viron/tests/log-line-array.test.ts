import { describe, expect, it } from "vitest";
import { filterLogLineArray, tailLogLineArray } from "../src/client/log-filter.js";

describe("log line array helpers", () => {
  it("tails and filters line arrays without joining strings", () => {
    const lines = ["alpha", "beta error", "gamma", "delta error"];
    expect(tailLogLineArray(lines, 2)).toEqual(["gamma", "delta error"]);
    expect(filterLogLineArray(lines, { keyword: "error", caseSensitive: false, before: 0, after: 0 })).toMatchObject({
      lines: ["beta error", "--", "delta error"],
      matchLineCount: 2,
      filtered: true,
      hasGaps: true,
    });
  });
});
