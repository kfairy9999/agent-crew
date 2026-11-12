import { useCallback, useState } from "react";
import { createBlackboard, createSseParser, reduce, type Blackboard, type CrewEvent, type RunMode } from "../../core";

export function useCrew() {
  const [state, setState] = useState<Blackboard>(() => createBlackboard());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  const run = useCallback(async (topic: string, mode: RunMode) => {
    controller?.abort();
    const next = new AbortController();
    setController(next);
    setError(null);
    setRunning(true);
    setState(createBlackboard({ topic, mode }));
    try {
      await streamRun({ topic, mode, pace: "realtime" }, next.signal, (event) => {
        setState((current) => reduce(current, event));
      });
    } catch (caught) {
      if (next.signal.aborted) {
        setState((current) =>
          current.status === "running" || current.status === "pending"
            ? reduce(current, { type: "run_finished", status: "stopped", usage: current.usage })
            : current,
        );
      } else {
        setError(caught instanceof Error ? caught.message : "The run failed.");
      }
    } finally {
      setRunning(false);
    }
  }, [controller]);

  const stop = useCallback(() => {
    controller?.abort();
  }, [controller]);

  const restore = useCallback((board: Blackboard) => {
    setError(null);
    setRunning(false);
    setState(board);
  }, []);

  return { state, running, error, run, stop, restore };
}

async function streamRun(
  body: { topic: string; mode: RunMode; pace: "realtime" },
  signal: AbortSignal,
  onEvent: (event: CrewEvent) => void,
): Promise<void> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = `The run was refused (${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // The status line is enough when the body is not JSON.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("The run returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((data) => {
    onEvent(JSON.parse(data) as CrewEvent);
  });
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.flush();
}
