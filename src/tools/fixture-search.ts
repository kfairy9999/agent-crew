import type { SearchHit, SearchTool } from "../core/types";
import { FIXTURE_CORPUS, fixtureHit } from "./corpus";

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Deterministic overlap search over the local corpus. No network, no key. */
export class FixtureSearch implements SearchTool {
  readonly name = "fixture-corpus";

  search(query: string, limit: number): Promise<SearchHit[]> {
    const needles = new Set(tokens(query));
    const lowered = query.toLowerCase();
    const ranked = FIXTURE_CORPUS.map((doc) => {
      const hay = tokens(`${doc.title} ${doc.keywords.join(" ")} ${doc.text}`);
      let score = 0;
      for (const token of hay) {
        if (needles.has(token)) score += 1;
      }
      for (const keyword of doc.keywords) {
        if (lowered.includes(keyword.toLowerCase())) score += 4;
      }
      return { doc, score };
    })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
      .slice(0, Math.max(1, limit));
    return Promise.resolve(ranked.map((row) => fixtureHit(row.doc)));
  }
}
