import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Surface,
  Text
} from "@cloudflare/kumo";
import {
  ArrowUpIcon,
  BrainIcon,
  CheckCircleIcon,
  CodeIcon,
  FilePlusIcon,
  GearIcon,
  GitBranchIcon,
  MoonIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  StopIcon,
  SunIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Streamdown } from "streamdown";
import type { ToolInfo, TranscriptMessage, TranscriptPart } from "./protocol";
import { usePiSession } from "./use-pi-session";
import "./styles.css";

const SESSION_KEY = "pi-harness-session";
/** How close to the bottom (px) still counts as "at the bottom". */
const BOTTOM_THRESHOLD = 32;

/** A message projected from a pi entry: anything but a gap. */
type EntryMessage = Exclude<TranscriptMessage, { role: "gap" }>;

const SUGGESTIONS = [
  {
    icon: <FilePlusIcon size={15} />,
    label: "Write a file",
    value:
      "Write a haiku about Durable Objects to /workspace/haiku.txt, then read it back."
  },
  {
    icon: <CodeIcon size={15} />,
    label: "Run JavaScript",
    value:
      "Use exec to run JavaScript that lists /workspace and returns the size of each file."
  },
  {
    icon: <GitBranchIcon size={15} />,
    label: "Clone a repo",
    value:
      "Clone https://github.com/octocat/Hello-World into /workspace/hello, then show its git log."
  }
] satisfies Array<{ icon: ReactNode; label: string; value: string }>;

