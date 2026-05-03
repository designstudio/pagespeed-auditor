# Codex PageSpeed Auditor Skill

A Codex skill for auditing website performance with Google PageSpeed Insights and turning the results into concrete code changes.

Give Codex one or more public URLs, a frontend repository, or a baseline run and it can inspect how the app works, run mobile and desktop PSI audits, generate structured Markdown reports, compare before vs after results, and map the highest-impact findings back to specific files and implementation decisions.

## What It Does

- Audits one or more public URLs with PageSpeed Insights
- Runs mobile and desktop strategies by default
- Generates structured Markdown reports for each route plus a consolidated index
- Supports optional score budgets such as `performance=90`
- Supports before vs after comparisons with score deltas
- Falls back to a structured repo-based audit when PSI is blocked by quota or missing public access
- Helps map PSI findings back to concrete code changes in the repository

## Audit Modes

The skill is most useful when you think of it as a few clear modes:

- `baseline`: run a first PSI audit and generate reports
- `multi-route`: audit several important routes in the same run
- `compare`: rerun after fixes and compare against an earlier baseline
- `budget-check`: verify category thresholds such as performance or accessibility
- `blocked-run`: when PSI fails because of quota, missing key, or missing public URL, generate a structured fallback report from the codebase instead of pretending the audit succeeded

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

Restart Codex so it can discover the skill.

## Usage

After installation, restart Codex and call the skill by name in your prompt.

Basic audit:

```txt
Use $pagespeed-insights-auditor to audit https://example.com
```

Audit multiple important routes:

```txt
Use $pagespeed-insights-auditor to audit these routes:
- https://example.com
- https://example.com/pricing
- https://example.com/blog/post-1
```

Audit a repository and map findings back to code:

```txt
Use $pagespeed-insights-auditor to audit this project.
Target URLs:
- https://example.com
- https://example.com/dashboard

Run mobile and desktop, save the reports, then inspect the codebase and suggest concrete fixes.
```

Re-audit after fixes:

```txt
Use $pagespeed-insights-auditor to re-run the audit for these routes and compare with the previous baseline.
```

Handle a blocked PSI run cleanly:

```txt
Use $pagespeed-insights-auditor to audit this project.
If PSI is blocked by quota or missing API key, create a blocked-run report and continue with repo-based performance findings.
```

## Running the Script Directly

You can also run the bundled script without invoking the skill through chat.

Baseline run:

```powershell
python 'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --url 'https://example.com/pricing' `
  --out-dir 'reports/pagespeed/baseline' `
  --strategy both `
  --budget performance=90 `
  --budget accessibility=95
```

Compare with a previous run:

```powershell
python 'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --out-dir 'reports/pagespeed/after-fixes' `
  --compare-dir 'reports/pagespeed/baseline' `
  --strategy both `
  --budget performance=90
```

## Output Structure

A typical run creates:

```txt
reports/
  pagespeed/
    baseline/
      index.md
      example.com/
        mobile.json
        desktop.json
        summary.md
      example.com-pricing/
        mobile.json
        desktop.json
        summary.md
```

Each route report should follow a predictable structure:

- `Run Status`
- `Route Summary`
- `Top Issues`
- `Repo-Backed Hypotheses`
- `Recommended Fixes`
- `Next Pass`
- `Raw Artifacts`

When a comparison baseline exists, include score deltas. When PSI is blocked, make that explicit and switch the report into fallback mode instead of presenting hypotheses as confirmed PSI findings.

## Recommended Workflow

1. Identify the public URLs or critical routes to audit.
2. Run `$pagespeed-insights-auditor` in `baseline` or `multi-route` mode.
3. Review `index.md` and the per-route `summary.md` files.
4. Prioritize the worst mobile bottlenecks first.
5. Inspect the codebase and implement the highest-impact fixes.
6. Run the audit again in `compare` mode with `--compare-dir`.
7. Verify score deltas before closing the work.

## Notes

PageSpeed Insights requires a public URL. It does not audit plain `localhost` directly.

If the app only runs locally, use one of these:

- a production URL
- a staging URL
- a preview deployment
- a public tunnel URL

The skill can still run the project locally to understand the codebase and validate fixes, but PSI itself must target a public address.

If `PSI_API_KEY` is not configured, the script still works but uses anonymous quota, which may be rate-limited.

## Troubleshooting

If Codex does not recognize `$pagespeed-insights-auditor`, restart Codex after installing the skill.

Check that the skill exists here:

```powershell
Get-ChildItem '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
```

You should see at least:

```txt
SKILL.md
agents/
references/
scripts/
```

## Repository Contents

- `skills/pagespeed-insights-auditor/SKILL.md`
- `skills/pagespeed-insights-auditor/agents/openai.yaml`
- `skills/pagespeed-insights-auditor/references/report-format.md`
- `skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py`

## License

MIT
