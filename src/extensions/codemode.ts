import { createInlineCodemodeSandbox } from "@earendil-works/pi-codemode/cloudflare";
import type { CodemodeSandboxBase } from "@earendil-works/pi-codemode/portable";
import type { Extension } from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";

/**
 * pi extension: Pi Durable's code mode. The model writes one JavaScript
 * script that calls the session's other tools as `tools.<name>(args)`, so
 * many tool calls take one step. The script survives a restart: pi journals
 * every result and replays the script up to where it was.
 *
 * Scripts run in QuickJS (WebAssembly) on the PiAgent object's own thread.
 * While a script computes without awaiting a tool, the session waits, so
 * the interrupt budget below keeps that short. To move scripts off the
 * session's thread, replace `createCodemodeSandbox` with a
 * `RemoteCodemodeSandbox` and a `CodemodeSandboxDurableObject` deployed as
 * its own Worker; nothing else changes.
 */

/**
 * QuickJS interrupt polls per script. Durable Objects make about 10,000 a
 * second, so this allows about 3 seconds of computation between tool calls.
 */
export const CODEMODE_INTERRUPT_BUDGET = 30_000;
/** VM memory per script. A Worker isolate has 128 MB in total. */
export const CODEMODE_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
/** Wall time per script, tool calls included. */
export const CODEMODE_TIMEOUT_MS = 5 * 60 * 1000;

export function createCodemodeSandbox(): CodemodeSandboxBase {
  return createInlineCodemodeSandbox({
    interruptBudget: CODEMODE_INTERRUPT_BUDGET,
    memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
    timeoutMs: CODEMODE_TIMEOUT_MS
  });
}

export function codemodeExtension(sandbox: CodemodeSandboxBase = createCodemodeSandbox()): Extension {
  // `models: false`: no `models.*` in scripts. A script could otherwise call
  // models in a loop, outside the DecisionModel's choice and its cost.
  return createCodemodeExtension({ sandbox, models: false });
}
