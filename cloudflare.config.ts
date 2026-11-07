import { bindings, defineConfig, exports } from "cf/config";
// Imported as the Worker, so binding types know PiAgent's RPC methods.
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };

/**
 * The Worker's configuration for the cf CLI (`cf dev`, `cf build`, `cf deploy`).
 * Migrated from wrangler.jsonc with `cf migrate`.
 */
export default defineConfig({
	worker: {
		name: "d1agents-pi-durable",
		compatibilityDate: "2026-11-05",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		observability: {
			enabled: true,
		},
		// PiAgent stores the Pi Durable session, the workspace and the decision
		// log in its SQLite. It was created by the Wrangler migration
		// `{ tag: "v1", new_sqlite_classes: ["PiAgent"] }`.
		exports: {
			PiAgent: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			// The AI Gateway that holds the OpenRouter key (BYOK).
			AI_GATEWAY_ID: bindings.text("d1agents"),
			// GitHub App for the github extension (push and pull requests). The
			// IDs are not secret. The tools stay off until the IDs, the
			// GITHUB_APP_PRIVATE_KEY secret and the API_TOKEN secret are all set.
			GITHUB_APP_ID: bindings.text(""),
			GITHUB_APP_INSTALLATION_ID: bindings.text(""),
			// Repositories the agent may push to, comma-separated owner/name.
			GITHUB_REPOS: bindings.text("YuSa0-6/D1Agents"),
			PiAgent: bindings.durableObject({
				worker: "d1agents-pi-durable",
				exportName: "PiAgent",
			}),
			// Workers AI and AI Gateway. Runs remotely in `cf dev` too.
			AI: bindings.ai({
				dev: {
					remote: true,
				},
			}),
			// `exec` runs JavaScript in Dynamic Workers minted through this.
			LOADER: bindings.workerLoader(),
			// The agent's git repositories (Cloudflare Artifacts), one set per session.
			ARTIFACTS: bindings.artifacts({
				namespace: "d1agents",
				dev: {
					remote: true,
				},
			}),
		},
	},
});
