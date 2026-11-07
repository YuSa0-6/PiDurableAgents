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
import { codemodeExtension } from "../extensions/codemode";
import { createGitHubExtension, type GitHubSetup } from "../extensions/github";
import { createWorkspaceTools, JAVASCRIPT_BACKEND } from "../workspace";

/** The installation token the fake GitHub App hands out. */
export const FAKE_TOKEN = "ghs_faketoken0123456789";

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

/** Real Durable Object fixture: the app's Pi Durable composition with pi-ai's faux provider. */
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
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      this.registry.install({
        name: "workspace",
        tools: createWorkspaceTools(this.workspace)
      });
      // As in production: GitHub tools (here against the fake GitHub), then code mode.
      this.registry.install(createGitHubExtension(this.workspace, this.#github));
      this.registry.install(codemodeExtension());
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

  // ------------------------------------------------------------ GitHub
  /** Requests the github extension sent, as `METHOD url authorization`. */
  readonly githubRequests: string[] = [];
  /** Repositories the fake App minted tokens for. */
  readonly tokenRequests: string[] = [];
  readonly #pulls: { number: number; head: string; html_url: string; draft: boolean }[] = [];

  /** A fake GitHub REST API: repository info, and listing and opening pull requests. */
  readonly #fakeGitHub = async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    this.githubRequests.push(`${method} ${url.pathname}${url.search} ${headers.get("authorization")}`);
    if (method === "GET" && url.pathname.endsWith("/pulls")) {
      const head = url.searchParams.get("head")?.split(":")[1];
      return Response.json(this.#pulls.filter((pr) => pr.head === head));
    }
    if (method === "POST" && url.pathname.endsWith("/pulls")) {
      const body = JSON.parse(String(init?.body)) as { head: string; draft: boolean };
      const number = this.#pulls.length + 1;
      const pr = { number, head: body.head, draft: body.draft, html_url: `https://github.com/o/r/pull/${number}` };
      this.#pulls.push(pr);
      return Response.json(pr, { status: 201 });
    }
    if (method === "GET" && /^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      return Response.json({ default_branch: "main" });
    }
    return new Response("not found", { status: 404 });
  };

  readonly #github: GitHubSetup = {
    app: {
      token: async (repo) => {
        this.tokenRequests.push(`${repo.owner}/${repo.name}`);
        return FAKE_TOKEN;
      }
    },
    repos: ["yusa0-6/d1agents"],
    fetch: this.#fakeGitHub
  };

  /** Run one of the github extension's tools directly; its text output and error flag. */
  async githubTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const extension = createGitHubExtension(this.workspace, this.#github);
    const tool = extension.tools?.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    const result = await tool.execute(args as never, {} as never, {} as never);
    const text = (result.output ?? []).map((part) => ("text" in part ? part.text : "")).join("");
    return { text, isError: result.isError === true };
  }

  /** A repository at `dir` with one commit on main, as a clone would leave it. */
  async gitRepo(dir: string): Promise<void> {
    const git = this.workspace.git;
    await this.workspace.fs.mkdir(dir, { recursive: true });
    await git.init({ dir, defaultBranch: "main" });
    await this.workspace.fs.writeFile(`${dir}/README.md`, "hello\n");
    await git.add({ dir, paths: ["README.md"] });
    await git.commit({ dir, message: "init", author: { name: "test", email: "test@example.com" } });
  }

  /** What the extension asked of GitHub so far. */
  githubCalls(): { requests: string[]; tokens: string[] } {
    return { requests: [...this.githubRequests], tokens: [...this.tokenRequests] };
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
