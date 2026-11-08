import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("orchestration boundary", () => {
  it("keeps the core free of React, Hono, and Worker imports", () => {
    for (const file of walk("src/core")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["'](react|react-dom|hono|cloudflare:workers)/);
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}
