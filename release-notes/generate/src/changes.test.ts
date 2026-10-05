import { describe, expect, it } from "vitest";
import type { PullRequest } from "@release-notes/fixtures";
import { classifyPullRequest } from "./changes.js";

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    number: 1,
    title: "fix: something",
    body: "",
    mergedAt: "2026-08-01T00:00:00Z",
    labels: [],
    ...overrides,
  };
}

describe("classifyPullRequest", () => {
  it("parses a conventional-commit title into kind, scope and summary", () => {
    const entry = classifyPullRequest(
      pr({ number: 6929, title: "feat(sdk-trace): configure force flush timeout per call" }),
    );
    expect(entry).toEqual({
      prNumber: 6929,
      title: "feat(sdk-trace): configure force flush timeout per call",
      kind: "feature",
      scope: "sdk-trace",
      summary: "configure force flush timeout per call",
      breaking: false,
    });
  });

  it("marks a bang title as breaking", () => {
    const entry = classifyPullRequest(
      pr({ number: 6930, title: "fix(sdk-node)!: fail-fast on Propagator creation from config file" }),
    );
    expect(entry?.breaking).toBe(true);
    expect(entry?.kind).toBe("fix");
  });

  it("classifies dependency updates by title or label", () => {
    const byTitle = classifyPullRequest(
      pr({ number: 6943, title: "chore(deps): update dependency @types/superagent to v8.1.11" }),
    );
    expect(byTitle?.kind).toBe("dependencies");
    const byLabel = classifyPullRequest(
      pr({ number: 6972, title: "chore: update all patch versions", labels: ["dependencies"] }),
    );
    expect(byLabel?.kind).toBe("dependencies");
  });

  it("excludes a PR labelled Skip Changelog", () => {
    const entry = classifyPullRequest(
      pr({ number: 6945, title: "docs: finalize docs", labels: ["Skip Changelog"] }),
    );
    expect(entry).toBeNull();
  });

  it("tolerates leading whitespace in a title (PR #6735 in The Upstream)", () => {
    const entry = classifyPullRequest(
      pr({ number: 6735, title: "  docs(otlp-exporter-base): document HTTP exporter options" }),
    );
    expect(entry?.kind).toBe("docs");
    expect(entry?.summary).toBe("document HTTP exporter options");
  });

  it("keeps a non-conventional title instead of dropping it", () => {
    const entry = classifyPullRequest(pr({ number: 7000, title: "Fix flaky browser test" }));
    expect(entry).toEqual({
      prNumber: 7000,
      title: "Fix flaky browser test",
      kind: "other",
      scope: undefined,
      summary: "Fix flaky browser test",
      breaking: false,
    });
  });
});
