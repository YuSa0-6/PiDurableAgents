import type { ToolExecutionResult, ToolPark } from "@earendil-works/pi-durable";

export function ok(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }] };
}

export function fail(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }], isError: true };
}

export async function guarded<T extends ToolExecutionResult | ToolPark>(
  run: () => Promise<T>,
): Promise<T | ToolExecutionResult> {
  try {
    return await run();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function redacting(
  secrets: readonly string[],
  work: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const scrub = (text: string) =>
    secrets.filter(Boolean).reduce((out, secret) => out.replaceAll(secret, "[redacted]"), text);
  const result = await guarded(work);
  return {
    ...result,
    output: (result.output ?? []).map((part) =>
      part.type === "text" ? { ...part, text: scrub(part.text) } : part,
    ),
  };
}
