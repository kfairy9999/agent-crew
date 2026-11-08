import type { FixtureDoc } from "../tools/corpus";

export function renderFixturePage(doc: FixtureDoc): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.title)} · Agent Crew fixture</title>
  <style>
    body { margin: 0; background: #101411; color: #f3eee4; font: 18px/1.5 Georgia, serif; }
    main { max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
    p.kicker { font: 12px/1 ui-sans-serif, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #e6b15c; }
    a { color: #6ec8c0; }
    p.body { font-size: 1.15rem; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Fixture corpus · ${escapeHtml(doc.id)}</p>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="body">${escapeHtml(doc.text)}</p>
    <p><a href="/">Back to the desk</a></p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
