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
import { createGitClient } from "@cloudflare/computer/git";
import { PiHarness, type PiOperationResult } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import type { Extension } from "@earendil-works/pi-durable";
import { createArtifactsExtension, type ArtifactsClient } from "../extensions/artifacts";
import { createCodemodeExtension } from "../extensions/codemode";
import { createGitExtension } from "../extensions/git";
import { createWorkspaceExtension, JAVASCRIPT_BACKEND } from "../extensions/workspace";

/** Every token the fake Artifacts hands out starts with this. */
export const FAKE_ARTIFACTS_TOKEN = "art_v1_fake";

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
 * - `read PATH` calls the workspace's `read`; `codemode <script>` calls the
 *   code mode tool with that script; anything else is echoed back.
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
  const codemode = /^codemode ([\s\S]+)$/.exec(prompt);
  if (codemode) {
    return fauxAssistantMessage([fauxToolCall("codemode", { code: codemode[1] })], {
      stopReason: "toolUse"
    });
  }
  const read = /^read (\S+)$/.exec(prompt);
  if (read) {
    return fauxAssistantMessage([fauxToolCall("read", { path: read[1] })], {
      stopReason: "toolUse"
    });
  }
  return fauxAssistantMessage([fauxText(`echo: ${prompt}`)]);
}

/** Real Durable Object fixture: the app's Pi Durable composition with pi-ai's faux provider and a fake Artifacts. */
export class PiHarnessTestObject extends DurableObject<Env> {
  readonly #faux = fauxProvider({
    tokensPerSecond: 200,
    tokenSize: { min: 2, max: 4 }
  });
  // The app's workspace, over the object's SQLite.
  readonly workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    git: createGitClient(),
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
  /** What the fake Artifacts client was asked, in order. Before #extensions, which uses it. */
  readonly #artifactsCalls: string[] = [];
  // As in production (src/agent.ts), with Artifacts faked; code mode last.
  readonly #extensions: Extension[] = [
    createWorkspaceExtension(this.workspace),
    createGitExtension(this.workspace),
    createArtifactsExtension(this.workspace, this.#fakeArtifacts(), { pollMs: 1 }),
    createCodemodeExtension()
  ];
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      for (const extension of this.#extensions) this.registry.install(extension);
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

  /** Run one of the extensions' tools directly; its text output and error flag. */
  async runTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const tool = this.#extensions
      .flatMap((extension) => extension.tools ?? [])
      .find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    const result = await tool.execute(args as never, {} as never, {} as never);
    const text = (result.output ?? []).map((part) => ("text" in part ? part.text : "")).join("");
    return { text, isError: result.isError === true };
  }

  // ------------------------------------------------------------ Artifacts
  artifactsCalls(): string[] {
    return [...this.#artifactsCalls];
  }

  /** An in-memory Artifacts client. An import stays unreadable for two `get`s, as a real import is for a while. */
  #fakeArtifacts(): ArtifactsClient {
    const repos = new Map<string, { defaultBranch: string; source: string | null; pendingReads: number }>();
    const calls = this.#artifactsCalls;
    let tokens = 0;
    // Not a valid URL: a clone or push against it fails before any network access.
    const remote = (name: string) => `https://fake artifacts/git/d1agents/${name}.git`;
    const info = (name: string) => {
      const repo = repos.get(name)!;
      return {
        id: name,
        name,
        description: null,
        defaultBranch: repo.defaultBranch,
        createdAt: "2026-11-07T00:00:00Z",
        updatedAt: "2026-11-07T00:00:00Z",
        lastPushAt: null,
        source: repo.source,
        readOnly: false
      };
    };
    const created = (name: string) => ({
      id: name,
      name,
      description: null,
      defaultBranch: repos.get(name)!.defaultBranch,
      remote: remote(name),
      token: `${FAKE_ARTIFACTS_TOKEN}_initial_${name}`
    });
    return {
      create: async (name, opts) => {
        if (repos.has(name)) throw new Error(`ALREADY_EXISTS: ${name}`);
        repos.set(name, { defaultBranch: opts?.setDefaultBranch ?? "main", source: null, pendingReads: 0 });
        calls.push(`create ${name}`);
        return created(name);
      },
      get: async (name) => {
        const repo = repos.get(name);
        if (!repo) throw new Error(`NOT_FOUND: ${name}`);
        if (repo.pendingReads > 0) {
          repo.pendingReads--;
          calls.push(`get ${name} (importing)`);
          throw new Error(`NOT_READY: ${name}`);
        }
        return { ...info(name), remote: remote(name) };
      },
      list: async () => [...repos.keys()].map(info),
      import: async (name, source) => {
        repos.set(name, { defaultBranch: source.branch ?? "main", source: source.url, pendingReads: 2 });
        calls.push(`import ${name} from ${source.url}`);
        return created(name);
      },
      createToken: async (name, scope = "write") => {
        const id = `t${++tokens}`;
        calls.push(`token ${scope} ${name} ${id}`);
        return { id, plaintext: `${FAKE_ARTIFACTS_TOKEN}_${id}?expires=1`, scope, expiresAt: "2026-11-07T00:00:00Z" };
      },
      revokeToken: async (name, tokenOrId) => {
        calls.push(`revoke ${name} ${tokenOrId.startsWith(FAKE_ARTIFACTS_TOKEN) ? "initial" : tokenOrId}`);
        return true;
      }
    };
  }

  // ------------------------------------------------------------ Workspace helpers
  /** A repository at `dir` with one commit on main, as a clone would leave it. */
  async gitRepo(dir: string): Promise<void> {
    const git = this.workspace.git;
    await this.workspace.fs.mkdir(dir, { recursive: true });
    await git.init({ dir, defaultBranch: "main" });
    await this.workspace.fs.writeFile(`${dir}/README.md`, "hello\n");
    await git.add({ dir, paths: ["README.md"] });
    await git.commit({ dir, message: "init", author: { name: "test", email: "test@example.com" } });
  }

  async gitLog(dir: string): Promise<string[]> {
    return (await this.workspace.git.log({ dir })).map((commit) => commit.message.trim());
  }

  /** Write a file into the workspace, as a test's setup. */
  async writeWorkspaceFile(path: string, text: string): Promise<void> {
    await this.workspace.fs.mkdir("/workspace", { recursive: true });
    await this.workspace.fs.writeFile(path, text);
  }
}

export default { fetch: () => new Response("Not found", { status: 404 }) };
