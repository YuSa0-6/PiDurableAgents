import { describe, expect, it } from "vite-plus/test";
import plugin from "./clean-architecture.js";

function reports(ruleName, filename, visit) {
  const found = [];
  const context = {
    filename,
    report: (problem) => found.push(problem.message),
    sourceCode: { getAllComments: () => visit.comments ?? [] },
  };
  const handlers = plugin.rules[ruleName].create(context);
  visit(handlers);
  return found;
}

function importing(source) {
  const visit = (handlers) => handlers.ImportDeclaration?.({ source: { value: source } });
  return visit;
}

function commented(...values) {
  const visit = (handlers) => handlers.Program?.();
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
