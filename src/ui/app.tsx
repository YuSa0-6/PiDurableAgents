import {
  Badge,
  Button,
  Empty,
  PoweredByCloudflare,
  Surface,
  Text
} from "@cloudflare/kumo";
import {
  ArrowUpIcon,
  BrainIcon,
  CodeIcon,
  FilePlusIcon,
  GearIcon,
  GitBranchIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  WrenchIcon,
  XIcon
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ToolInfo } from "../protocol";
import { usePiSession } from "../use-pi-session";
import { Composer } from "./composer";
import type { WhenBusy } from "./composer";
import { Message } from "./messages";

const SESSION_KEY = "pi-harness-session";
/** How close to the bottom (px) still counts as "at the bottom". */
const BOTTOM_THRESHOLD = 32;

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

type PiSession = ReturnType<typeof usePiSession>;
type ConnectionStatus = PiSession["status"];

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  open: "Live",
  connecting: "Connecting",
  closed: "Reconnecting"
};

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

function Header({
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
  status: ConnectionStatus;
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
            <h1 className="truncate text-base font-semibold">
              D1Agents · Pi Durable
            </h1>
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
            {CONNECTION_LABELS[status]}
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
  onPick
}: {
  connected: boolean;
  onPick: (prompt: string) => void;
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
            onClick={() => onPick(suggestion.value)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The model that wrote the newest answer: the DecisionModel picks it per
 * request.
 */
function lastModel(messages: PiSession["messages"]): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant" && "model" in message && message.model) {
      return message.model;
    }
  }
  return undefined;
}

/** What a run is doing before the model streams anything. */
function runStatusText(
  retry: { readonly error: string } | null,
  runningTools: readonly string[]
): string {
  if (retry) return `Retrying: ${retry.error}`;
  if (runningTools.length > 0) return `Running ${runningTools.join(", ")}`;
  return "Waiting for the model";
}

function RunStatus({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-brand text-white">
        <BrainIcon size={17} weight="bold" />
      </div>
      <Surface className="rounded-xl px-4 py-3 ring ring-kumo-line">
        <div className="flex items-center gap-2 text-sm text-kumo-subtle">
          <GearIcon size={15} className="animate-spin" />
          {text}
        </div>
      </Surface>
    </div>
  );
}

function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-kumo-danger/10 px-4 py-3 text-sm text-kumo-danger"
    >
      {children}
    </div>
  );
}

/**
 * Keeps the transcript scrolled the way a reader expects: new messages
 * scroll into view while the reader is at the bottom, and earlier messages
 * loading above keep what is on screen in place.
 */
function useTranscriptScroll({
  newestId,
  oldestId,
  live,
  running,
  loading
}: {
  newestId: string | undefined;
  oldestId: string | undefined;
  live: unknown;
  running: boolean;
  loading: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  // Distance from the bottom to keep while earlier messages load above.
  const keepFromBottom = useRef<number | null>(null);
  // Whether the reader is at the bottom: new messages scroll into view only
  // then, not while they read earlier ones.
  const following = useRef(true);
  const lastScrollTop = useRef(0);

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

  return {
    endRef,
    scrollRef,
    /** Scrolling up stops following; scrolling back to the bottom resumes it. */
    onScroll: () => {
      const scroller = scrollRef.current;
      if (scroller === null) return;
      const fromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (fromBottom <= BOTTOM_THRESHOLD) following.current = true;
      else if (scroller.scrollTop < lastScrollTop.current - 1) {
        following.current = false;
      }
      lastScrollTop.current = scroller.scrollTop;
    },
    /** Call before earlier messages load above the current ones. */
    keepPosition: () => {
      const scroller = scrollRef.current;
      if (scroller !== null) {
        keepFromBottom.current = scroller.scrollHeight - scroller.scrollTop;
      }
    },
    /** Bring the conversation back to the bottom on the next message. */
    follow: () => {
      following.current = true;
    }
  };
}

function LoadEarlierButton({
  loading,
  onClick
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowUpIcon size={14} />}
        loading={loading}
        onClick={onClick}
      >
        Load earlier messages
      </Button>
    </div>
  );
}

/** What the running tools have printed so far. */
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

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-kumo-line bg-kumo-base">
      {children}
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

