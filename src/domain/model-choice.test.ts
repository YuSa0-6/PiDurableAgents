import { describe, expect, it } from "vite-plus/test";
import { InvalidInput } from "./errors";
import { DEFAULT_MODEL, MODEL_CHOICES, parseModelChoice, sameModel } from "./model-choice";

describe("parseModelChoice", () => {
  it("leaves the model unset when it is missing or empty", () => {
    expect(parseModelChoice(undefined)).toBeUndefined();
    expect(parseModelChoice("")).toBeUndefined();
  });

  it("resolves a listed name to its provider and id", () => {
    expect(parseModelChoice("claude-sonnet-5.5")).toEqual({
      name: "claude-sonnet-5.5",
      provider: "anthropic",
      id: "claude-sonnet-5-5",
    });
  });

  it.each([["gpt-9"], ["openrouter/z-ai/glm-5.3"], [3], [null]])(
    "refuses %s and names every allowed model",
    (value) => {
      expect(() => parseModelChoice(value)).toThrow(InvalidInput);
      expect(() => parseModelChoice(value)).toThrow(
        `model must be one of: ${MODEL_CHOICES.map((choice) => choice.name).join(", ")}`,
      );
    },
  );
});

describe("MODEL_CHOICES", () => {
  it("starts with the default and keeps names unique", () => {
    expect(MODEL_CHOICES[0]).toBe(DEFAULT_MODEL);
    expect(new Set(MODEL_CHOICES.map((choice) => choice.name)).size).toBe(MODEL_CHOICES.length);
  });
});

describe("sameModel", () => {
  it("compares provider and id only", () => {
    expect(sameModel(DEFAULT_MODEL, { provider: "openrouter", id: "z-ai/glm-5.3" })).toBe(true);
    expect(sameModel(DEFAULT_MODEL, { provider: "anthropic", id: "z-ai/glm-5.3" })).toBe(false);
  });
});
