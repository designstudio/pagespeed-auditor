# pagespeed-auditor

Codex skill for auditing web projects with Google PageSpeed Insights.

## Includes

- Codex skill instructions in `skills/pagespeed-insights-auditor/SKILL.md`
- PSI runner script in `skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py`
- Reporting guidance in `skills/pagespeed-insights-auditor/references/report-format.md`

## What it does

- inspects a codebase to understand how a web app runs,
- audits one or more public URLs with PageSpeed Insights,
- generates per-route Markdown reports and a consolidated index,
- supports optional budgets and before/after comparisons,
- helps map PSI findings back to concrete code changes.

## Example

```powershell
& 'C:/Users/henri/AppData/Local/Programs/Python/Python312/python.exe' `
  'skills/pagespeed-insights-auditor/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --url 'https://example.com/pricing' `
  --out-dir 'reports/pagespeed/baseline' `
  --strategy both `
  --budget performance=90
```
