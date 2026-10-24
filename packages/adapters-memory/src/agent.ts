import {
  err,
  isDid,
  ok,
  type Agent,
  type AgentSession,
  type AgentTurn,
  type IdGenerator,
  type JsonValue,
  type PendingConfirmation,
  type PortError,
  type Result,
  type SessionRequest,
  type ToolCallRecord,
} from "@shopong/ports";
import { createCounterIds } from "./support.js";

export interface MemoryAgentOptions {
  ids?: IdGenerator;
}

interface Directive {
  tool: string;
  input: JsonValue;
}

/**
 * In-memory `Agent`: a scripted stand-in for an LLM agent. It understands one phrase,
 * `tool "<name>" with input {<json>}`, any number of times per prompt, and calls those
 * tools through the session's registry in order. Tools the registry does not list are
 * never called.
 */
export class MemoryAgent implements Agent {
  readonly #ids: IdGenerator;

  constructor(options: MemoryAgentOptions = {}) {
    this.#ids = options.ids ?? createCounterIds();
  }

  async startSession(
    request: SessionRequest,
  ): Promise<Result<AgentSession, PortError<"invalid_request">>> {
    if (!isDid(request.owner)) return err("invalid_request", "owner must be a DID");
    if (typeof request.capability !== "string" || request.capability.length === 0) {
      return err("invalid_request", "a session capability is required");
    }
    const id = this.#ids.next("session");
    let closed = false;
    const session: AgentSession = {
      id,
      prompt: async (text) => {
        if (closed) throw new Error(`session ${id} is closed`);
        const listed = new Set((await request.tools.list()).map((tool) => tool.name));
        const toolCalls: ToolCallRecord[] = [];
        const confirmations: PendingConfirmation[] = [];
        const lines: string[] = [];
        for (const directive of parseDirectives(text)) {
          if (!listed.has(directive.tool)) {
            lines.push(`I cannot use ${directive.tool}: it is not one of my tools.`);
            continue;
          }
          const result = await request.tools.call(directive.tool, directive.input, {
            sessionId: id,
            capability: request.capability,
          });
          toolCalls.push({ tool: directive.tool, input: directive.input, result });
          if (result.status === "needs_confirmation") {
            confirmations.push(result.confirmation);
            lines.push(`${directive.tool} needs your confirmation: ${result.confirmation.summary}`);
          } else if (result.status === "ok") {
            lines.push(`${directive.tool}: ${JSON.stringify(result.output)}`);
          } else {
            lines.push(
              `${directive.tool} ${result.status}: ${result.status === "denied" ? result.reason : result.message}`,
            );
          }
        }
        const turn: AgentTurn = {
          status: confirmations.length > 0 ? "needs_confirmation" : "done",
          reply: lines.length > 0 ? lines.join("\n") : "Nothing to do.",
          toolCalls,
          confirmations,
        };
        return turn;
      },
      close: async () => {
        closed = true;
      },
    };
    return ok(session);
  }
}

/** Find every `tool "<name>" with input {...}` in the text, matching braces to read the JSON. */
export function parseDirectives(text: string): Directive[] {
  const directives: Directive[] = [];
  const pattern = /tool\s+"([^"]+)"\s+with\s+input\s+(?=\{)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = pattern.lastIndex;
    const end = matchBrace(text, start);
    if (end === -1) break;
    try {
      directives.push({
        tool: match[1] ?? "",
        input: JSON.parse(text.slice(start, end + 1)) as JsonValue,
      });
    } catch {
      // Not JSON: ignore this phrase.
    }
    pattern.lastIndex = end + 1;
  }
  return directives;
}

function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
