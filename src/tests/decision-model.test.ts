import { describe, expect, it } from "vite-plus/test";
import {
  decide,
  DECISION_MODEL,
  type DecisionEnv,
} from "../decision-model";
import type { RouterEvent } from "../event";
import { DEFAULT_MODEL, EXECUTION_MODELS } from "../execution-models";

function event(text: string): RouterEvent {
  return {
    id: crypto.randomUUID(),
    source: "test",
    type: "message",
    text,
    session: "test",
    receivedAt: new Date().toISOString()
  };
}

type Call = { provider: string; endpoint: string; query: Record<string, unknown> };

/** A fake AI binding whose gateway answers like OpenRouter's decisions API. */
function fakeEnv(answer: () => Response): { env: DecisionEnv; calls: Call[] } {
  const calls: Call[] = [];
  const ai = {
    gateway: () => ({
      run: async (request: Call) => {
        calls.push(request);
        return answer();
      }
    })
  } as unknown as Ai;
  return { env: { AI: ai, AI_GATEWAY_ID: "test-gateway" }, calls };
}

function choice(model: string, confidence: number): Response {
  return Response.json({
    model: "liquid/d1.1-20261027",
    answers: {
      model: { type: "choice", choice: model, probabilities: { [model]: confidence }, confidence }
    },
    usage: { input_tokens: 90, output_tokens: 0, cost: 0.0000018 }
  });
}

describe("DecisionModel", () => {
  it("rejects empty text at the guardrail without calling d1.1", async () => {
    const { env, calls } = fakeEnv(() => choice("z-ai/glm-5.3", 0.9));
    const d = await decide(env, event("   "));
    expect(d).toMatchObject({ action: "reject", decidedBy: "guardrail" });
    expect(calls).toHaveLength(0);
  });

  it("asks d1.1 a choice question over the execution models", async () => {
    const { env, calls } = fakeEnv(() => choice("qwen/qwen3.8-max-0902", 0.95));
    const d = await decide(env, event("Compare these two architectures"));
    expect(d).toMatchObject({
      action: "llm",
      model: "qwen/qwen3.8-max-0902",
      decidedBy: "d1.1",
      confidence: 0.95,
      costUsd: 0.0000018
    });
    expect(calls[0]).toMatchObject({ provider: "openrouter", endpoint: "../alpha/decisions" });
    const query = calls[0].query as {
      model: string;
      questions: { model: { type: string; criteria: Record<string, string> } };
    };
    expect(query.model).toBe(DECISION_MODEL);
    expect(query.questions.model.type).toBe("choice");
    expect(Object.keys(query.questions.model.criteria)).toEqual(
      EXECUTION_MODELS.map((model) => model.id)
    );
  });

  it("falls back when d1.1 is unsure", async () => {
    const { env } = fakeEnv(() => choice("deepseek/deepseek-v4.1-flash", 0.2));
    const d = await decide(env, event("hmm"));
    expect(d).toMatchObject({ decidedBy: "fallback", model: DEFAULT_MODEL });
  });

  it("falls back when d1.1 picks a model outside the pool", async () => {
    const { env } = fakeEnv(() => choice("someone/else", 0.99));
    const d = await decide(env, event("hello"));
    expect(d).toMatchObject({ decidedBy: "fallback", model: DEFAULT_MODEL });
  });

  it("falls back when the gateway answers an error", async () => {
    const { env } = fakeEnv(() =>
      Response.json({ error: { message: "Not Found" } }, { status: 404 })
    );
    const d = await decide(env, event("hello"));
    expect(d).toMatchObject({ action: "llm", decidedBy: "fallback", model: DEFAULT_MODEL });
    expect(d.reasons.join(" ")).toContain("404");
  });
});
