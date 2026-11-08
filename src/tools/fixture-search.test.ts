import { describe, expect, it } from "vitest";
import { FixtureSearch } from "./fixture-search";

describe("FixtureSearch", () => {
  it("ranks the blackboard note first for a reducer query", async () => {
    const hits = await new FixtureSearch().search("shared blackboard serialized reducer handoff snapshot", 3);
    expect(hits[0]?.locator).toBe("fixture:blackboard");
    expect(hits[0]?.url).toBe("/api/fixtures/blackboard");
  });

  it("returns nothing for a topic the corpus does not contain", async () => {
    const hits = await new FixtureSearch().search("quantum knitting satellites", 3);
    expect(hits).toEqual([]);
  });
});
