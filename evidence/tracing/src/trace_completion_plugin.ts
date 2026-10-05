// H1: the trace-completion plugin.
//
// In @google/adk 2.2.0 the workflow engine's node spans are the richest in
// the stack, yet they go silent at exactly the interesting places: the root
// `invocation` span carries no attributes, the route a node emits (the thing
// edges match on) lives only on the event stream, a node's branch never
// reaches a span, a model or tool error ends its span UNSET, and an agent
// transfer is event-only. Everything below writes onto the engine's own spans
// what today only `session.events` carries — a pure plugin over the shipped
// 17-hook surface, no engine patching, attribute names matching the engine's
// own `adk.node.*` / `gcp.vertex.agent.*` vocabulary.
//
// Reach: the engine binds each span into the active OTel context around the
// matching plugin hook, so `trace.getActiveSpan()` is the seam. One shipped
// limitation is unfixable from a plugin: `onToolErrorCallback` fires after
// the `execute_tool` span has already ended, so a tool error is recorded on
// the nearest live enclosing span instead, tagged with the tool's name.

import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import {
  BasePlugin,
  type BaseNode,
  type BaseTool,
  type Event,
  type InvocationContext,
  type NodeContext,
} from "@google/adk";

export const ADK_NODE_ROUTE = "adk.node.route";
export const ADK_NODE_BRANCH = "adk.node.branch";
export const ADK_APP_NAME = "adk.app.name";
export const ADK_USER_ID = "adk.user.id";
export const ADK_TRANSFER_EVENT = "adk.transfer_to_agent";
export const ADK_TRANSFER_TARGET = "adk.transfer.target";

export class TraceCompletionPlugin extends BasePlugin {
  constructor() {
    super("trace_completion");
  }

  /** The bare root `invocation` span: say which invocation this is. */
  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<undefined> {
    const span = activeSpan();
    if (span) {
      const session = invocationContext.session;
      span.setAttributes({
        "gcp.vertex.agent.invocation_id": invocationContext.invocationId,
        "gcp.vertex.agent.session_id": session.id,
        "gen_ai.conversation.id": session.id,
        [ADK_APP_NAME]: session.appName,
        [ADK_USER_ID]: session.userId,
      });
    }
    return undefined;
  }

  /** Branch goes on early, so it survives a node that later throws. */
  override async beforeNodeCallback({
    nodeContext,
  }: {
    node: BaseNode;
    nodeContext: NodeContext;
    input: unknown;
  }): Promise<undefined> {
    const span = activeSpan();
    if (span && nodeContext.branch !== undefined) {
      span.setAttribute(ADK_NODE_BRANCH, nodeContext.branch);
    }
    // undefined, always: any other value would skip the node's body.
    return undefined;
  }

  /** The routing decision, on the span of the node that made it. */
  override async afterNodeCallback({
    nodeContext,
  }: {
    node: BaseNode;
    nodeContext: NodeContext;
    output: unknown;
  }): Promise<undefined> {
    const span = activeSpan();
    if (span && nodeContext.route !== undefined) {
      span.setAttribute(
        ADK_NODE_ROUTE,
        Array.isArray(nodeContext.route) ? nodeContext.route.map(String) : String(nodeContext.route),
      );
    }
    return undefined;
  }

  /** A model error reaches its `call_llm` span instead of ending it UNSET. */
  override async onModelErrorCallback({ error }: { error: Error }): Promise<undefined> {
    const span = activeSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }
    // undefined: observe the error, never swallow it.
    return undefined;
  }

  /**
   * A tool error's own `execute_tool` span has already ended by the time this
   * hook fires (shipped behavior); record it on the nearest live span, named.
   */
  override async onToolErrorCallback({
    tool,
    error,
  }: {
    tool: BaseTool;
    error: Error;
  }): Promise<undefined> {
    const span = activeSpan();
    if (span) {
      span.addEvent("exception", {
        "exception.type": error.name,
        "exception.message": error.message,
        "gen_ai.tool.name": tool.name,
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }
    return undefined;
  }

  /** An agent transfer, event-only in the engine, becomes a span event. */
  override async onEventCallback({ event }: { event: Event }): Promise<undefined> {
    const target = event.actions?.transferToAgent;
    if (target !== undefined) {
      activeSpan()?.addEvent(ADK_TRANSFER_EVENT, { [ADK_TRANSFER_TARGET]: target });
    }
    return undefined;
  }
}

function activeSpan(): Span | undefined {
  const span = trace.getActiveSpan();
  return span?.isRecording() ? span : undefined;
}
