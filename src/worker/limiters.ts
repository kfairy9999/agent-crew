import { TokenBucketLimiter } from "../core/rate-limit";
import type { Settings } from "./bindings";

let cached: {
  signature: string;
  ip: TokenBucketLimiter;
  global: TokenBucketLimiter;
} | undefined;

/**
 * Isolate-local guard for live runs. A public demo should still set a strict
 * budget; this map does not survive another isolate and is not a global account limit.
 */
export function limitersFor(
  settings: Settings,
  now?: () => number,
): { ip: TokenBucketLimiter; global: TokenBucketLimiter } {
  const signature = `${settings.liveCapacity}:${settings.liveWindowMs}:${settings.globalCapacity}`;
  if (!cached || cached.signature !== signature) {
    cached = {
      signature,
      ip: new TokenBucketLimiter({
        capacity: settings.liveCapacity,
        windowMs: settings.liveWindowMs,
        now,
      }),
      global: new TokenBucketLimiter({
        capacity: settings.globalCapacity,
        windowMs: settings.liveWindowMs,
        now,
      }),
    };
  }
  return { ip: cached.ip, global: cached.global };
}

export function resetLimiters(): void {
  cached = undefined;
}
