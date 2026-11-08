import type { CrewEvent } from "./types";

export type Pace = "instant" | "realtime";

export function delayFor(event: CrewEvent): number {
  switch (event.type) {
    case "run_started":
    case "usage":
      return 0;
    case "status":
      return 180;
    case "plan":
      return 260;
    case "thought":
      return 620;
    case "notes":
      return 340;
    case "tool_call":
      return 360;
    case "tool_result":
      return 480;
    case "handoff":
      return 540;
    case "revision":
      return 420;
    case "report":
      return 280;
    case "error":
      return 80;
    case "run_finished":
      return 140;
    default:
      return 200;
  }
}

export async function* paceEvents(
  events: AsyncIterable<CrewEvent>,
  options: {
    pace: Pace;
    sleep: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  },
): AsyncGenerator<CrewEvent> {
  let first = true;
  for await (const event of events) {
    if (options.signal?.aborted) return;
    if (!first && options.pace === "realtime") {
      const ms = delayFor(event);
      if (ms > 0) await options.sleep(ms);
    }
    first = false;
    if (options.signal?.aborted) return;
    yield event;
  }
}
