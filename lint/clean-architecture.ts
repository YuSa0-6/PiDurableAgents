import path from "node:path";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";
import type { Node } from "vite-plus/lint/plugins";

type Layer = "domain" | "usecase" | "infra" | "application";

const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: ["domain"],
  usecase: ["domain", "usecase"],
  infra: ["domain", "usecase", "infra"],
  application: ["domain", "usecase", "infra", "application"],
};

const DIRECTIVE = /^\s*(@ts-|oxlint-)/;

function posix(file: string) {
  return file.split(path.sep).join("/");
}

function layerOf(file: string): Layer | null {
  const found = posix(file).match(/\/src\/(domain|usecase|infra|application)\//)?.[1];
  return (found as Layer | undefined) ?? null;
}

const dependencyRule = defineRule({
  meta: { type: "problem" },
  create(context) {
    const from = layerOf(context.filename);
    if (!from) return {};
    const check = (node: Node, source: unknown) => {
      if (typeof source !== "string" || !source.startsWith(".")) return;
      const target = layerOf(`${path.resolve(path.dirname(context.filename), source)}/`);
      if (target && !ALLOWED[from].includes(target)) {
        context.report({
          node,
          message: `${from} must not import ${target}. Dependencies point inward: application -> infra -> usecase -> domain.`,
        });
      }
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
    };
  },
});

const portsAreTypes = defineRule({
  meta: { type: "problem" },
  create(context) {
    if (!posix(context.filename).includes("/src/usecase/ports/")) return {};
    return {
      ExportNamedDeclaration(node) {
        const kind = node.declaration?.type;
        if (kind && kind !== "TSInterfaceDeclaration" && kind !== "TSTypeAliasDeclaration") {
          context.report({ node, message: "usecase/ports exports only interfaces and types." });
        }
      },
    };
  },
});

const noComments = defineRule({
  meta: { type: "suggestion" },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(comment.value)) continue;
          context.report({
            loc: comment.loc,
            message: "Write no comments. Let names and types carry the intent.",
          });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "clean-architecture" },
  rules: {
    "dependency-rule": dependencyRule,
    "ports-are-types": portsAreTypes,
    "no-comments": noComments,
  },
});
