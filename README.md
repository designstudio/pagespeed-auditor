# Codex PageSpeed Auditor Skill

A Codex skill for running Lighthouse-style performance audits inside a repository and, when useful, validating the same routes with Google PageSpeed Insights.

Give Codex a localhost app, a repository frontend, one or more public URLs, or a previous baseline and it can inspect how the app runs, execute local Lighthouse audits in mobile and desktop, generate structured Markdown reports, compare before vs after results, and map the highest-impact findings back to specific files and implementation decisions.

## What It Does

- Runs local Lighthouse audits against localhost or any reachable URL
- Runs mobile and desktop strategies by default
- Generates structured Markdown reports for each route plus a consolidated index
- Supports optional score budgets such as `performance=90`
- Supports before vs after comparisons with score deltas
- Keeps a separate optional PSI runner for public URL validation and CrUX-aware follow-up
- Helps map Lighthouse and PSI findings back to concrete code changes in the repository

## Audit Engines

The skill now has two engines.

### 1. `local-lighthouse` (primary)

Use this first when you want a real audit from inside the repository without depending on Google quota.

Best for:

- `localhost`
- preview servers started from the repo
- repeatable before vs after checks
- route-level work during active development

### 2. `psi-remote` (optional)

Use this after the local audit when you want Google PageSpeed Insights results for a public URL.

Best for:

- validating against a production or preview deployment
- checking the Google PSI view of the route
- using CrUX/field-data-aware follow-up when available

## Audit Modes

- `baseline`: run the first local Lighthouse audit and save reports
- `multi-route`: audit several important routes in the same run
- `compare`: rerun after fixes and compare against an earlier baseline
- `budget-check`: verify category thresholds such as performance or accessibility
- `psi-followup`: run the optional PSI script against the public versions of the same routes
- `blocked-run`: when PSI fails because of quota, missing key, or missing public URL, generate a structured fallback report instead of pretending the audit succeeded

## Installation

Clone the repository:

```powershell
git clone https://github.com/designstudio/codex-pagespeed-auditor-skill.git
```

Copy the skill into your Codex skills directory:

```powershell
New-Item -ItemType Directory -Force '$env:USERPROFILE/.codex/skills' | Out-Null
Copy-Item -Recurse -Force `
  'codex-pagespeed-auditor-skill/skills/pagespeed-insights-auditor' `
  '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
```

Install the bundled Lighthouse dependency inside the skill folder:

```powershell
Set-Location '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
cmd /c npm install
```

Restart Codex so it can discover the skill.

## Usage

After installation, restart Codex and call the skill by name in your prompt.

Run a local audit for a repo app:

```txt
Use $pagespeed-insights-auditor to run a local Lighthouse audit for this project.
Start the app if needed, audit the main routes in mobile and desktop, generate reports, then map the biggest findings back to code.
```

Audit localhost directly:

```txt
Use $pagespeed-insights-auditor to audit http://localhost:3000 with local Lighthouse.
```

Audit multiple important routes:

```txt
Use $pagespeed-insights-auditor to audit these routes with local Lighthouse:
- http://localhost:3000
- http://localhost:3000/pricing
- http://localhost:3000/blog/post-1
```

Re-audit after fixes:

```txt
Use $pagespeed-insights-auditor to rerun the local audit and compare it with the previous baseline.
```

Optional PSI follow-up on public URLs:

```txt
Use $pagespeed-insights-auditor to run the local Lighthouse audit first, then run a PSI follow-up for these public URLs if possible.
```

## Running the Scripts Directly

### Local Lighthouse runner

```powershell
node 'skills/pagespeed-insights-auditor/scripts/run_local_lighthouse.mjs' `
  --url 'http://localhost:4173' `
  --url 'http://localhost:4173/artigos/rosas-de-ouro-carnaval-2026' `
  --out-dir 'reports/pagespeed/local-baseline' `
  --strategy both `
  --budget performance=90
```

### Compare with a previous local run

```powershell
node 'skills/pagespeed-insights-auditor/scripts/run_local_lighthouse.mjs' `
  --url 'http://localhost:4173' `
  --out-dir 'reports/pagespeed/local-after-fixes' `
  --compare-dir 'reports/pagespeed/local-baseline' `
  --strategy both `
  --budget performance=90
```

### Optional PSI follow-up

```powershell
python 'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --out-dir 'reports/pagespeed/psi-followup' `
  --strategy both
```

## Output Structure

A typical local run creates:

```txt
reports/
  pagespeed/
    local-baseline/
      index.md
      localhost-4173/
        mobile.lighthouse.json
        mobile.lighthouse.html
        desktop.lighthouse.json
        desktop.lighthouse.html
        summary.md
```

Each route report is intended to feel like a compact PageSpeed/Lighthouse readout inside the repo, with:

- `Run Status`
- `Route Summary`
- `Metrics`
- `Top Issues`
- `Code Mapping Leads`
- `Strategy Details`
- `Raw Artifacts`
- `Next Pass`

## Recommended Workflow

1. Start or identify the local web surface you want to audit.
2. Run `$pagespeed-insights-auditor` with the local Lighthouse engine first.
3. Review `index.md` and the per-route `summary.md` files.
4. Prioritize the worst mobile bottlenecks first.
5. Inspect the codebase and implement the highest-impact fixes.
6. Rerun in `compare` mode.
7. Optionally run the PSI follow-up on the public version of the same routes.

## Notes

Use local Lighthouse as the default engine when you want PageSpeed-style audits from inside the repository.

Use PSI only when you explicitly want the Google-hosted external perspective for a public URL.

If `PSI_API_KEY` is not configured, the PSI script still works but uses anonymous quota, which may be rate-limited.

## Troubleshooting

If Codex does not recognize `$pagespeed-insights-auditor`, restart Codex after installing the skill.

If local Lighthouse says the dependency is missing, install it from the skill directory:

```powershell
Set-Location '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
cmd /c npm install
```

Check that the skill exists here:

```powershell
Get-ChildItem '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
```

You should see at least:

```txt
SKILL.md
package.json
agents/
references/
scripts/
```

## Repository Contents

- `skills/pagespeed-insights-auditor/SKILL.md`
- `skills/pagespeed-insights-auditor/package.json`
- `skills/pagespeed-insights-auditor/agents/openai.yaml`
- `skills/pagespeed-insights-auditor/references/report-format.md`
- `skills/pagespeed-insights-auditor/scripts/run_local_lighthouse.mjs`
- `skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py`

## License

MIT