/** Nothing to show yet: no messages, none earlier, and no run going. */
function isEmpty(view: PiSession): boolean {
  return (
    view.messages.length === 0 && !view.earlier && !view.live && !view.running
  );
}

/** The conversation: messages, the live reply, and what the run is doing. */
function Transcript({
  view,
  connected,
  onPick,
  onLoadEarlier
}: {
  view: PiSession;
  connected: boolean;
  onPick: (prompt: string) => void;
  onLoadEarlier: () => void;
}) {
  const { messages, earlier, loading, live, running, retry, queued, error } =
    view;
  const runningTools = view.tools.map((tool) => tool.name);
  return (
    <>
      {isEmpty(view) ? (
        <EmptyState connected={connected} onPick={onPick} />
      ) : null}

      {earlier ? (
        <LoadEarlierButton loading={loading} onClick={onLoadEarlier} />
      ) : null}

      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          runningTools={runningTools}
          loading={loading}
          onFillGap={view.fillGap}
        />
      ))}

      {live ? (
        <Message message={live} streaming runningTools={runningTools} />
      ) : null}

      {running && !live ? (
        <RunStatus text={runStatusText(retry, runningTools)} />
      ) : null}

      <ToolOutputs tools={view.tools} />

      {queued > 0 ? (
        <p className="ml-11 text-xs text-kumo-subtle">
          {queued} queued behind this run
        </p>
      ) : null}

      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
    </>
  );
}

type TranscriptScroll = ReturnType<typeof useTranscriptScroll>;

/** The scrolling transcript and the prompt box below it. */
function Chat({
  view,
  scroll
}: {
  view: PiSession;
  scroll: TranscriptScroll;
}) {
  const [prompt, setPrompt] = useState("");
  const connected = view.status === "open";

  /** While a run is going, Enter queues a follow-up and Steer joins the run. */
  const submit = (whenBusy: WhenBusy = "followUp") => {
    const text = prompt.trim();
    if (!text || !connected) return;
    setPrompt("");
    // Sending a message always brings the conversation back to the bottom.
    scroll.follow();
    view.submit(text, whenBusy);
  };

  return (
    <>
      <main
        ref={scroll.scrollRef}
        onScroll={scroll.onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
          <Transcript
            view={view}
            connected={connected}
            onPick={setPrompt}
            onLoadEarlier={() => {
              scroll.keepPosition();
              view.loadEarlier();
            }}
          />
          <div ref={scroll.endRef} />
        </div>
      </main>
      <Footer>
        <Composer
          prompt={prompt}
          onPromptChange={setPrompt}
          connected={connected}
          running={view.running}
          onSubmit={submit}
          onStop={view.abort}
        />
      </Footer>
    </>
  );
}

export function App() {
  const [session, setSession] = useState(getSession);
  const [toolsOpen, setToolsOpen] = useState(
    () => window.matchMedia("(min-width: 1100px)").matches
  );
  const view = usePiSession(session);
  const scroll = useTranscriptScroll({
    newestId: view.messages.at(-1)?.id,
    oldestId: view.messages[0]?.id,
    live: view.live,
    running: view.running,
    loading: view.loading
  });

  const newSession = () => {
    const next = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, next);
    scroll.follow();
    setSession(next);
  };

  return (
    <div
      className={`grid h-dvh overflow-hidden bg-kumo-elevated text-kumo-default ${
        toolsOpen
          ? "lg:grid-cols-[minmax(520px,1fr)_minmax(300px,26vw)]"
          : "grid-cols-1"
      }`}
    >
      <section className="flex min-h-0 min-w-0 flex-col" aria-label="Chat">
        <Header
          session={session}
          model={lastModel(view.messages)}
          status={view.status}
          toolsOpen={toolsOpen}
          onToggleTools={() => setToolsOpen((open) => !open)}
          onNewSession={newSession}
        />
        <Chat view={view} scroll={scroll} />
      </section>

      {toolsOpen ? (
        <Sidebar
          tools={view.catalog}
          activeTools={view.tools.map((tool) => tool.name)}
          onClose={() => setToolsOpen(false)}
        />
      ) : null}
    </div>
  );
}
