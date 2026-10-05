// @release-notes/fixtures — The Upstream: a frozen commits/PRs corpus from
// open-telemetry/opentelemetry-js (the v2.10.0 → v2.11.0 release window),
// which the pipeline runs on until piece 5's watcher replaces it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  mergedAt: string;
  labels: string[];
}

export interface ReleaseWindow {
  fromTag: string;
  fromDate: string;
  toTag: string;
  toDate: string;
}

export interface FixtureCorpus {
  /** The fixture's public name, as the articles refer to it. */
  name: string;
  repo: string;
  frozenAt: string;
  window: ReleaseWindow;
  commits: Commit[];
  pullRequests: PullRequest[];
}

const corpusPath = fileURLToPath(new URL("../data/corpus.json", import.meta.url));

export function loadCorpus(): FixtureCorpus {
  return JSON.parse(readFileSync(corpusPath, "utf8")) as FixtureCorpus;
}
