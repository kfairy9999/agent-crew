/** Strip connection strings and embedded passwords before anything is logged or returned. */
export function redactText(text: string, secret = ""): string {
  let out = secret ? text.split(secret).join("[redacted]") : text;
  out = out.replace(/mongodb(?:\+srv)?:\/\/[^\s'"]+/gi, "mongodb://[redacted]");
  const password = passwordFromMongoUri(secret);
  if (password && password.length >= 8) out = out.split(password).join("[redacted]");
  if (out.length > 300) out = `${out.slice(0, 300)}…`;
  return out;
}

export function redactError(error: unknown, secret = ""): Error {
  const message = redactText(error instanceof Error ? error.message : String(error), secret);
  const next = new Error(message);
  next.name = "ArchiveError";
  return next;
}

function passwordFromMongoUri(uri: string): string | null {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^:@/?]+):([^@/?]+)@/i.exec(uri);
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
