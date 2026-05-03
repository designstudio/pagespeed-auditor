# Codex PageSpeed Auditor Skill

A Codex skill for auditing website performance with Google PageSpeed Insights.

Give Codex a public URL, a set of critical routes, or a frontend repository and it can inspect the codebase, determine how the app runs, execute PageSpeed Insights in mobile and desktop, generate Markdown reports, compare before vs after runs, and suggest concrete code changes tied to the repo.

## What It Does

- Audits one or more public URLs with PageSpeed Insights
- Runs mobile and desktop strategies by default
- Generates per-route Markdown reports plus a consolidated index
- Supports optional score budgets
- Supports before vs after comparisons with score deltas
- Helps map PSI findings back to concrete code changes in the repository
- Warns when running on anonymous PSI quota instead of an API key

## Features

- Multiple routes per run
- Mobile + desktop reporting
- Budget checks
- Before/after comparisons
- Raw JSON artifacts
- Markdown summaries
- Codebase-oriented fix guidance

## Installation

Install the skill manually into your Codex skills directory.

Clone the repository:

```powershell
git clone https://github.com/designstudio/pagespeed-auditor.git
```

Copy the skill into your Codex skills directory:

```powershell
New-Item -ItemType Directory -Force '$env:USERPROFILE/.codex/skills' | Out-Null
Copy-Item -Recurse -Force `
  'pagespeed-auditor/skills/pagespeed-insights-auditor' `
  '$env:USERPROFILE/.codex/skills/pagespeed-insights-auditor'
```

Restart Codex so it can discover the skill.

## Usage

After installation, restart Codex and call the skill by name in your prompt.

Basic audit:

```txt
Use $pagespeed-insights-auditor to audit https://example.com
```

Audit multiple routes:

```txt
Use $pagespeed-insights-auditor to audit these routes:
- https://example.com
- https://example.com/pricing
- https://example.com/blog/post-1
```

Audit a repository and then map the findings back to code:

```txt
Use $pagespeed-insights-auditor to audit this project.
Target URLs:
- https://example.com
- https://example.com/dashboard

Run mobile and desktop, save the reports, then inspect the codebase and suggest concrete fixes.
```

Compare before vs after fixes:

```txt
Use $pagespeed-insights-auditor to re-run the audit for these routes and compare with the previous baseline.
```

## Running the Script Directly

You can also run the bundled script without invoking the skill through chat.

```powershell
& 'python' `
  'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --url 'https://example.com/pricing' `
  --out-dir 'reports/pagespeed/baseline' `
  --strategy both `
  --budget performance=90 `
  --budget accessibility=95
```

Compare with a previous run:

```powershell
& 'python' `
  'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --out-dir 'reports/pagespeed/after-fixes' `
  --compare-dir 'reports/pagespeed/baseline' `
  --strategy both `
  --budget performance=90
```

## Options

The script supports:

- `--url` repeated for multiple URLs
- `--urls-file` for batch auditing from a text file
- `--strategy mobile|desktop|both`
- `--categories performance,accessibility,best-practices,seo`
- `--budget category=score`
- `--compare-dir <previous-run>`
- `--api-key-env <ENV_VAR_NAME>`
- `--report-file <filename>`
- `--index-file <filename>`

## Output

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

## Recommended Workflow

1. Identify the public URLs or critical routes to audit.
2. Run `$pagespeed-insights-auditor`.
3. Review `index.md` and the per-route `summary.md` files.
4. Prioritize the worst mobile bottlenecks first.
5. Inspect the codebase and implement the highest-impact fixes.
6. Run the audit again with `--compare-dir`.
7. Verify score deltas before closing the work.

## Notes

PageSpeed Insights requires a public URL. It does not audit plain `localhost` directly.

If the app only runs locally, use one of these:

- a production URL
- a staging URL
- a preview deployment
- a public tunnel URL

The skill can still run the project locally to understand the codebase and validate fixes, but PSI itself must target a public address.

For best results, provide one of:

- one public URL
- several critical public routes
- a repository plus the public URLs you care about
- a baseline run directory when you want before/after comparison

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


