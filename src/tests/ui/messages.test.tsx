import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantPart, Message, ToolResultCard } from "../../ui/messages";
import { PIXEL, entry, gap, toolResult } from "./fixtures";

describe("Message from the user or assistant", () => {
  it("shows a user message as its text parts joined", () => {
    render(
      <Message
        message={entry("user", [
          { type: "text", text: "Hello " },
          { type: "image", data: PIXEL, mimeType: "image/png" },
          { type: "text", text: "Pi" }
        ])}
        runningTools={[]}
      />
    );
    expect(screen.getByText("Hello Pi")).toBeInTheDocument();
  });

  it("shows each part of an assistant message", () => {
    const { container } = render(
      <Message
        message={entry("assistant", [
          { type: "thinking", text: "Let me look" },
          { type: "text", text: "Here is the file." },
          { type: "tool-call", id: "c1", name: "read", arguments: { path: "/a" } }
        ])}
        runningTools={[]}
      />
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Let me look")).toBeInTheDocument();
    expect(screen.getByText("Here is the file.")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("Called")).toBeInTheDocument();
    expect(container.querySelector(".streaming-cursor")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a streaming assistant's tool call as running", () => {
    const { container } = render(
      <Message
        message={entry("assistant", [
          { type: "tool-call", id: "c1", name: "exec", arguments: {} },
          { type: "tool-call", id: "c2", name: "read", arguments: {} }
        ])}
        streaming
        runningTools={["exec"]}
      />
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Called")).toBeInTheDocument();
    expect(container.querySelector(".streaming-cursor")).not.toBeNull();
  });

  it("shows an assistant message's error as an alert", () => {
    render(
      <Message
        message={entry("assistant", [], { error: "Model overloaded" })}
        runningTools={[]}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Model overloaded");
  });

});

describe("Message from a tool, notice or summary", () => {
  it("shows only the tool results of a tool message", () => {
    render(
      <Message
        message={entry("tool", [
          { type: "text", text: "ignored" },
          toolResult({ name: "read" }),
          toolResult({ id: "call-2", name: "write" })
        ])}
        runningTools={[]}
      />
    );
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("shows a notice as a line of text", () => {
    render(
      <Message
        message={entry("notice", [{ type: "text", text: "Context reset" }])}
        runningTools={[]}
      />
    );
    expect(screen.getByText("Context reset")).toBeInTheDocument();
  });

  it("shows nothing for an empty notice", () => {
    const { container } = render(
      <Message message={entry("notice", [])} runningTools={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a summary behind a disclosure", () => {
    render(
      <Message
        message={entry("summary", [
          { type: "text", text: "The user asked for a haiku." }
        ])}
        runningTools={[]}
      />
    );
    expect(screen.getByText("Earlier messages summarized")).toBeInTheDocument();
    expect(screen.getByText("The user asked for a haiku.")).toBeInTheDocument();
  });

});

describe("Message for a gap", () => {
  it("offers to load the messages a gap stands for", async () => {
    const onFillGap = vi.fn();
    const message = gap();
    render(
      <Message message={message} runningTools={[]} onFillGap={onFillGap} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Load missing messages" })
    );
    expect(onFillGap).toHaveBeenCalledWith(message);
  });

  it("shows a gap without a handler", async () => {
    render(<Message message={gap()} runningTools={[]} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Load missing messages" })
    );
    expect(
      screen.getByRole("button", { name: "Load missing messages" })
    ).toBeInTheDocument();
  });
});

describe("ToolResultCard status", () => {
  it("shows a successful result with its text", () => {
    render(<ToolResultCard part={toolResult()} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    // Once in the summary line and once in the result block.
    expect(screen.getAllByText("file contents")).toHaveLength(2);
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("shows a failed result", () => {
    render(
      <ToolResultCard
        part={toolResult({
          content: [{ type: "text", text: "ENOENT" }],
          error: true
        })}
      />
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Done")).toBeNull();
  });

});

describe("ToolResultCard content", () => {
  it("shows images and details, and no result block without text", () => {
    render(
      <ToolResultCard
        part={toolResult({
          name: "screenshot",
          content: [{ type: "image", data: PIXEL, mimeType: "image/png" }],
          details: { width: 1, height: 1 }
        })}
      />
    );
    const image = screen.getByRole("img", { name: "screenshot output" });
    expect(image).toHaveAttribute("src", `data:image/png;base64,${PIXEL}`);
    expect(screen.queryByText("Result")).toBeNull();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText(/"width": 1/)).toBeInTheDocument();
  });

  it("joins several text blocks into one result", () => {
    render(
      <ToolResultCard
        part={toolResult({
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" }
          ]
        })}
      />
    );
    expect(screen.getAllByText(/line one\s+line two/)).toHaveLength(2);
  });
});

describe("AssistantPart", () => {
  it("shows an image part", () => {
    const { container } = render(
      <AssistantPart
        part={{ type: "image", data: PIXEL, mimeType: "image/png" }}
        running={false}
      />
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      `data:image/png;base64,${PIXEL}`
    );
  });

  it("shows a tool result part", () => {
    render(<AssistantPart part={toolResult()} running={false} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows a tool call's arguments", () => {
    render(
      <AssistantPart
        part={{
          type: "tool-call",
          id: "c1",
          name: "write",
          arguments: { path: "/workspace/haiku.txt" }
        }}
        running
      />
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText(/\/workspace\/haiku\.txt/)).toBeInTheDocument();
  });

  it("shows a string tool-call argument as is", () => {
    render(
      <AssistantPart
        part={{ type: "tool-call", id: "c1", name: "exec", arguments: "1 + 1" }}
        running={false}
      />
    );
    expect(screen.getByText("1 + 1")).toBeInTheDocument();
  });
});
