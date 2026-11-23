import { describe, expect, it } from "vite-plus/test";
import plugin from "./clean-architecture";

type Handlers = {
  ImportDeclaration?: (node: { source: { value: string } }) => void;
  Program?: () => void;
};
type Visit = ((handlers: Handlers) => void) & { comments?: { value: string; loc: object }[] };
type RuleName = "dependency-rule" | "ports-are-types" | "no-comments";

function reports(ruleName: RuleName, filename: string, visit: Visit) {
  const found: string[] = [];
  const context = {
    filename,
    report: (problem: { message: string }) => found.push(problem.message),
    sourceCode: { getAllComments: () => visit.comments ?? [] },
  };
  const rule = plugin.rules[ruleName] as unknown as { create: (c: typeof context) => Handlers };
  visit(rule.create(context));
  return found;
}

function importing(source: string): Visit {
  return (handlers) => handlers.ImportDeclaration?.({ source: { value: source } });
}

function commented(...values: string[]): Visit {
  const visit: Visit = (handlers) => handlers.Program?.();
  visit.comments = values.map((value) => ({ value, loc: {} }));
  return visit;
}

describe("dependency-rule", () => {
  it("rejects domain importing infra", () => {
    expect(
      reports("dependency-rule", "/repo/src/domain/event.ts", importing("../infra/system")),
    ).toEqual([
      "domain must not import infra. Dependencies point inward: application -> infra -> usecase -> domain.",
    ]);
  });

  it("lets infra import domain", () => {
    expect(
      reports("dependency-rule", "/repo/src/infra/system.ts", importing("../domain/event")),
    ).toEqual([]);
  });
});

describe("no-comments", () => {
  it("rejects a plain comment and an eslint directive", () => {
    expect(
      reports(
        "no-comments",
        "/repo/src/domain/event.ts",
        commented(" explains", " eslint-disable"),
      ),
    ).toHaveLength(2);
  });

  it("allows @ts- and oxlint- directives", () => {
    expect(
      reports(
        "no-comments",
        "/repo/src/domain/event.ts",
        commented(" @ts-expect-error", " oxlint-disable-next-line"),
      ),
    ).toEqual([]);
  });
});
