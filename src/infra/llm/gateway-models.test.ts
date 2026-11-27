import { describe, expect, it } from "vite-plus/test";
import { MODEL_CHOICES } from "../../domain/model-choice";
import { catalogModel } from "./gateway-models";

describe("catalogModel", () => {
  it.each(MODEL_CHOICES.map((choice) => [choice.name, choice] as const))(
    "finds %s in the pi-ai catalog with a price",
    (_, choice) => {
      const model = catalogModel(choice);
      expect(model).toMatchObject({ provider: choice.provider, id: choice.id });
      expect(["openai-completions", "anthropic-messages", "openai-responses"]).toContain(model.api);
      expect(model.cost.input).toBeGreaterThan(0);
      expect(model.cost.output).toBeGreaterThan(0);
    },
  );

  it("refuses a provider without a catalog and a model the catalog lacks", () => {
    expect(() => catalogModel({ provider: "nope", id: "x" })).toThrow(
      "No catalog for provider nope",
    );
    expect(() => catalogModel({ provider: "anthropic", id: "claude-none" })).toThrow(
      "No anthropic model metadata for claude-none",
    );
  });
});
