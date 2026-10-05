// Classification rules for the generate stage: a merged PR from the corpus
// becomes a change entry, or null when the repo's own conventions say it is
// not changelog-worthy ("Skip Changelog" label).

import type { PullRequest } from "@release-notes/fixtures";

export type ChangeKind = "feature" | "fix" | "docs" | "dependencies" | "other";

export interface ChangeEntry {
  prNumber: number;
  /** The PR title as merged, untouched. */
  title: string;
  kind: ChangeKind;
  scope: string | undefined;
  /** The description part of a conventional title, or the whole title. */
  summary: string;
  breaking: boolean;
}

const SKIP_LABEL = "Skip Changelog";
const CONVENTIONAL_TITLE = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const KIND_BY_TYPE: Record<string, ChangeKind> = {
  feat: "feature",
  fix: "fix",
  docs: "docs",
};

export function classifyPullRequest(pr: PullRequest): ChangeEntry | null {
  if (pr.labels.includes(SKIP_LABEL)) {
    return null;
  }
  // The Upstream ships at least one title with leading whitespace (#6735);
  // parse the trimmed title, keep the original in `title`.
  const match = CONVENTIONAL_TITLE.exec(pr.title.trim());
  if (!match) {
    // A title outside the convention is still a merged change; keep it
    // whole rather than dropping it on a parse failure.
    return {
      prNumber: pr.number,
      title: pr.title,
      kind: "other",
      scope: undefined,
      summary: pr.title,
      breaking: false,
    };
  }
  const [, type, scope, bang, summary] = match;
  let kind: ChangeKind;
  if (scope === "deps" || pr.labels.includes("dependencies")) {
    kind = "dependencies";
  } else {
    kind = KIND_BY_TYPE[type] ?? "other";
  }
  return {
    prNumber: pr.number,
    title: pr.title,
    kind,
    scope,
    summary,
    breaking: bang === "!",
  };
}
