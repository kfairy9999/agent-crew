import { Button } from "@/components/ui/button";
import { runKindLabel, runListDetail, type RunSummary } from "../../persist/document";

export function SavedRuns({
  runs,
  activeId,
  disabled,
  ready,
  remote,
  storageError,
  remoteError,
  saveError,
  onOpen,
}: {
  runs: RunSummary[];
  activeId: string;
  disabled: boolean;
  ready: boolean;
  remote: boolean;
  storageError: string | null;
  remoteError: string | null;
  saveError: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section data-testid="saved-runs" aria-labelledby="saved-runs-heading" className="mt-4 border-t border-line pt-4">
      <h2 id="saved-runs-heading" className="text-[11px] uppercase tracking-[0.16em] text-muted">
        Saved runs
      </h2>
      <p data-testid="archive-note" className="mt-1 text-xs leading-relaxed text-muted">
        {remote
          ? "Kept in this browser and in the MongoDB archive for this owner key."
          : "Kept in this browser. A refresh reopens the trace."}
      </p>
      {storageError ? (
        <p role="alert" data-testid="storage-error" className="mt-2 text-xs leading-relaxed text-critic">
          {storageError}
        </p>
      ) : null}
      {remoteError ? (
        <p role="alert" data-testid="remote-error" className="mt-2 text-xs leading-relaxed text-planner">
          {remoteError}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-critic">
          {saveError}
        </p>
      ) : null}
      <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
        {!ready ? <p className="text-xs text-muted">Reading saved runs…</p> : null}
        {ready && runs.length === 0 && !storageError ? (
          <p data-testid="saved-empty" className="text-sm leading-relaxed text-muted">
            No saved runs yet. Finish a crew and it stays here after a refresh.
          </p>
        ) : null}
        {runs.map((run) => {
          const kind = runKindLabel(run);
          const active = run.id === activeId && activeId !== "";
          return (
            <Button
              key={run.id}
              type="button"
              variant="secondary"
              data-testid="saved-run"
              data-run-kind={kind}
              disabled={disabled}
              aria-pressed={active}
              className={`h-auto min-h-11 w-full items-start justify-start whitespace-normal px-3 py-2 text-left ${active ? "border-planner" : ""}`}
              onClick={() => onOpen(run.id)}
            >
              <span className="block min-w-0">
                <span className="line-clamp-2 block text-sm">{run.topic}</span>
                <span className={`mt-1 block text-xs font-normal ${kind === "Demo" ? "text-planner" : "text-critic"}`}>
                  {runListDetail(run)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
