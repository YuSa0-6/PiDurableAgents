import { DurableObject } from "cloudflare:workers";
import { Workspace, type DurableObjectStorageLike } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { createGitClient } from "@cloudflare/computer/git";
import { createGitModule } from "@cloudflare/computer/modules/git";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness, type PiModel, type PiSessionId } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import type { Decision, RouterEvent } from "./decision-model";
import { app } from "./router";
import {
  DEFAULT_MODEL,
  executionModels,
  gatewayOpenRouterProvider
} from "./models";
import { codemodeExtension } from "./extensions/codemode";
import { createGitHubExtension, githubSetup } from "./extensions/github";
import { createWorkspaceTools, JAVASCRIPT_BACKEND } from "./workspace";

const PREAMBLE = [
  "You are a concise coding assistant. Requests reach you through an event router and a decision model that picked your model for this request; answer in the user's language.",
  "You have a durable workspace at /workspace: read, write, edit, delete, list (ls), find and grep files there. Paths are absolute.",
  "Two tools run code, for different jobs:",
  "- exec runs a JavaScript module inside the workspace, with node:fs and git. Use it to compute over files.",
  "- codemode runs a script that calls your other tools as tools.<name>(args). Use it to do many tool calls in one step, such as reading or searching many files, or a fixed sequence of tool calls.",
  "Use tools whenever they can answer the request, and explain their results plainly."
].join("\n");

/** One Pi Durable session per Durable Object, driven over HTTP. */
export class PiAgent extends DurableObject<Env> {
  // Workers AI and AI Gateway over the AI binding. The gateway holds the
  // OpenRouter key (BYOK), so the Worker has none.
  readonly ai = createAI({ binding: this.env.AI, id: this.env.AI_GATEWAY_ID });
  // The execution models (OpenRouter), as pi-ai model objects.
  readonly executionModels = executionModels();
  // A durable filesystem on the object's SQLite, beside pi's own tables.
  // `exec` runs JavaScript modules in a fresh Dynamic Worker per call, with
  // no network of its own. `git` turns on `workspace.git`, which the `codemode:git`
  // module calls in the host; `allowNetwork` lets it clone, fetch and push.
  readonly workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    git: createGitClient(),
    backends: [
      new CodemodeBackend({
        id: JAVASCRIPT_BACKEND,
        loader: this.env.LOADER,
        root: "/workspace",
        access: "read-write",
        modules: { "codemode:git": createGitModule({ allowNetwork: true }) }
      })
    ]
  });
  readonly registry = createRegistry();
  // GitHub App access, when configured (see cloudflare.config.ts). One instance per
  // object, so its installation tokens are cached between calls.
  readonly github = githubSetup(this.env);
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      // pi's own extension: the system prompt and the workspace tools.
      this.registry.install({
        name: "playground",
        sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
        tools: createWorkspaceTools(this.workspace)
      });
      if (this.github) {
        this.registry.install(createGitHubExtension(this.workspace, this.github));
      }
      // Code mode last: its prompt section lists the tools installed above.
      this.registry.install(codemodeExtension());
      const models = createModels();
      models.setProvider(this.ai.provider);
      // OpenRouter models, streamed through the gateway.
      models.setProvider(gatewayOpenRouterProvider(this.ai, this.executionModels));
      return Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          onWake,
          settings: {
            // pi doubles the delay before each retry: 1, 2, 4, 8 and 16 seconds,
            // so a rate-limited model gets about 30 seconds to recover.
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 }
          },
          onReport: (report) => console.warn("pi report", report)
        },
        context
      );
    },
    defaults: { model: this.#model(DEFAULT_MODEL), thinkingLevel: "low" }
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  /**
   * Handle one routed event: apply the DecisionModel's choice of model, then
   * hand the event to Pi. The event id is pi's operation id, so a retried
   * event is answered once.
   */
  async handleEvent(
    event: RouterEvent,
    decision: Decision,
    wait = true
  ): Promise<EventResult> {
    this.#log(event, decision);
    const session = this.harness.session();
    await this.#applyModel(session.id, decision);
    const options = {
      operationId: event.id,
      // Recorded in the transcript as where the input came from.
      entry: {
        kind: "app.event",
        data: {
          source: event.source,
          type: event.type,
          model: decision.model,
          decidedBy: decision.decidedBy
        }
      }
    };
    if (!wait) {
      const receipt = await session.submit(event.text, options);
      return { status: "queued", operationId: receipt.operationId };
    }
    const { status, text, reason, operationId } = await session.prompt(
      event.text,
      options
    );
    return { status, operationId, text, reason };
  }

  /** The newest decisions this object logged, newest first. */
  async decisions(limit = 50): Promise<LoggedDecision[]> {
    this.#ensureLog();
    return this.ctx.storage.sql
      .exec<{
        id: string;
        at: string;
        source: string;
        text: string;
        decision: string;
      }>(
        "SELECT id, at, source, text, decision FROM router_decisions ORDER BY at DESC LIMIT ?",
        Math.min(Math.max(1, limit), 200)
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        at: row.at,
        source: row.source,
        text: row.text,
        decision: JSON.parse(row.decision) as Decision
      }));
  }

  readonly #models = new Map<PiSessionId, string>();

  /** The pi-ai model object for an execution model id. */
  #model(id: string): PiModel {
    const model = this.executionModels.find((candidate) => candidate.id === id);
    if (!model) throw new Error(`Unknown execution model ${id}`);
    return model;
  }

  async #applyModel(session: PiSessionId, decision: Decision): Promise<void> {
    if (this.#models.get(session) === decision.model) return;
    await this.harness.session(session).setModel(this.#model(decision.model));
    this.#models.set(session, decision.model);
  }

  #logReady = false;

  #ensureLog(): void {
    if (this.#logReady) return;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS router_decisions (id TEXT PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL, decision TEXT NOT NULL)"
    );
    this.#logReady = true;
  }

  #log(event: RouterEvent, decision: Decision): void {
    this.#ensureLog();
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO router_decisions (id, at, source, text, decision) VALUES (?, ?, ?, ?, ?)",
      event.id,
      event.receivedAt,
      event.source,
      event.text.slice(0, 500),
      JSON.stringify(decision)
    );
  }
}

export type EventResult = {
  readonly status: "done" | "unanswered" | "queued";
  readonly operationId: string;
  readonly text?: string;
  readonly reason?: string;
};

export type LoggedDecision = {
  readonly id: string;
  readonly at: string;
  readonly source: string;
  readonly text: string;
  readonly decision: Decision;
};

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx)
} satisfies ExportedHandler<Env>;
