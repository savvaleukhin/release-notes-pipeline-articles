import { describe, expect, it } from "vitest";
import { loadCorpus } from "@release-notes/fixtures";

describe("the named fixture", () => {
  const corpus = loadCorpus();

  it("is The Upstream, frozen from opentelemetry-js", () => {
    expect(corpus.name).toBe("The Upstream");
    expect(corpus.repo).toBe("open-telemetry/opentelemetry-js");
    expect(corpus.window.fromTag).toBe("v2.10.0");
    expect(corpus.window.toTag).toBe("v2.11.0");
  });

  it("holds the full release window", () => {
    expect(corpus.commits.length).toBe(59);
    expect(corpus.pullRequests.length).toBe(58);
    for (const pr of corpus.pullRequests) {
      expect(pr.mergedAt >= corpus.window.fromDate).toBe(true);
      expect(pr.mergedAt <= corpus.window.toDate).toBe(true);
    }
  });
});
