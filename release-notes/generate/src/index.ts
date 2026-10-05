// @release-notes/generate — the generate stage: fixture commits/PRs in,
// release notes out, built as a graph on the adk-js Workflow engine.

export { classifyPullRequest, type ChangeEntry, type ChangeKind } from "./changes.js";
export { sectionize, type ReleaseSections } from "./sections.js";
export {
  buildGenerateWorkflow,
  DRAFT_MODEL,
  GENERATE_WORKFLOW_NAME,
  type ClassifyOutput,
  type DraftInput,
  type GenerateWorkflowOptions,
  type IngestOutput,
  type SectionizeOutput,
} from "./workflow.js";
