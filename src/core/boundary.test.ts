import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("orchestration boundary", () => {
  it("keeps the core free of React, Hono, Worker, and persistence imports", () => {
    for (const file of walk("src/core")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["'](react|react-dom|hono|cloudflare:workers|mongodb|dexie|idb)["']/);
      expect(text, file).not.toMatch(/indexedDB|MONGODB_URI/);
    }
  });

  it("keeps the document model free of IndexedDB, Mongo, and the desk", () => {
    for (const file of walk("src/persist")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/indexedDB|from ["']mongodb["']|from ["']hono["']|from ["']react["']/);
    }
  });

  it("keeps secrets and the Mongo driver out of the desk", () => {
    for (const file of walk("src/client")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/MONGODB_URI|GROQ_API_KEY|mongodb(?:\+srv)?:\/\//);
      expect(text, file).not.toMatch(/from ["']mongodb["']/);
      expect(text, file).not.toMatch(/from ["'][^"']*\/worker\//);
    }
  });

  it("loads the MongoDB driver from the archive module only", () => {
    const hits = walk("src").filter((file) => /from ["']mongodb["']/.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([join("src", "worker", "mongo-driver.ts")]);
    const loader = readFileSync(join("src", "worker", "mongo.ts"), "utf8");
    expect(loader).toContain('import("./mongo-driver")');
    expect(loader).not.toMatch(/console\.(log|info|debug)/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    if (path.endsWith(".ts") || path.endsWith(".tsx")) return [path];
    return [];
  });
}
