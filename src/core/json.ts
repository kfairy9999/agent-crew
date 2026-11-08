import type { ZodType } from "zod";

export function extractJson(text: string): unknown {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? withoutThink).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model did not return a JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error("Model returned malformed JSON.");
  }
}

export function readModelJson<T>(schema: ZodType<T>, text: string): T {
  const result = schema.safeParse(extractJson(text));
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 4)
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "value";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(detail || "JSON did not match the schema.");
  }
  return result.data;
}
