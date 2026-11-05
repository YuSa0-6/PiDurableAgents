import { Badge, Button } from "@cloudflare/kumo";
import {
  BrainIcon,
  CheckCircleIcon,
  GearIcon,
  XCircleIcon
} from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import type { TranscriptMessage, TranscriptPart } from "../protocol";

/** A message projected from a pi entry: anything but a gap. */
type EntryMessage = Exclude<TranscriptMessage, { role: "gap" }>;

type GapMessage = Extract<TranscriptMessage, { role: "gap" }>;

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-lg bg-kumo-elevated p-2.5 text-xs leading-5 whitespace-pre-wrap break-words">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ToolCallCard({
  part,
  running
}: {
  part: Extract<TranscriptPart, { type: "tool-call" }>;
  running: boolean;
}) {
  return (
    <details className="rounded-xl border border-kumo-line bg-kumo-base">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        {running ? (
          <GearIcon size={14} className="animate-spin text-kumo-inactive" />
        ) : (
          <CheckCircleIcon size={14} className="text-kumo-success" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {part.name}
        </span>
        <Badge variant="secondary">{running ? "Running" : "Called"}</Badge>
      </summary>
      <div className="border-t border-kumo-line px-3 py-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-kumo-inactive">
          Arguments
        </p>
        <JsonBlock value={part.arguments} />
      </div>
    </details>
  );
}

export function ToolResultCard({
  part
}: {
  part: Extract<TranscriptPart, { type: "tool-result" }>;
}) {
  const text = part.content
    .filter((content) => content.type === "text")
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("\n");
  const images = part.content.filter((content) => content.type === "image");
  return (
    <details className="rounded-xl border border-kumo-line bg-kumo-base">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        {part.error ? (
          <XCircleIcon size={14} className="text-kumo-danger" />
        ) : (
          <CheckCircleIcon size={14} className="text-kumo-success" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold">{part.name}</span>
          {text ? <span className="ml-2 text-kumo-subtle">{text}</span> : null}
        </span>
        <Badge variant={part.error ? "destructive" : "secondary"}>
          {part.error ? "Failed" : "Done"}
        </Badge>
      </summary>
      <div className="space-y-3 border-t border-kumo-line px-3 py-3">
        {text ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-kumo-inactive">
              Result
            </p>
            <JsonBlock value={text} />
          </div>
        ) : null}
        {images.map((image, index) =>
          image.type === "image" ? (
            <img
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={`${part.name} output`}
              className="max-w-full rounded-lg"
            />
          ) : null
        )}
        {part.details !== undefined ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-kumo-inactive">
              Details
            </p>
            <JsonBlock value={part.details} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function AssistantPart({
  part,
  running
}: {
  part: TranscriptPart;
  running: boolean;
}) {
  switch (part.type) {
    case "text":
      return (
        <Streamdown
          className="sd-theme text-sm leading-6"
          controls={false}
        >
          {part.text}
        </Streamdown>
      );
    case "thinking":
      return (
        <details className="rounded-xl border border-kumo-line px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-semibold text-kumo-subtle">
            Thinking
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs italic leading-5 text-kumo-subtle">
            {part.text}
          </p>
        </details>
      );
    case "tool-call":
      return <ToolCallCard part={part} running={running} />;
    case "tool-result":
      return <ToolResultCard part={part} />;
    case "image":
      return (
        <img
          src={`data:${part.mimeType};base64,${part.data}`}
          alt=""
          className="max-w-full rounded-lg"
        />
      );
  }
}

function UserMessage({ message }: { message: EntryMessage }) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-kumo-contrast px-4 py-2.5 text-sm leading-relaxed text-kumo-inverse">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  streaming = false,
  runningTools
}: {
  message: EntryMessage;
  streaming?: boolean;
  runningTools: readonly string[];
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-brand text-white">
        <BrainIcon size={17} weight="bold" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {message.parts.map((part, index) => (
          <AssistantPart
            key={`${message.id}-${index}`}
            part={part}
            running={
              streaming &&
              part.type === "tool-call" &&
              runningTools.includes(part.name)
            }
          />
        ))}
        {streaming ? <span className="streaming-cursor" /> : null}
        {message.error ? (
          <div
            role="alert"
            className="rounded-xl bg-kumo-danger/10 px-4 py-3 text-sm text-kumo-danger"
          >
            {message.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolMessage({ message }: { message: EntryMessage }) {
  return (
    <div className="ml-11 space-y-2">
      {message.parts.map((part, index) =>
        part.type === "tool-result" ? (
          <ToolResultCard key={`${message.id}-${index}`} part={part} />
        ) : null
      )}
    </div>
  );
}

/** A compaction: the model now reads this summary instead of what came before. */
function SummaryNotice({ message }: { message: EntryMessage }) {
  const summary = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  return (
    <details className="group text-center text-xs text-kumo-inactive">
      <summary className="cursor-pointer list-none hover:text-kumo-subtle">
        Earlier messages summarized
        <span className="group-open:hidden"> · Show summary</span>
      </summary>
      <div className="mt-2 rounded-xl border border-kumo-line bg-kumo-base px-4 py-3 text-left">
        <Streamdown
          className="sd-theme sd-summary text-xs leading-5 text-kumo-subtle"
          controls={false}
        >
          {summary}
        </Streamdown>
      </div>
    </details>
  );
}

export function Message({
  message,
  streaming = false,
  runningTools,
  loading = false,
  onFillGap
}: {
  message: TranscriptMessage;
  streaming?: boolean;
  runningTools: readonly string[];
  loading?: boolean;
  onFillGap?: (gap: GapMessage) => void;
}) {
  switch (message.role) {
    case "user":
      return <UserMessage message={message} />;
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          streaming={streaming}
          runningTools={runningTools}
        />
      );
    case "tool":
      return <ToolMessage message={message} />;
    case "notice":
      return message.parts.length === 0 ? null : (
        <p className="text-center text-xs text-kumo-inactive">
          {message.parts
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("")}
        </p>
      );
    case "summary":
      return <SummaryNotice message={message} />;
    case "gap":
      // Entries this tab missed while it was away.
      return (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            onClick={() => onFillGap?.(message)}
          >
            Load missing messages
          </Button>
        </div>
      );
  }
}
