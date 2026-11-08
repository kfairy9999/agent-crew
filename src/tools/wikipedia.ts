import type { SearchHit, SearchTool } from "../core/types";
import { USER_AGENT } from "../llm/constants";

interface SearchResponse {
  query?: { search?: { title?: string; pageid?: number; snippet?: string }[] };
}

interface ExtractResponse {
  query?: {
    pages?: Record<
      string,
      { title?: string; extract?: string; fullurl?: string; pageid?: number }
    >;
  };
}

/** Free, no-key evidence for live mode. Wikimedia requires a descriptive user agent. */
export class WikipediaSearch implements SearchTool {
  readonly name = "wikipedia";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]> {
    const capped = Math.min(Math.max(limit, 1), 5);
    const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", query);
    searchUrl.searchParams.set("srlimit", String(capped));
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("utf8", "1");
    const found = (await this.getJson(searchUrl, signal)) as SearchResponse;
    const hits = (found.query?.search ?? []).filter((row) => typeof row.pageid === "number");
    if (hits.length === 0) return [];
    const extractUrl = new URL("https://en.wikipedia.org/w/api.php");
    extractUrl.searchParams.set("action", "query");
    extractUrl.searchParams.set("prop", "extracts|info");
    extractUrl.searchParams.set("inprop", "url");
    extractUrl.searchParams.set("exintro", "1");
    extractUrl.searchParams.set("explaintext", "1");
    extractUrl.searchParams.set("pageids", hits.map((row) => String(row.pageid)).join("|"));
    extractUrl.searchParams.set("format", "json");
    extractUrl.searchParams.set("utf8", "1");
    const extracted = (await this.getJson(extractUrl, signal)) as ExtractResponse;
    const pages = extracted.query?.pages ?? {};
    return hits.flatMap((row) => {
      const pageid = row.pageid;
      if (pageid === undefined) return [];
      const page = pages[String(pageid)];
      const extract = page?.extract?.replace(/\s+/g, " ").trim();
      const snippet = (extract || stripHtml(row.snippet ?? "")).slice(0, 700);
      if (!snippet) return [];
      return [
        {
          title: page?.title || row.title || "Wikipedia",
          url: page?.fullurl || `https://en.wikipedia.org/?curid=${pageid}`,
          snippet,
          locator: `wikipedia:${pageid}`,
        },
      ];
    });
  }

  private async getJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(8_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetchImpl(url, {
      signal: combined,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        "Api-User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`Wikipedia search failed with ${response.status}.`);
    }
    return response.json() as Promise<unknown>;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
