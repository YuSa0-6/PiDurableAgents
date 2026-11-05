import { Button, InputArea } from "@cloudflare/kumo";
import { PaperPlaneRightIcon, StopIcon } from "@phosphor-icons/react";

/** How a prompt joins a run that is already going. */
export type WhenBusy = "followUp" | "steer";

/**
 * The buttons beside the prompt. While a run is going: Steer (joins the run)
 * and Stop. Otherwise: Send.
 */
export function ComposerActions({
  prompt,
  connected,
  running,
  onSteer,
  onStop
}: {
  prompt: string;
  connected: boolean;
  running: boolean;
  onSteer: () => void;
  onStop: () => void;
}) {
  const empty = prompt.trim() === "";
  if (running) {
    return (
      <div className="mb-0.5 flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Steer"
          disabled={empty}
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
  return (
    <Button
      type="submit"
      variant="primary"
      shape="square"
      aria-label="Send message"
      disabled={!connected || empty}
      icon={<PaperPlaneRightIcon size={18} />}
      className="mb-0.5"
    />
  );
}

/**
 * The prompt box. Enter sends (Shift+Enter adds a new line); while a run is
 * going, sending queues a follow-up and Steer joins the run.
 */
export function Composer({
  prompt,
  onPromptChange,
  connected,
  running,
  onSubmit,
  onStop
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  connected: boolean;
  running: boolean;
  onSubmit: (whenBusy?: WhenBusy) => void;
  onStop: () => void;
}) {
  return (
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
          prompt={prompt}
          connected={connected}
          running={running}
          onSteer={() => onSubmit("steer")}
          onStop={onStop}
        />
      </div>
    </form>
  );
}
