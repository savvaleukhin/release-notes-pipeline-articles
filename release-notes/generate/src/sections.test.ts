import { describe, expect, it } from "vitest";
import type { ChangeEntry } from "./changes.js";
import { sectionize } from "./sections.js";

function entry(overrides: Partial<ChangeEntry>): ChangeEntry {
  return {
    prNumber: 1,
    title: "fix: x",
    kind: "fix",
    scope: undefined,
    summary: "x",
    breaking: false,
    ...overrides,
  };
}

describe("sectionize", () => {
  it("groups entries by kind, with breaking changes pulled into their own section", () => {
    const entries = [
      entry({ prNumber: 1, kind: "feature" }),
      entry({ prNumber: 2, kind: "fix", breaking: true }),
      entry({ prNumber: 3, kind: "fix" }),
      entry({ prNumber: 4, kind: "dependencies" }),
      entry({ prNumber: 5, kind: "docs" }),
      entry({ prNumber: 6, kind: "other" }),
    ];
    const sections = sectionize(entries);
    expect(sections.breaking.map((e) => e.prNumber)).toEqual([2]);
    expect(sections.features.map((e) => e.prNumber)).toEqual([1]);
    expect(sections.fixes.map((e) => e.prNumber)).toEqual([3]);
    expect(sections.dependencies.map((e) => e.prNumber)).toEqual([4]);
    expect(sections.docs.map((e) => e.prNumber)).toEqual([5]);
    expect(sections.other.map((e) => e.prNumber)).toEqual([6]);
  });

  it("places a breaking entry only in the breaking section", () => {
    const sections = sectionize([entry({ prNumber: 2, kind: "feature", breaking: true })]);
    expect(sections.breaking).toHaveLength(1);
    expect(sections.features).toHaveLength(0);
  });
});
