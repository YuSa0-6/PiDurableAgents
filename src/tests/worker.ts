import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Message,
  type TranscriptContext
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { DurableObject } from "cloudflare:workers";
import { Workspace, type DurableObjectStorageLike } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { PiHarness, type PiOperationResult } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createWorkspaceTools, JAVASCRIPT_BACKEND } from "../workspace";

function textOf(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      "text" in part && typeof part.text === "string" ? part.text : ""
    )
    .join("");
}

/**
 * The faux model's script, derived from the transcript alone:
 *
 * - `read PATH` calls the workspace's `read`; anything else is echoed back.
 * - After a tool result it answers `tool said: <result>`.
 */
function script(context: TranscriptContext): AssistantMessage {
  // pi places system-prompt changes positionally, so a system message can
  // follow the user's input.
  const last = context.messages.filter((m) => m.role !== "system").at(-1);
  if (last?.role === "toolResult") {
    return fauxAssistantMessage([
      fauxText(
        `${last.isError ? "tool failed" : "tool said"}: ${textOf(last.content)}`
      )
    ]);
  }
  const prompt = last?.role === "user" ? textOf(last.content) : "";
  const read = /^read (\S+)$/.exec(prompt);
  if (read) {
    return fauxAssistantMessage([fauxToolCall("read", { path: read[1] })], {
      stopReason: "toolUse"
    });
  }
  return fauxAssistantMessage([fauxText(`echo: ${prompt}`)]);
}

/** Real Durable Object fixture: the app's Pi Durable composition with pi-ai's faux provider. */
export class PiHarnessTestObject extends DurableObject<Env> {
  readonly #faux = fauxProvider({
    tokensPerSecond: 200,
    tokenSize: { min: 2, max: 4 }
  });
  // The app's workspace, over the object's SQLite.
  readonly workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    backends: [
      new CodemodeBackend({
        id: JAVASCRIPT_BACKEND,
        loader: this.env.LOADER,
        root: "/workspace",
        access: "read-write"
      })
    ]
  });
  readonly registry = createRegistry();
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      this.registry.install({
        name: "workspace",
        tools: createWorkspaceTools(this.workspace)
      });
      const models = createModels();
      models.setProvider(this.#faux.provider);
      return Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          onWake,
          settings: { retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } },
          onReport: (report) => console.warn("pi report", report)
        },
        context
      );
    },
    defaults: { model: this.#faux.getModel() }
  });
  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#faux.setResponses(Array.from({ length: 200 }, () => script));
  }

  /** Prompt the root session; the result without its transcript. */
  async prompt(text: string): Promise<PiOperationResult> {
    const { messages: _messages, ...result } = await this.harness.prompt(text);
    return result;
  }

  /** Write a file into the workspace, as a test's setup. */
  async writeWorkspaceFile(path: string, text: string): Promise<void> {
    await this.workspace.fs.mkdir("/workspace", { recursive: true });
    await this.workspace.fs.writeFile(path, text);
  }
}

export default { fetch: () => new Response("Not found", { status: 404 }) };
