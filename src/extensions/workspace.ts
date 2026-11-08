import type { Workspace } from "@cloudflare/computer";
import {
  createPiTools,
  type CreatePiToolsOptions,
  type PiTool
} from "@cloudflare/computer/tools/pi-ai";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";

const PREAMBLE = [
  "You are a concise coding assistant. Requests reach you through an event router and a decision model that picked your model for this request; answer in the user's language.",
  "You have a durable workspace at /workspace: read, write, edit, delete, list (ls), find and grep files there. Paths are absolute.",
  "Two tools run code, for different jobs:",
  "- exec runs a JavaScript module inside the workspace, with node:fs and git. Use it to compute over files.",
  "- codemode runs a script that calls your other tools as tools.<name>(args). Use it to do many tool calls in one step, such as reading or searching many files, or a fixed sequence of tool calls.",
  "Use tools whenever they can answer the request, and explain their results plainly."
].join("\n");

export function createWorkspaceExtension(workspace: Workspace): Extension {
  return {
    name: "workspace",
    sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
    tools: createWorkspaceTools(workspace)
  };
}

export const JAVASCRIPT_BACKEND = "javascript";

const REPLAY_SAFE = new Set(["read", "ls", "find", "grep", "write", "delete"]);

const EXEC_DESCRIPTION = `Run JavaScript in the workspace. \`command\` is the source of an ES module, run in a fresh sandboxed isolate with no network access. If the module default-exports a function, it is called with \`input\` and its return value comes back as \`result\`. console.log and console.error go to stdout and stderr. There is no shell, npm or package install: the only imports are these two, plus relative imports of .js files in the workspace.

- \`node:fs/promises\`: the workspace files, async only (readFile, writeFile, mkdir, rm, readdir, stat, lstat, access). readFile takes "utf8" for text.
- \`codemode:git\`: git on the workspace, cloning over HTTPS through the host. Each \`dir\` is resolved against the module's working directory, defaults to it, and must stay inside /workspace, so pass the repository's directory. Its exports:

\`\`\`ts
function clone(options: {
  url: string; // HTTPS only
  dir?: string; // working tree to create
  ref?: string; // branch, tag or commit; default: the remote's default branch
  depth?: number; // shallow clone; default: full history
  paths?: string[]; // check out only these paths
  singleBranch?: boolean; // default true
  noTags?: boolean; // default true
}): Promise<void>;
function status(options?: { dir?: string }): Promise<
  { path: string; index: " " | "A" | "M" | "D"; worktree: " " | "A" | "M" | "D" | "?" }[]
>;
// A unified diff of \`ref\` (default HEAD) against the working tree, or against \`to\` when set.
function diff(options?: { dir?: string; ref?: string; to?: string; paths?: string[] }): Promise<string>;
// Newest first, from \`ref\` (default HEAD); \`depth\` caps the count.
function log(options?: { dir?: string; ref?: string; depth?: number }): Promise<
  {
    oid: string;
    message: string;
    tree: string;
    parent: string[];
    author: { name: string; email: string; timestamp: number; timezoneOffset: number }; // timestamp in seconds
    committer: { name: string; email: string; timestamp: number; timezoneOffset: number };
  }[]
>;
\`\`\`

Example:
import { clone, log } from "codemode:git";
export default async function () {
  await clone({ url: "https://github.com/octocat/Hello-World", dir: "/workspace/hello", depth: 5 });
  return (await log({ dir: "/workspace/hello" })).map((c) => \`\${c.oid.slice(0, 7)} \${c.message.split("\\n")[0]}\`);
}

Prefer the read, write and edit tools for plain file changes. Pushing is not possible from exec: use the repo_push tool.`;

const COMMAND_DESCRIPTION =
  "ES module source to run. Default-export a function to receive `input` and return a result.";

function describeExec(tool: PiTool): PiTool {
  const properties = tool.parameters.properties ?? {};
  const command = properties.command;
  const { definitions: _definitions, ...parameters } = tool.parameters as typeof tool.parameters & {
    definitions?: unknown;
  };
  return {
    ...tool,
    description: EXEC_DESCRIPTION,
    parameters: {
      ...parameters,
      properties: {
        ...properties,
        command:
          typeof command === "object" && command !== null
            ? { ...command, description: COMMAND_DESCRIPTION }
            : command,
        input: {
          description: "Input object handed to the module.",
          type: "object",
          additionalProperties: true
        }
      }
    }
  };
}

function createWorkspaceTools(
  workspace: Workspace,
  options: Omit<CreatePiToolsOptions, "workspace" | "shell"> = {}
): ToolRegistration[] {
  const { tools, execute } = createPiTools({
    ...options,
    workspace,
    shell: {
      defaultBackend: JAVASCRIPT_BACKEND,
      backends: {
        [JAVASCRIPT_BACKEND]: {
          description: "Runs ES module source in a sandboxed isolate."
        }
      }
    }
  });

  return tools.map((declared): ToolRegistration => {
    const tool = declared.name === "exec" ? describeExec(declared) : declared;
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.constrainedSampling
        ? { constrainedSampling: tool.constrainedSampling }
        : {}),
      replay: REPLAY_SAFE.has(tool.name) ? "safe" : "unsafe",
      async execute(args, api, context) {
        const { content, isError } = await execute(
          { id: api.callId, name: tool.name, arguments: args },
          { abortSignal: context.abortSignal }
        );
        return { output: content, isError };
      }
    };
  });
}
