import { DurableObject } from "cloudflare:workers";
import { Workspace, type DurableObjectStorageLike } from "@cloudflare/computer";
import { CodemodeBackend } from "@cloudflare/computer/backends/codemode";
import { createGitClient } from "@cloudflare/computer/git";
import { createGitModule } from "@cloudflare/computer/modules/git";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import type { EventResult, RouterEvent } from "./event";
import { EventSession } from "./event-session";
import { gatewayOpenRouterProvider, openRouterModel } from "./model";
import { artifactsSessionId, createArtifactsExtension } from "./extensions/artifacts";
import { createCodemodeExtension } from "./extensions/codemode";
import { createGitExtension } from "./extensions/git";
import { createWorkspaceExtension, JAVASCRIPT_BACKEND } from "./extensions/workspace";

export class PiAgent extends DurableObject<Env> {
  readonly ai = createAI({ binding: this.env.AI, id: this.env.AI_GATEWAY_ID });
  readonly model = openRouterModel();
  readonly workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    git: createGitClient(),
    artifacts: {
      binding: this.env.ARTIFACTS,
      sessionId: artifactsSessionId(this.ctx.id.name ?? this.ctx.id.toString()),
    },
    backends: [
      new CodemodeBackend({
        id: JAVASCRIPT_BACKEND,
        loader: this.env.LOADER,
        root: "/workspace",
        access: "read-write",
        modules: { "codemode:git": createGitModule({ allowNetwork: true }) },
      }),
    ],
  });
  readonly registry = createRegistry();
  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      this.registry.install(createWorkspaceExtension(this.workspace));
      this.registry.install(createGitExtension(this.workspace));
      this.registry.install(createArtifactsExtension(this.workspace, this.workspace.artifacts));
      this.registry.install(createCodemodeExtension());
      const models = createModels();
      models.setProvider(gatewayOpenRouterProvider(this.ai, this.model));
      return Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          onWake,
          settings: {
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
          },
          onReport: (report) => console.warn("pi report", report),
        },
        context,
      );
    },
    defaults: { model: this.model, thinkingLevel: "low" },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  async handleEvent(event: RouterEvent, wait = true): Promise<EventResult> {
    return EventSession.run(this.harness.session(), event, wait);
  }

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
          expiresAt: token.expiresAt,
        };
      }),
    );
  }
}

export type { EventResult } from "./event";

export type SharedRepo = {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
  readonly lastPushAt: string | null;
  readonly readToken: string;
  readonly expiresAt: string;
};
