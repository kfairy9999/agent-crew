import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("reassembles events split across chunks", () => {
    const seen: string[] = [];
    const parser = createSseParser((data) => seen.push(data));
    parser.push('event: crew\ndata: {"type":"thou');
    parser.push('ght"}\n\ndata: {"type":"done"}\n\n');
    expect(seen).toEqual(['{"type":"thought"}', '{"type":"done"}']);
  });
});
