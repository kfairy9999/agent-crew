import { describe, expect, it } from "vitest";
import { TokenBucketLimiter } from "./rate-limit";

describe("TokenBucketLimiter", () => {
  it("refills continuously and reports the wait", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter({ capacity: 2, windowMs: 10_000, now: () => now });
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").remaining).toBe(0);
    const blocked = limiter.take("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    now = 5_000;
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("other").allowed).toBe(true);
  });
});
