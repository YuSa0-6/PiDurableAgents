import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "d1agents-pi-durable",
		compatibilityDate: "2026-11-05",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		observability: {
			enabled: true,
		},
		access: {
			dev: {
				aud: "193793b85848c2ae4b5d060d5c6f106678a05695bb7d133432fc82da7cc997d6",
			},
		},
		exports: {
			PiAgent: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			AI_GATEWAY_ID: bindings.text("d1agents"),
			PiAgent: bindings.durableObject({
				worker: "d1agents-pi-durable",
				exportName: "PiAgent",
			}),
			AI: bindings.ai({
				dev: {
					remote: true,
				},
			}),
			LOADER: bindings.workerLoader(),
			ARTIFACTS: bindings.artifacts({
				namespace: "d1agents",
				dev: {
					remote: true,
				},
			}),
		},
	},
});
