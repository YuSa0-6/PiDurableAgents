import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, ComposerActions } from "../../ui/composer";

function renderComposer(
  props: Partial<Parameters<typeof Composer>[0]> = {}
) {
  const handlers = {
    onPromptChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn()
  };
  render(
    <Composer
      prompt=""
      connected
      running={false}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("ComposerActions", () => {
  const idle = {
    connected: true,
    running: false,
    onSteer: vi.fn(),
    onStop: vi.fn()
  };

  it("disables Send while the prompt is empty", () => {
    render(<ComposerActions {...idle} prompt="   " />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("disables Send while offline", () => {
    render(<ComposerActions {...idle} prompt="hi" connected={false} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("enables Send when connected with a prompt", () => {
    render(<ComposerActions {...idle} prompt="hi" />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("offers Steer and Stop while running", async () => {
    const onSteer = vi.fn();
    const onStop = vi.fn();
    render(
      <ComposerActions
        {...idle}
        running
        prompt="go left"
        onSteer={onSteer}
        onStop={onStop}
      />
    );
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Steer" }));
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onSteer).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("disables Steer while the prompt is empty, and keeps Stop enabled", () => {
    render(<ComposerActions {...idle} running prompt="" />);
    expect(screen.getByRole("button", { name: "Steer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  });
});

describe("Composer", () => {
  it("reports what the user types", async () => {
    const { onPromptChange } = renderComposer();
    await userEvent.type(screen.getByLabelText("Message Pi"), "h");
    expect(onPromptChange).toHaveBeenCalledWith("h");
  });

  it("submits with the Send button", async () => {
    const { onSubmit } = renderComposer({ prompt: "hello" });
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it("submits on Enter, and not on Shift+Enter", () => {
    const { onSubmit } = renderComposer({ prompt: "hello" });
    const input = screen.getByLabelText("Message Pi");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("disables the prompt while offline", () => {
    renderComposer({ connected: false });
    expect(screen.getByLabelText("Message Pi")).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask Pi to use a tool")).toBeDisabled();
  });

  it("steers and stops a running turn", async () => {
    const { onSubmit, onStop } = renderComposer({
      prompt: "go left",
      running: true
    });
    expect(
      screen.getByPlaceholderText("Queue a follow-up, or steer the running turn")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Steer" }));
    expect(onSubmit).toHaveBeenCalledWith("steer");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
