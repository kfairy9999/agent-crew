const DURATION =
  /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/;

/**
 * Groq reset headers look like "250ms", "2s", "7.66s", or "6m0s".
 * A bare number is treated as seconds, matching Retry-After.
 */
export function parseDurationMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  const match = DURATION.exec(trimmed);
  if (!match) return undefined;
  const [, hours, minutes, seconds, milliseconds] = match;
  if (!hours && !minutes && !seconds && !milliseconds) return undefined;
  const total =
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000 +
    Number(milliseconds ?? 0);
  if (!Number.isFinite(total)) return undefined;
  return Math.ceil(total);
}

export function retryAfterMs(headers: Headers, body: string, now = Date.now()): number | undefined {
  const candidates: number[] = [];
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    if (/^\d+(?:\.\d+)?$/.test(retryAfter.trim())) {
      candidates.push(Math.ceil(Number(retryAfter.trim()) * 1000));
    } else {
      const dated = Date.parse(retryAfter);
      if (!Number.isNaN(dated)) candidates.push(Math.max(0, dated - now));
      else {
        const parsed = parseDurationMs(retryAfter);
        if (parsed !== undefined) candidates.push(parsed);
      }
    }
  }
  for (const name of ["x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    const parsed = parseDurationMs(raw);
    if (parsed !== undefined) candidates.push(parsed);
  }
  const fromBody = /try again in\s+([0-9.]+)\s*(ms|s|m)?/i.exec(body);
  if (fromBody?.[1]) {
    const amount = Number(fromBody[1]);
    const unit = (fromBody[2] ?? "s").toLowerCase();
    if (Number.isFinite(amount)) {
      const ms = unit === "ms" ? amount : unit === "m" ? amount * 60_000 : amount * 1000;
      candidates.push(Math.ceil(ms));
    }
  }
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
}