function getSession(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") ?? "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((value) => (value === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

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

function ToolResultCard({
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

function AssistantPart({
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

function Message({
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
  onFillGap?: (gap: Extract<TranscriptMessage, { role: "gap" }>) => void;
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

function Sidebar({
  tools,
  activeTools,
  onClose
}: {
  tools: readonly ToolInfo[];
  activeTools: readonly string[];
  onClose: () => void;
}) {
  return (
    <aside
      className="flex min-h-0 flex-col border-l border-kumo-line bg-kumo-base"
      aria-label="Tools"
    >
      <div className="flex h-[68px] shrink-0 items-center justify-between gap-2 border-b border-kumo-line px-4">
        <Text size="sm" bold>
          Tools
        </Text>
        <Button
          variant="ghost"
          shape="square"
          aria-label="Close tools"
          onClick={onClose}
          icon={<XIcon size={16} />}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {tools.map((tool) => (
          <Surface
            key={tool.name}
            className="rounded-lg p-3 ring ring-kumo-line"
          >
            <div className="flex items-center gap-2">
              {activeTools.includes(tool.name) ? (
                <GearIcon size={14} className="animate-spin text-kumo-accent" />
              ) : (
                <WrenchIcon size={14} className="text-kumo-inactive" />
              )}
              <code className="text-xs font-semibold">{tool.name}</code>
            </div>
            <p className="mt-1 text-xs text-kumo-subtle">{tool.description}</p>
          </Surface>
        ))}
      </div>
    </aside>
  );
}

type PiSession = ReturnType<typeof usePiSession>;
type WhenBusy = "followUp" | "steer";

/**
 * Keep the conversation scrolled: follow new messages at the bottom, and
 * keep the screen in place while earlier messages load above.
 */
function useChatScroll(
  messages: PiSession["messages"],
  live: PiSession["live"],
  running: boolean,
  loading: boolean
) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  // Distance from the bottom to keep while earlier messages load above.
  const keepFromBottom = useRef<number | null>(null);
  // Whether the reader is at the bottom: new messages scroll into view only
  // then, not while they read earlier ones.
  const following = useRef(true);
  const lastScrollTop = useRef(0);
  const newestId = messages.at(-1)?.id;
  const oldestId = messages[0]?.id;

  // Follow new messages, not the earlier ones loading above.
  useEffect(() => {
    if (following.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [newestId, live, running]);

  // Earlier messages loaded above: keep what was on screen in place.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null && keepFromBottom.current !== null) {
      scroller.scrollTop = scroller.scrollHeight - keepFromBottom.current;
    }
    if (!loading) keepFromBottom.current = null;
  }, [oldestId, loading]);

  // Scrolling up stops following; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const fromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (fromBottom <= BOTTOM_THRESHOLD) following.current = true;
    else if (scroller.scrollTop < lastScrollTop.current - 1) {
      following.current = false;
    }
    lastScrollTop.current = scroller.scrollTop;
  };

  /** Remember the distance from the bottom before earlier messages load. */
  const keepPosition = () => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      keepFromBottom.current = scroller.scrollHeight - scroller.scrollTop;
    }
  };

  /** Bring the conversation back to the bottom on the next message. */
  const follow = () => {
    following.current = true;
  };

  return { endRef, scrollRef, onScroll, keepPosition, follow };
}

const STATUS_LABEL: Record<PiSession["status"], string> = {
  open: "Live",
  connecting: "Connecting",
  closed: "Reconnecting"
};

function ChatHeader({
  session,
  model,
  status,
  toolsOpen,
  onToggleTools,
  onNewSession
}: {
  session: string;
  /** The model that wrote the newest answer, if any. */
  model: string | undefined;
  status: PiSession["status"];
  toolsOpen: boolean;
  onToggleTools: () => void;
  onNewSession: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-kumo-line bg-kumo-base">
      <div className="mx-auto flex h-[68px] max-w-3xl items-center justify-between gap-3 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-kumo-brand text-white">
            <BrainIcon size={20} weight="bold" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">D1Agents · Pi Durable</h1>
            <p className="truncate text-xs text-kumo-subtle">
              Session <code>{session.slice(0, 8)}</code>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {model ? model.split("/").at(-1) : "auto · d1.1"}
          </Badge>
          <Badge variant={status === "open" ? "success" : "secondary"}>
            {STATUS_LABEL[status]}
          </Badge>
          <Button
            variant="ghost"
            shape="square"
            aria-label="Tools"
            aria-expanded={toolsOpen}
            onClick={onToggleTools}
            icon={<WrenchIcon size={16} />}
          />
          <Button
            variant="ghost"
            shape="square"
            aria-label="New session"
            onClick={onNewSession}
            icon={<PlusIcon size={16} />}
          />
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}

function EmptyState({
  connected,
  onSuggest
}: {
  connected: boolean;
  onSuggest: (value: string) => void;
}) {
  return (
    <div className="py-10 sm:py-16">
      <Empty
        icon={<BrainIcon size={32} />}
        title="Ask Pi something that needs a tool"
        description="Tool calls and results stream in as they happen."
      />
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.label}
            variant="secondary"
            size="sm"
            icon={suggestion.icon}
            disabled={!connected}
            onClick={() => onSuggest(suggestion.value)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function runStatusText(
  retry: PiSession["retry"],
  runningTools: readonly string[]
): string {
  if (retry) return `Retrying: ${retry.error}`;
  if (runningTools.length > 0) return `Running ${runningTools.join(", ")}`;
  return "Waiting for the model";
}

/** Shown while a run is going and no message is streaming yet. */
function RunStatus({
  retry,
  runningTools
}: {
  retry: PiSession["retry"];
  runningTools: readonly string[];
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-brand text-white">
        <BrainIcon size={17} weight="bold" />
      </div>
      <Surface className="rounded-xl px-4 py-3 ring ring-kumo-line">
        <div className="flex items-center gap-2 text-sm text-kumo-subtle">
          <GearIcon size={15} className="animate-spin" />
          {runStatusText(retry, runningTools)}
        </div>
      </Surface>
    </div>
  );
}

/** Live output of the tools that are running. */
function ToolOutputs({ tools }: { tools: PiSession["tools"] }) {
  return tools.map((tool) =>
    tool.output ? (
      <pre
        key={tool.callId}
        className="ml-11 max-h-40 overflow-auto rounded-lg bg-kumo-elevated p-2.5 text-xs"
      >
        {tool.output}
      </pre>
    ) : null
  );
}

/** The send button, or Steer and Stop while a run is going. */
function ComposerActions({
  running,
  connected,
  hasText,
  onSteer,
  onStop
}: {
  running: boolean;
  connected: boolean;
  hasText: boolean;
  onSteer: () => void;
  onStop: () => void;
}) {
  if (!running) {
    return (
      <Button
        type="submit"
        variant="primary"
        shape="square"
        aria-label="Send message"
        disabled={!connected || !hasText}
        icon={<PaperPlaneRightIcon size={18} />}
        className="mb-0.5"
      />
    );
  }
  return (
    <div className="mb-0.5 flex gap-1.5">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label="Steer"
        disabled={!hasText}
        onClick={onSteer}
      >
        Steer
      </Button>
      <Button
        type="button"
        variant="secondary"
        shape="square"
        aria-label="Stop"
        onClick={onStop}
        icon={<StopIcon size={18} weight="fill" />}
      />
    </div>
  );
}

function Composer({
  prompt,
  onPromptChange,
  connected,
  running,
  onSubmit,
  onStop
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  connected: boolean;
  running: boolean;
  onSubmit: (whenBusy?: WhenBusy) => void;
  onStop: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-kumo-line bg-kumo-base">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mx-auto max-w-3xl px-5 pt-4"
      >
        <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm transition-shadow focus-within:border-transparent focus-within:ring-2 focus-within:ring-kumo-ring">
          <InputArea
            value={prompt}
            onValueChange={onPromptChange}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              running
                ? "Queue a follow-up, or steer the running turn"
                : "Ask Pi to use a tool"
            }
            aria-label="Message Pi"
            disabled={!connected}
            rows={2}
            className="flex-1 !bg-transparent !shadow-none !ring-0 !outline-none focus:!ring-0"
          />
          <ComposerActions
            running={running}
            connected={connected}
            hasText={prompt.trim() !== ""}
            onSteer={() => onSubmit("steer")}
            onStop={onStop}
          />
        </div>
      </form>
      <div className="flex items-center justify-center gap-2 px-5 py-3">
        <span className="hidden text-[10px] text-kumo-inactive sm:inline">
          Enter to send · Shift+Enter for a new line
        </span>
        <span className="hidden text-kumo-line sm:inline">·</span>
        <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(getSession);
  const [prompt, setPrompt] = useState("");
  const [toolsOpen, setToolsOpen] = useState(
    () => window.matchMedia("(min-width: 1100px)").matches
  );
  const {
    status,
    messages,
    earlier,
    loading,
    live,
    running,
    tools,
    catalog,
    queued,
    retry,
    error,
    submit: submitPrompt,
    abort,
    loadEarlier,
    fillGap
  } = usePiSession(session);
  const scroll = useChatScroll(messages, live, running, loading);
  const runningTools = tools.map((tool) => tool.name);
  const connected = status === "open";

  const showEarlier = () => {
    scroll.keepPosition();
    loadEarlier();
  };

  /** While a run is going, Enter queues a follow-up and Steer joins the run. */
  const submit = (whenBusy: WhenBusy = "followUp") => {
    const text = prompt.trim();
    if (!text || !connected) return;
    setPrompt("");
    // Sending a message always brings the conversation back to the bottom.
    scroll.follow();
    submitPrompt(text, whenBusy);
  };

  const newSession = () => {
    const next = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, next);
    scroll.follow();
    setSession(next);
  };

  const empty = messages.length === 0 && !earlier && !live && !running;
  // The model that wrote the newest answer: the DecisionModel picks it per request.
  const lastModel = [...messages]
    .reverse()
    .flatMap((message) =>
      message.role === "assistant" && "model" in message && message.model
        ? [message.model]
        : []
    )[0];

  return (
    <div
      className={`grid h-dvh overflow-hidden bg-kumo-elevated text-kumo-default ${
        toolsOpen
          ? "lg:grid-cols-[minmax(520px,1fr)_minmax(300px,26vw)]"
          : "grid-cols-1"
      }`}
    >
      <section className="flex min-h-0 min-w-0 flex-col" aria-label="Chat">
        <ChatHeader
          session={session}
          model={lastModel}
          status={status}
          toolsOpen={toolsOpen}
          onToggleTools={() => setToolsOpen((open) => !open)}
          onNewSession={newSession}
        />

        <main
          ref={scroll.scrollRef}
          onScroll={scroll.onScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
            {empty ? (
              <EmptyState connected={connected} onSuggest={setPrompt} />
            ) : null}

            {earlier ? (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowUpIcon size={14} />}
                  loading={loading}
                  onClick={showEarlier}
                >
                  Load earlier messages
                </Button>
              </div>
            ) : null}

            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                runningTools={runningTools}
                loading={loading}
                onFillGap={fillGap}
              />
            ))}

            {live ? (
              <Message message={live} streaming runningTools={runningTools} />
            ) : null}

            {running && !live ? (
              <RunStatus retry={retry} runningTools={runningTools} />
            ) : null}

            <ToolOutputs tools={tools} />

            {queued > 0 ? (
              <p className="ml-11 text-xs text-kumo-subtle">
                {queued} queued behind this run
              </p>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-xl bg-kumo-danger/10 px-4 py-3 text-sm text-kumo-danger"
              >
                {error}
              </div>
            ) : null}

            <div ref={scroll.endRef} />
          </div>
        </main>

        <Composer
          prompt={prompt}
          onPromptChange={setPrompt}
          connected={connected}
          running={running}
          onSubmit={submit}
          onStop={abort}
        />
      </section>

      {toolsOpen ? (
        <Sidebar
          tools={catalog}
          activeTools={runningTools}
          onClose={() => setToolsOpen(false)}
        />
      ) : null}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
