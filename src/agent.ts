import { DurableObject } from "cloudflare:workers";
import { Workspace, type DurableObjectStorageLike } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { createGitClient } from "@cloudflare/computer/git";
import { createGitModule } from "@cloudflare/computer/modules/git";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness, type PiModel } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import type { Decision } from "./decision-model";
import type { RouterEvent } from "./event";
import {
  DEFAULT_MODEL,
  executionModels,
  gatewayOpenRouterProvider
} from "./execution-models";
import { artifactsSessionId, createArtifactsExtension } from "./extensions/artifacts";
import { createCodemodeExtension } from "./extensions/codemode";
import { createGitExtension } from "./extensions/git";
import { createWorkspaceExtension, JAVASCRIPT_BACKEND } from "./extensions/workspace";

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
    // This session's git repositories in Cloudflare Artifacts.
    artifacts: {
      binding: this.env.ARTIFACTS,
      sessionId: artifactsSessionId(this.ctx.id.name ?? this.ctx.id.toString())
    },
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
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      // What the model sees: the system prompt and its tools, as pi extensions.
      this.registry.install(createWorkspaceExtension(this.workspace));
      this.registry.install(createGitExtension(this.workspace));
      this.registry.install(createArtifactsExtension(this.workspace, this.workspace.artifacts));
      // Code mode last: its prompt section lists the tools installed above.
      this.registry.install(createCodemodeExtension());
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
    await this.#applyModel(decision);
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

  /**
   * This session's Artifacts repositories, each with its Git remote and a
   * read-only token valid for an hour, so a person can fetch the agent's
   * branches.
   */
  async shareRepos(): Promise<SharedRepo[]> {
    const artifacts = this.workspace.artifacts;
    const repos = await artifacts.list();
    return Promise.all(
      repos.map(async (repo) => {
        const { remote } = await artifacts.get(repo.name);
        const token = await artifacts.createToken(repo.name, "read", 60 * 60);
        return {
          name: repo.name,
          remote,
          defaultBranch: repo.defaultBranch,
          lastPushAt: repo.lastPushAt,
          readToken: token.plaintext,
          expiresAt: token.expiresAt
        };
      })
    );
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

  /** The execution model the session runs on, once set. */
  #appliedModel?: string;

  /** The pi-ai model object for an execution model id. */
  #model(id: string): PiModel {
    const model = this.executionModels.find((candidate) => candidate.id === id);
    if (!model) throw new Error(`Unknown execution model ${id}`);
    return model;
  }

  async #applyModel(decision: Decision): Promise<void> {
    if (this.#appliedModel === decision.model) return;
    await this.harness.session().setModel(this.#model(decision.model));
    this.#appliedModel = decision.model;
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

export type SharedRepo = {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
  readonly lastPushAt: string | null;
  readonly readToken: string;
  readonly expiresAt: string;
};

export type LoggedDecision = {
  readonly id: string;
  readonly at: string;
  readonly source: string;
  readonly text: string;
  readonly decision: Decision;
};
