// CI for the generate stage, piece 1 style: bare vitest over `session.events`.
// No harness — the runner is driven directly and every assertion reads the
// persisted event stream.

import { beforeAll, describe, expect, it } from "vitest";
import {
  BaseLlm,
  InMemorySessionService,
  Runner,
  type BaseLlmConnection,
  type Event,
  type LlmRequest,
  type LlmResponse,
  type Session,
} from "@google/adk";
import { loadCorpus } from "@release-notes/fixtures";
import { buildGenerateWorkflow, type DraftInput } from "./workflow.js";

/**
 * A deterministic stand-in for the draft model: renders the sections exactly
 * as the draft agent's instruction demands. The pipeline around the model is
 * what these tests pin down; the model itself is piece 4's problem. It is a
 * `BaseLlm`, not a `beforeModelCallback` stub, because the agent resolves a
 * model *name* (API key and all) while building the request — before any
 * callback could short-circuit the call.
 */
class ObedientDraftModel extends BaseLlm {
  constructor() {
    super({ model: "obedient-draft-model" });
  }

  override async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const input = lastJsonUserTurn(llmRequest);
    const lines: string[] = [`# Release notes: ${input.window.fromTag} → ${input.window.toTag}`];
    if (input.highlights?.length) {
      lines.push("", "## Highlights");
      for (const h of input.highlights) lines.push(`- ${h}`);
    }
    const order = [
      ["Breaking Changes", input.sections.breaking],
      ["Features", input.sections.features],
      ["Fixes", input.sections.fixes],
      ["Documentation", input.sections.docs],
      ["Dependencies", input.sections.dependencies],
      ["Other", input.sections.other],
    ] as const;
    for (const [heading, entries] of order) {
      if (entries.length === 0) continue;
      lines.push("", `## ${heading}`);
      for (const entry of entries) lines.push(`- ${entry.summary} (#${entry.prNumber})`);
    }
    yield {
      content: { role: "model", parts: [{ text: lines.join("\n") }] },
      turnComplete: true,
    };
  }

  override connect(): Promise<BaseLlmConnection> {
    throw new Error("live connections are not part of this stage's CI");
  }
}

function lastJsonUserTurn(llmRequest: LlmRequest): DraftInput {
  const texts: string[] = [];
  for (const content of llmRequest.contents ?? []) {
    for (const part of content.parts ?? []) {
      if (typeof part.text === "string") texts.push(part.text);
    }
  }
  for (const text of texts.reverse()) {
    try {
      const parsed = JSON.parse(text) as DraftInput;
      if (parsed && typeof parsed === "object" && "sections" in parsed) return parsed;
    } catch {
      // not the JSON turn; keep looking
    }
  }
  throw new Error(`no draft input found in llmRequest contents: ${JSON.stringify(llmRequest.contents)}`);
}

const APP = "release-notes";
const USER = "ci";

async function runGenerate(): Promise<{ session: Session; yielded: Event[] }> {
  const sessionService = new InMemorySessionService();
  const session = await sessionService.createSession({ appName: APP, userId: USER });
  const runner = new Runner({
    appName: APP,
    agent: buildGenerateWorkflow({ model: new ObedientDraftModel() }),
    sessionService,
  });
  const yielded: Event[] = [];
  for await (const event of runner.runAsync({
    userId: USER,
    sessionId: session.id,
    newMessage: { role: "user", parts: [{ text: "generate the release notes" }] },
  })) {
    yielded.push(event);
  }
  const after = await sessionService.getSession({ appName: APP, userId: USER, sessionId: session.id });
  if (!after) throw new Error("session vanished");
  return { session: after, yielded };
}

describe("the generate workflow over The Upstream", () => {
  let session: Session;

  beforeAll(async () => {
    ({ session } = await runGenerate());
  });

  it("executes every stage of the graph, in order, on the event stream", () => {
    const paths = session.events
      .map((e) => e.nodeInfo?.path)
      .filter((p): p is string => p !== undefined);
    const stages = ["ingest", "classify", "sectionize", "highlight", "draft"];
    const firstSeen = stages.map((stage) => paths.findIndex((p) => p.endsWith(stage)));
    for (const [i, stage] of stages.entries()) {
      expect(firstSeen[i], `no event from node '${stage}'`).toBeGreaterThanOrEqual(0);
    }
    expect(firstSeen, "stages out of order").toEqual([...firstSeen].sort((a, b) => a - b));
  });

  it("records the routing decision on the event stream: The Upstream window is a breaking release", () => {
    const routed = session.events.filter((e) => e.route !== undefined);
    expect(routed.map((e) => e.route)).toContain("breaking");
  });

  it("drafts notes that carry every changelog-worthy PR exactly once", () => {
    // The oracle is the corpus plus the one labelling rule — deliberately NOT
    // classifyPullRequest, which the workflow itself runs. An oracle derived
    // from the code under test shrinks together with its bugs: an earlier
    // draft of this test did exactly that and waved through a classifier that
    // silently dropped unparseable titles.
    const corpus = loadCorpus();
    const expected = corpus.pullRequests.filter((pr) => !pr.labels.includes("Skip Changelog"));
    expect(expected.length).toBeGreaterThan(0);

    const notes = finalNotes(session.events);
    for (const pr of expected) {
      const marker = `(#${pr.number})`;
      const occurrences = notes.split(marker).length - 1;
      expect(occurrences, `PR #${pr.number} ("${pr.title}") in notes`).toBe(1);
    }
  });

  it("keeps Skip Changelog PRs out of the notes", () => {
    const corpus = loadCorpus();
    const skipped = corpus.pullRequests.filter((pr) => pr.labels.includes("Skip Changelog"));
    expect(skipped.length).toBeGreaterThan(0);

    const notes = finalNotes(session.events);
    for (const pr of skipped) {
      expect(notes, `PR #${pr.number} is labelled Skip Changelog`).not.toContain(`(#${pr.number})`);
    }
  });
});

function finalNotes(events: Event[]): string {
  for (const event of [...events].reverse()) {
    if (typeof event.output === "string" && event.output.length > 0) return event.output;
  }
  throw new Error(
    `no event carries the drafted notes; node paths seen: ${JSON.stringify(
      events.map((e) => e.nodeInfo?.path),
    )}`,
  );
}
