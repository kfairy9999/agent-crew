import type { Report } from "../../core";

export function ReportView({
  report,
  mode,
  model,
  evidence,
}: {
  report: Report | null;
  mode: string;
  model: string;
  evidence: string;
}) {
  if (!report) {
    return (
      <section
        data-testid="report"
        className="mt-4 rounded-sm border border-dashed border-line bg-ink-2/40 px-5 py-8 text-paper"
      >
        <p className="text-[11px] uppercase tracking-[0.18em] text-planner">Crew brief</p>
        <h2 className="mt-2 font-serif text-2xl text-paper">The page stays blank until the critic signs off.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          You will see the plan, the searches, the draft notes, and any revision before a sentence is treated as
          final. Sources stay attached to the brief, not invented underneath it.
        </p>
      </section>
    );
  }

  return (
    <article data-testid="report" className="mt-4 rounded-sm bg-paper px-5 py-6 text-ink shadow-[0_20px_60px_rgba(0,0,0,0.28)] sm:px-8">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a5a22]">Crew brief</p>
      <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">{report.title}</h2>
      <p className="mt-4 max-w-3xl font-serif text-lg leading-relaxed">
        <Cited text={report.summary} />
      </p>
      <div className="mt-6 space-y-5">
        {report.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-[#3d4a44]">
              {section.heading}
            </h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 max-w-3xl font-serif text-[17px] leading-relaxed">
                <Cited text={paragraph} />
              </p>
            ))}
          </section>
        ))}
      </div>
      {report.reservations.length > 0 ? (
        <aside className="mt-6 border-l-4 border-[#8a5a22] bg-[#efe4d2] px-3 py-2 text-sm">
          <p className="font-sans text-[11px] uppercase tracking-[0.14em]">Reservations</p>
          <ul className="mt-1 list-disc pl-4">
            {report.reservations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <section className="mt-8 border-t border-[#d9cbb6] pt-4">
        <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-[#3d4a44]">Sources</h3>
        <ol data-testid="sources" className="mt-3 space-y-4">
          {report.sources.map((source) => (
            <li id={`source-${source.id}`} key={source.id} className="text-sm">
              <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-[#0f5e58] underline">
                [{source.id}] {source.title}
              </a>
              <p className="mt-1 text-[#3d4a44]">{source.snippet}</p>
            </li>
          ))}
        </ol>
        {report.sources.length === 0 ? (
          <p className="mt-2 text-sm text-[#3d4a44]">No source was retrieved for this assignment.</p>
        ) : null}
      </section>
      <footer className="mt-6 font-sans text-[11px] uppercase tracking-[0.14em] text-[#6d7b74]">
        {mode || "demo"} · {model || "demo-scripted"} · {evidence || "fixture-corpus"}
      </footer>
    </article>
  );
}

function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const id = match?.[1];
        if (!id) return <span key={`${part}-${index}`}>{part}</span>;
        return (
          <a
            key={`${id}-${index}`}
            href={`#source-${id}`}
            className="mx-0.5 font-sans text-[0.78em] font-semibold text-[#0f5e58] no-underline hover:underline"
          >
            [{id}]
          </a>
        );
      })}
    </>
  );
}
