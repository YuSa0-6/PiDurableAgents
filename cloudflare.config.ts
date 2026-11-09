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
		exports: {
			PiAgent: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			ACCOUNT_ID: bindings.text("7beca1669580a2216d1e5b0bc3c346f8"),
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
