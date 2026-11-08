import { describe, expect, it } from "vitest";
import { checkCitations } from "./citations";

describe("checkCitations", () => {
  const sources = [{ id: 1 }];

  it("rejects unknown markers and missing citations", () => {
    expect(
      checkCitations(
        { summary: "Concurrent writes are safe [4].", sections: [{ heading: "Claim", paragraphs: ["No handoff needed."] }] },
        sources,
      ),
    ).toContain("Citation [4] does not match a retrieved source.");
    expect(
      checkCitations({ summary: "No marker here.", sections: [{ heading: "Claim", paragraphs: ["Still none."] }] }, sources),
    ).toContain("The draft makes no citations, but sources were retrieved.");
  });

  it("accepts a draft whose markers are on the board", () => {
    expect(
      checkCitations(
        { summary: "One reducer applies the write [1].", sections: [{ heading: "Claim", paragraphs: ["The next role reads it [1]."] }] },
        sources,
      ),
    ).toEqual([]);
  });
});
