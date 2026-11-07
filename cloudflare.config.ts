import { bindings, defineConfig, exports } from "cf/config";
// The Worker module, imported with cf-worker so cf checks its exports.
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

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
