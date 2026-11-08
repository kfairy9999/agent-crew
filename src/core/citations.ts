import type { ReportDraft, Source } from "./types";

const CITE = /\[(\d+)\]/g;

export function citationIds(text: string): number[] {
  const ids = new Set<number>();
  for (const match of text.matchAll(CITE)) {
    const raw = match[1];
    if (!raw) continue;
    const id = Number(raw);
    if (Number.isInteger(id)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export function draftText(draft: Pick<ReportDraft, "summary" | "sections">): string {
  return [draft.summary, ...draft.sections.flatMap((section) => section.paragraphs)].join("\n");
}

/** Non-model check. Unknown markers fail even if the critic approves. */
export function checkCitations(
  draft: Pick<ReportDraft, "summary" | "sections">,
  sources: Pick<Source, "id">[],
): string[] {
  const issues: string[] = [];
  if (!draft.summary.trim()) issues.push("The summary is empty.");
  const known = new Set(sources.map((source) => source.id));
  const ids = citationIds(draftText(draft));
  for (const id of ids) {
    if (!known.has(id)) {
      issues.push(`Citation [${id}] does not match a retrieved source.`);
    }
  }
  if (sources.length > 0 && ids.length === 0) {
    issues.push("The draft makes no citations, but sources were retrieved.");
  }
  return issues;
}
