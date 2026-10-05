// The generate stage as a graph on the adk-js Workflow engine: ingest the
// corpus, classify its PRs, group them into sections, route on whether the
// window carries breaking changes, and draft the notes with an LLM node.
//
//   START → ingest → classify → sectionize ─┬─ 'breaking' → highlight → draft
//                                           └─ 'routine'  ──────────────↑

import { FunctionNode, LlmAgent, Workflow, createEvent, type BaseLlm } from "@google/adk";
import { loadCorpus, type FixtureCorpus, type ReleaseWindow } from "@release-notes/fixtures";
import { classifyPullRequest, type ChangeEntry } from "./changes.js";
import { sectionize, type ReleaseSections } from "./sections.js";

export const GENERATE_WORKFLOW_NAME = "generate_release_notes";
export const DRAFT_MODEL = "gemini-2.5-flash";

export interface IngestOutput {
  window: ReleaseWindow;
  corpus: FixtureCorpus;
}

export interface ClassifyOutput {
  window: ReleaseWindow;
  entries: ChangeEntry[];
}

export interface SectionizeOutput {
  window: ReleaseWindow;
  sections: ReleaseSections;
}

/** What the draft node receives — `highlights` only on the breaking route. */
export interface DraftInput extends SectionizeOutput {
  highlights?: string[];
}

const DRAFT_INSTRUCTION = `You are the generate stage of a release-notes pipeline.
The user message is a JSON document with "window" ({fromTag, toTag}), "sections"
of change entries, and optionally "highlights".

Write markdown release notes:
- Title: "Release notes: <fromTag> → <toTag>".
- If highlights are present, open with a "Highlights" section listing them.
- Then one section per non-empty group, in this order and with these headings:
  Breaking Changes, Features, Fixes, Documentation, Dependencies, Other.
- Render every entry as "- <summary> (#<prNumber>)", exactly once each.
- Never invent an entry and never drop one.`;

export interface GenerateWorkflowOptions {
  /** The corpus to generate from; defaults to the named fixture, The Upstream. */
  corpus?: FixtureCorpus;
  /**
   * Model for the draft node; defaults to ${DRAFT_MODEL}. CI passes a
   * `BaseLlm` instance: the agent resolves a model *name* while building the
   * request — before any `beforeModelCallback` can short-circuit — and that
   * resolution demands an API key, so a name-based stub cannot be hermetic.
   */
  model?: string | BaseLlm;
}

export function buildGenerateWorkflow(options: GenerateWorkflowOptions = {}): Workflow {
  const corpus = options.corpus ?? loadCorpus();

  const ingest = new FunctionNode<unknown, IngestOutput>("ingest", () => ({
    window: corpus.window,
    corpus,
  }));

  const classify = new FunctionNode<IngestOutput, ClassifyOutput>(
    "classify",
    (_ctx, { window, corpus: c }) => ({
      window,
      entries: c.pullRequests
        .map((pr) => classifyPullRequest(pr))
        .filter((entry): entry is ChangeEntry => entry !== null),
    }),
  );

  const sectionizeNode = new FunctionNode<ClassifyOutput, SectionizeOutput>(
    "sectionize",
    (_ctx, { window, entries }) => {
      const sections = sectionize(entries);
      return createEvent({
        output: { window, sections } satisfies SectionizeOutput,
        route: sections.breaking.length > 0 ? "breaking" : "routine",
      });
    },
  );

  const highlight = new FunctionNode<SectionizeOutput, DraftInput>(
    "highlight",
    (_ctx, { window, sections }) => ({
      window,
      sections,
      highlights: sections.breaking.map((entry) => entry.summary),
    }),
  );

  const draft = new LlmAgent({
    name: "draft",
    model: options.model ?? DRAFT_MODEL,
    description: "Drafts markdown release notes from classified change sections.",
    instruction: DRAFT_INSTRUCTION,
  });

  return new Workflow({
    name: GENERATE_WORKFLOW_NAME,
    edges: [
      ["START", ingest, classify, sectionizeNode, { breaking: highlight, routine: draft }],
      [highlight, draft],
    ],
  });
}
