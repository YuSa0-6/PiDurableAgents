import path from "node:path";

const ALLOWED = {
  domain: ["domain"],
  usecase: ["domain", "usecase"],
  infra: ["domain", "usecase", "infra"],
  application: ["domain", "usecase", "infra", "application"],
};

const DIRECTIVE = /^\s*(@ts-|oxlint-)/;

function posix(file) {
  return file.split(path.sep).join("/");
}

function layerOf(file) {
  return posix(file).match(/\/src\/(domain|usecase|infra|application)\//)?.[1] ?? null;
}

const dependencyRule = {
  meta: { type: "problem" },
  create(context) {
    const from = layerOf(context.filename);
    if (!from) return {};
    const check = (node, source) => {
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
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && check(node, node.source.value),
    };
  },
};

const portsAreTypes = {
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
};

const noComments = {
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
};

export default {
  meta: { name: "clean-architecture" },
  rules: {
    "dependency-rule": dependencyRule,
    "ports-are-types": portsAreTypes,
    "no-comments": noComments,
  },
};
