import { describe, expect, it } from "vitest";
import { USER_AGENT } from "../llm/constants";
import { WikipediaSearch } from "./wikipedia";

describe("WikipediaSearch", () => {
  it("sends a descriptive user agent and maps extracts to sources", async () => {
    const urls: string[] = [];
    const search = new WikipediaSearch(async (input, init) => {
      urls.push(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("user-agent")).toBe(USER_AGENT);
      if (urls.length === 1) {
        return Response.json({
          query: { search: [{ title: "Multi-agent system", pageid: 42, snippet: "<span>agents</span>" }] },
        });
      }
      return Response.json({
        query: {
          pages: {
            "42": {
              title: "Multi-agent system",
              extract: "Several agents share an environment.",
              fullurl: "https://en.wikipedia.org/wiki/Multi-agent_system",
              pageid: 42,
            },
          },
        },
      });
    });
    const hits = await search.search("multi-agent", 2);
    expect(hits).toEqual([
      {
        title: "Multi-agent system",
        url: "https://en.wikipedia.org/wiki/Multi-agent_system",
        snippet: "Several agents share an environment.",
        locator: "wikipedia:42",
      },
    ]);
  });
});
