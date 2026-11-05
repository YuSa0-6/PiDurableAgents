import { describe, expect, it } from "vitest";
import { decide, POLICY, type RouterEvent } from "../decision-model";

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

/** A fake AI binding that answers the classifier with a fixed reply. */
function fakeAI(response: string): Ai {
  return { run: async () => ({ response }) } as unknown as Ai;
}

const unused = fakeAI("unused");

describe("DecisionModel", () => {
  it("rejects empty text at the guardrail", async () => {
    const d = await decide(unused, event("   "));
    expect(d.action).toBe("reject");
    expect(d.decidedBy).toBe("guardrail");
  });

  it("routes file work to the workspace policy by rules", async () => {
    const d = await decide(unused, event("/workspace/haiku.txt にファイルを書いて保存して"));
    expect(d).toMatchObject({ action: "llm", intent: "workspace", decidedBy: "rules" });
    expect(d.model).toBe(POLICY.workspace.model);
  });

  it("routes design questions to the analysis policy by rules", async () => {
    const d = await decide(unused, event("この2つのアーキテクチャを比較して設計のメリットを分析して"));
    expect(d).toMatchObject({ intent: "analysis", decidedBy: "rules" });
    expect(d.model).toBe(POLICY.analysis.model);
  });

  it("treats short text without keywords as chat", async () => {
    const d = await decide(unused, event("こんにちは"));
    expect(d).toMatchObject({ intent: "chat", decidedBy: "rules" });
  });

  it("asks the classifier when the rules cannot decide", async () => {
    const text = "I would like some help thinking about my weekend, there are many things going on lately";
    const d = await decide(fakeAI('{"intent":"analysis","confidence":0.7}'), event(text));
    expect(d).toMatchObject({ intent: "analysis", decidedBy: "classifier", confidence: 0.7 });
  });

  it("falls back to chat when the classifier answers nonsense", async () => {
    const text = "I would like some help thinking about my weekend, there are many things going on lately";
    const d = await decide(fakeAI("no idea"), event(text));
    expect(d).toMatchObject({ intent: "chat", decidedBy: "fallback" });
  });
});
