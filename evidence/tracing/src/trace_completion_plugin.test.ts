// H1 in CI. The fixture workflows are deliberately domain-free: a router that
// picks a route, and an agent whose model explodes. The first describe pins
// the gap the plugin exists for — what the shipped spans alone do NOT say —
// so a future adk-js release closing the gap upstream fails these tests and
// retires the helper.

import { beforeAll, describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  BaseLlm,
  FunctionNode,
  InMemorySessionService,
  LlmAgent,
  Runner,
  Workflow,
  createEvent,
  type BaseLlmConnection,
  type BasePlugin,
  type LlmResponse,
} from "@google/adk";
import { TraceCompletionPlugin } from "./trace_completion_plugin.js";

/** Captures spans at start so even a span the engine leaks unended is visible. */
class CapturingSpanProcessor implements SpanProcessor {
  readonly spans: Span[] = [];
  onStart(span: Span): void {
    this.spans.push(span);
  }
  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

const capture = new CapturingSpanProcessor();

beforeAll(() => {
  const provider = new NodeTracerProvider({ spanProcessors: [capture] });
  provider.register();
});

class ExplodingLlm extends BaseLlm {
  constructor() {
    super({ model: "exploding-llm" });
  }
  // eslint-disable-next-line require-yield
  override async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
    throw new Error("the model is down");
  }
  override connect(): Promise<BaseLlmConnection> {
    throw new Error("not a live model");
  }
}

function routerWorkflow(): Workflow {
  const router = new FunctionNode<unknown, string>("router", () =>
    createEvent({ output: "went left", route: "left" }),
  );
  const left = new FunctionNode<string, string>("left", (_ctx, input) => input);
  const right = new FunctionNode<string, string>("right", (_ctx, input) => input);
  return new Workflow({
    name: "fixture",
    edges: [["START", router, { left, right }]],
  });
}

function explodingWorkflow(): Workflow {
  const boom = new LlmAgent({ name: "boom", model: new ExplodingLlm() });
  return new Workflow({ name: "fixture_error", edges: [["START", boom]] });
}

async function run(workflow: Workflow, plugins: BasePlugin[]): Promise<Span[]> {
  const before = capture.spans.length;
  const sessionService = new InMemorySessionService();
  const session = await sessionService.createSession({ appName: "fixture", userId: "ci" });
  const runner = new Runner({ appName: "fixture", agent: workflow, sessionService, plugins });
  try {
    for await (const _event of runner.runAsync({
      userId: "ci",
      sessionId: session.id,
      newMessage: { role: "user", parts: [{ text: "go" }] },
    })) {
      // drain
    }
  } catch {
    // the exploding fixture is allowed to fail its run; spans are the subject
  }
  return capture.spans.slice(before);
}

function named(spans: Span[], name: string): Span {
  const span = spans.find((s) => (s as unknown as ReadableSpan).name === name);
  if (!span) {
    throw new Error(
      `no span named '${name}'; saw: ${spans.map((s) => (s as unknown as ReadableSpan).name).join(", ")}`,
    );
  }
  return span;
}

function attrs(span: Span): Record<string, unknown> {
  return (span as unknown as ReadableSpan).attributes;
}

describe("the gap: shipped spans alone", () => {
  let spans: Span[];

  beforeAll(async () => {
    spans = await run(routerWorkflow(), []);
  });

  it("leaves the root invocation span attribute-less", () => {
    expect(attrs(named(spans, "invocation"))).toEqual({});
  });

  it("does not record the route the router chose on any span", () => {
    for (const span of spans) {
      expect(attrs(span)).not.toHaveProperty("adk.node.route");
    }
  });
});

describe("TraceCompletionPlugin", () => {
  let spans: Span[];

  beforeAll(async () => {
    spans = await run(routerWorkflow(), [new TraceCompletionPlugin()]);
  });

  it("identifies the root invocation span", () => {
    const invocation = attrs(named(spans, "invocation"));
    expect(invocation["gcp.vertex.agent.session_id"]).toBeTypeOf("string");
    expect(invocation["gcp.vertex.agent.invocation_id"]).toBeTypeOf("string");
    expect(invocation["gen_ai.conversation.id"]).toBe(invocation["gcp.vertex.agent.session_id"]);
    expect(invocation["adk.app.name"]).toBe("fixture");
    expect(invocation["adk.user.id"]).toBe("ci");
  });

  it("puts the routing decision on the router's own span", () => {
    expect(attrs(named(spans, "execute_node router"))["adk.node.route"]).toBe("left");
  });

  it("leaves spans of nodes that emit no route untouched", () => {
    expect(attrs(named(spans, "execute_node left"))).not.toHaveProperty("adk.node.route");
  });
});

describe("TraceCompletionPlugin on a model error", () => {
  let spans: Span[];

  beforeAll(async () => {
    spans = await run(explodingWorkflow(), [new TraceCompletionPlugin()]);
  });

  it("records the exception on the call_llm span and marks it failed", () => {
    const callLlm = named(spans, "call_llm") as unknown as ReadableSpan;
    const exception = callLlm.events.find((e) => e.name === "exception");
    expect(exception, "exception event on call_llm").toBeDefined();
    expect(exception?.attributes?.["exception.message"]).toBe("the model is down");
    expect(callLlm.status.code).toBe(2); // SpanStatusCode.ERROR
  });
});
