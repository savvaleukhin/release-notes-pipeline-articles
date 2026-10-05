# release-notes-pipeline-articles

Companion monorepo for **Workflows on the Record** — a six-piece article arc on
TypeScript `@google/adk` workflow primitives, where every workflow ships with its
logging story and its evals story (CI and production).

The pipeline: ingest commits/PRs from a real repo → triage → generate release
notes → human review → publish. Each article builds one stage; the final piece
composes them end to end.

## Layout

Two scopes keep the helper boundary visible:

- `evidence/*` — `@evidence/*`: domain-free observability/evals helpers, extracted
  on the page where a gap forces them. Clusters: `tracing` (H1–H2), `harness`
  (H3–H6), `assert` (H7), `grader` (H8).
- `release-notes/*` — `@release-notes/*`: the pipeline's stage apps (`generate`,
  `review`, `triage`, `ingest`, `pipeline`) and `fixtures`.

Packages are workspace-resident: no article requires an npm publish.

## Commands

- `pnpm test` — run all tests (vitest)
- `pnpm typecheck` — build project references
