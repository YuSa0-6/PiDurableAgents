import { createInlineCodemodeSandbox } from "@earendil-works/pi-codemode/cloudflare";
import type { Extension } from "@earendil-works/pi-durable";
import { createCodemodeExtension as createPiCodemodeExtension } from "@earendil-works/pi-durable/codemode";

export function createCodemodeExtension(): Extension {
  const sandbox = createInlineCodemodeSandbox({
    interruptBudget: 30_000,
    memoryLimitBytes: 32 * 1024 * 1024,
    timeoutMs: 5 * 60 * 1000
  });
  return createPiCodemodeExtension({ sandbox, models: false });
}
