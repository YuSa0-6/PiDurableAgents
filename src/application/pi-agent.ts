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
import { artifactsSessionId } from "../domain/artifacts-session-id";
import type { AgentEvent, EventResult } from "../domain/event";
import type { SharedRepo } from "../domain/shared-repo";
import type { Sandbox } from "./sandbox";
import { runEvent } from "../infra/pi/run-event";
import { shareRepos } from "../infra/pi/share-repos";
import { gatewayOpenRouterProvider, openRouterModel } from "../infra/llm/openrouter";
import { createArtifactsExtension } from "../infra/pi/extensions/artifacts";
import { createCodemodeExtension } from "../infra/pi/extensions/codemode";
import { createGitExtension } from "../infra/pi/extensions/git";
import { createTestsExtension } from "../infra/pi/extensions/tests";
import { containerRunner } from "../infra/pi/container-runner";
import { createWorkspaceExtension, JAVASCRIPT_BACKEND } from "../infra/pi/extensions/workspace";

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
      this.registry.install(
        createTestsExtension(
          this.workspace,
          containerRunner(
            () =>
              (this.ctx.exports.Sandbox as unknown as DurableObjectNamespace<Sandbox>).getByName(
                this.ctx.id.toString(),
              ),
            this.workspace,
          ),
        ),
      );
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

  async handleEvent(event: AgentEvent, wait = true): Promise<EventResult> {
    return runEvent(this.harness.session(), event, wait);
  }

  async shareRepos(): Promise<SharedRepo[]> {
    return shareRepos(this.workspace.artifacts);
  }
}
