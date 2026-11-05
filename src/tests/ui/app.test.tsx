import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../ui/app";
import { usePiSession } from "../../use-pi-session";
import { entry, gap, piSession } from "./fixtures";
import type { PiSession } from "./fixtures";

vi.mock("../../use-pi-session", () => ({ usePiSession: vi.fn() }));

const usePiSessionMock = vi.mocked(usePiSession);

function renderApp(overrides: Partial<PiSession> = {}) {
  const session = piSession(overrides);
  usePiSessionMock.mockReturnValue(session);
  return { session, ...render(<App />) };
}

const STORED_SESSION = "abcdef12-0000-4000-8000-000000000000";

beforeEach(() => {
  usePiSessionMock.mockReset();
  localStorage.setItem("pi-harness-session", STORED_SESSION);
});

describe("App session and connection", () => {
  it("opens the stored session and shows it as live", () => {
    renderApp();
    expect(usePiSessionMock).toHaveBeenCalledWith(
      STORED_SESSION
    );
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("creates and stores a session when none is stored", () => {
    localStorage.clear();
    renderApp();
    const stored = localStorage.getItem("pi-harness-session");
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    expect(usePiSessionMock).toHaveBeenCalledWith(stored);
  });

  it.each([
    ["connecting", "Connecting"],
    ["closed", "Reconnecting"]
  ] as const)("shows a %s connection", (status, label) => {
    renderApp({ status });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write a file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

});

describe("App sending", () => {
  it("fills the prompt from a suggestion and sends it", async () => {
    const { session } = renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
    expect(screen.getByLabelText("Message Pi")).toHaveValue(
      "Use exec to run JavaScript that lists /workspace and returns the size of each file."
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(session.submit).toHaveBeenCalledWith(
      "Use exec to run JavaScript that lists /workspace and returns the size of each file.",
      "followUp"
    );
    expect(screen.getByLabelText("Message Pi")).toHaveValue("");
  });

  it("sends a trimmed prompt with Enter and ignores a blank one", async () => {
    const { session } = renderApp();
    const input = screen.getByLabelText("Message Pi");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(session.submit).not.toHaveBeenCalled();
    await userEvent.type(input, "  hi  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(session.submit).toHaveBeenCalledWith("hi", "followUp");
  });

  it("does not send while offline", () => {
    const { session } = renderApp({ status: "closed" });
    fireEvent.submit(screen.getByLabelText("Message Pi").closest("form")!);
    expect(session.submit).not.toHaveBeenCalled();
  });

  it("steers and stops a running turn", async () => {
    const { session } = renderApp({ running: true });
    expect(screen.getByText("Waiting for the model")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message Pi"), "go left");
    await userEvent.click(screen.getByRole("button", { name: "Steer" }));
    expect(session.submit).toHaveBeenCalledWith("go left", "steer");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(session.abort).toHaveBeenCalledOnce();
  });

});

describe("App run status", () => {
  it("shows the running tools, their output, the queue and errors", () => {
    renderApp({
      running: true,
      tools: [
        { callId: "c1", name: "exec", output: "partial output" },
        { callId: "c2", name: "read", output: "" }
      ],
      queued: 2,
      error: "Something broke"
    });
    expect(screen.getByText("Running exec, read")).toBeInTheDocument();
    expect(screen.getByText("partial output")).toBeInTheDocument();
    expect(screen.getByText("2 queued behind this run")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });

  it("shows a retry in place of the run status", () => {
    renderApp({ running: true, retry: { at: 0, error: "rate limited" } });
    expect(screen.getByText("Retrying: rate limited")).toBeInTheDocument();
  });

});

describe("App transcript", () => {
  it("shows the transcript, the live message and the loaders", async () => {
    const missing = gap();
    const { session } = renderApp({
      earlier: true,
      running: true,
      messages: [
        entry("user", [{ type: "text", text: "Write a haiku" }]),
        missing
      ],
      live: entry("assistant", [{ type: "text", text: "Writing it now" }], {
        id: "live"
      })
    });
    expect(screen.queryByText("Ask Pi something that needs a tool")).toBeNull();
    expect(screen.getByText("Write a haiku")).toBeInTheDocument();
    expect(screen.getByText("Writing it now")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the model")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" })
    );
    expect(session.loadEarlier).toHaveBeenCalledOnce();
    await userEvent.click(
      screen.getByRole("button", { name: "Load missing messages" })
    );
    expect(session.fillGap).toHaveBeenCalledWith(missing);
  });

});

describe("App scrolling", () => {
  it("follows new messages only while scrolled to the bottom", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const first = entry("user", [{ type: "text", text: "one" }], { id: "a" });
    const { rerender } = renderApp({ messages: [first] });
    const scroller = screen.getByRole("main");
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 }
    });

    // Scroll up, away from the bottom: new messages no longer scroll.
    scroller.scrollTop = 800;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    scrollIntoView.mockClear();
    const second = entry("user", [{ type: "text", text: "two" }], { id: "b" });
    usePiSessionMock.mockReturnValue(piSession({ messages: [first, second] }));
    rerender(<App />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // Back at the bottom: following resumes.
    scroller.scrollTop = 800;
    fireEvent.scroll(scroller);
    const third = entry("user", [{ type: "text", text: "three" }], { id: "c" });
    usePiSessionMock.mockReturnValue(
      piSession({ messages: [first, second, third] })
    );
    rerender(<App />);
    expect(scrollIntoView).toHaveBeenCalled();
  });

});

describe("App loading earlier messages", () => {
  it("keeps the view in place while earlier messages load", async () => {
    const newest = entry("user", [{ type: "text", text: "newest" }], {
      id: "b"
    });
    const { rerender } = renderApp({ earlier: true, messages: [newest] });
    const scroller = screen.getByRole("main");
    let height = 1000;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => height
    });
    scroller.scrollTop = 300;

    await userEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" })
    );
    // 400px of earlier messages arrive above.
    height = 1400;
    const older = entry("user", [{ type: "text", text: "older" }], { id: "a" });
    usePiSessionMock.mockReturnValue(
      piSession({ earlier: false, messages: [older, newest] })
    );
    rerender(<App />);
    expect(scroller.scrollTop).toBe(700);
  });

});

describe("App header controls", () => {
  it("opens and closes the tools sidebar", async () => {
    renderApp({
      running: true,
      catalog: [
        { name: "exec", description: "Run JavaScript" },
        { name: "read", description: "Read a file" }
      ],
      tools: [{ callId: "c1", name: "exec", output: "" }]
    });
    const toggle = screen.getByRole("button", { name: "Tools" });
    expect(screen.queryByRole("complementary", { name: "Tools" })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Read a file")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close tools" }));
    expect(screen.queryByText("Read a file")).toBeNull();
  });

  it("starts a new session", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "New session" }));
    const next = localStorage.getItem("pi-harness-session");
    expect(next).not.toBe(STORED_SESSION);
    expect(usePiSessionMock).toHaveBeenLastCalledWith(next);
    expect(screen.getByText(next!.slice(0, 8))).toBeInTheDocument();
  });

  it("toggles the color mode", async () => {
    renderApp();
    expect(document.documentElement).toHaveAttribute("data-mode", "light");
    await act(() =>
      userEvent.click(screen.getByRole("button", { name: "Toggle theme" }))
    );
    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
