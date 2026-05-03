---
name: pagespeed-insights-auditor
description: Inspect a web application codebase, determine how to run or identify its deployed URL, execute Google PageSpeed Insights for mobile and desktop on one or more public URLs, save raw JSON outputs, generate Markdown performance reports, compare runs, check optional score budgets, and map findings back to concrete code changes. Use when Codex needs to audit a repo for web performance regressions, compare mobile and desktop PSI scores, investigate Core Web Vitals issues, or propose implementation changes directly in the code after a PageSpeed run.
---

# PageSpeed Insights Auditor

## Overview

Use this skill for end-to-end performance review inside a web app repository. Start from the codebase, figure out how the app runs, determine the best public URL or URLs to audit, run PageSpeed Insights for mobile and desktop, write Markdown reports, and then inspect the relevant code paths to propose or implement targeted improvements.

PageSpeed Insights requires a publicly reachable URL. The skill may run the project locally to understand the framework, startup command, routes, asset pipeline, and likely bottlenecks, but PSI itself must target a public production, staging, preview, or tunneled URL. Do not pretend PSI ran against plain `localhost`.

The PSI API key is optional. If `PSI_API_KEY` or the variable passed via `--api-key-env` is missing, continue with anonymous quota but warn that the run may be rate-limited.

## Workflow

### 1. Inspect the codebase first

Before running any audit, understand how the project is structured.

Inspect files such as:

- `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- `README*`
- framework config like `next.config.*`, `vite.config.*`, `astro.config.*`, `nuxt.config.*`
- deployment config like `vercel.json`, Netlify config, Docker files, CI workflows
- `.env*` files for public app URLs

From that inspection, identify:

- framework and package manager,
- likely dev and build commands,
- probable production or preview hostnames,
- critical routes worth auditing, not just the homepage,
- major rendering model risks such as oversized bundles, image strategy, blocking fonts, client-heavy routes, or third-party scripts.

### 2. Resolve the audit URL set

Prefer this order:

1. User-provided public URLs.
2. Public production URLs discovered in the repo.
3. Public staging or preview URLs discovered in the repo.
4. A temporary public URL provided by the user.

Audit multiple URLs when the app has multiple high-value surfaces such as homepage, marketing page, dashboard, catalog, product page, blog post, or checkout route.

If the repo only runs locally and no public URL exists, say that PSI cannot audit `localhost`. In that case:

- ask for a public URL, or
- if the environment already has an approved way to expose the app publicly, use that, or
- explain that Lighthouse local analysis is the fallback but is not the same as PSI.

### 3. Start the app locally when useful

Start the local app when doing so helps understand the codebase or validate likely fixes, even if PSI will hit a public URL.

Use the repo's actual package manager and scripts. Prefer reading the existing commands instead of inventing them.

Local startup helps with:

- verifying the app boots,
- confirming route structure,
- spotting hydration or console issues,
- validating fixes before and after code changes.

If a dev server is started, record the command and port in your notes or report.

### 4. Run the PageSpeed audit

Use the bundled script:

```powershell
& 'C:/Users/henri/AppData/Local/Programs/Python/Python312/python.exe' `
  '<skill-dir>/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --url 'https://example.com/pricing' `
  --out-dir '<repo>/reports/pagespeed/2026-05-03-baseline' `
  --strategy both `
  --budget performance=90 `
  --budget accessibility=95
```

Supported flags:

- `--url`: Public URL to audit. Repeat for multiple URLs.
- `--urls-file`: Text file with one public URL per line.
- `--out-dir`: Output folder for route subdirectories plus a consolidated index.
- `--strategy`: `mobile`, `desktop`, or `both`.
- `--categories`: Comma-separated list. Default is `performance,accessibility,best-practices,seo`.
- `--api-key-env`: Environment variable containing a PSI API key. Default is `PSI_API_KEY`.
- `--locale`: Locale forwarded to PSI. Default is `en-US`.
- `--budget`: Optional category budget such as `performance=90`. Repeat as needed.
- `--compare-dir`: Previous output directory for before/after comparison.
- `--report-file`: Per-route Markdown report filename. Default is `summary.md`.
- `--index-file`: Consolidated Markdown report filename. Default is `index.md`.

Use `--compare-dir` after changes to measure deltas against a previous run.

If the key is missing, keep going but surface the warning in terminal output and in the generated reports.

### 5. Read the results and trace them back to code

The script now generates:

- a consolidated `index.md` across all audited URLs,
- one route folder per URL,
- one per-route Markdown report with scores, metrics, opportunities, diagnostics, and comparison data,
- raw JSON for each strategy.

Use the reports first, then inspect the codebase to connect findings to likely causes. Examples:

- `unused-javascript`: large client bundles, unnecessary client components, third-party SDKs, broad imports.
- `render-blocking-resources`: blocking CSS, fonts, synchronous scripts, stylesheet loading order.
- image-related audits: missing responsive images, poor formats, oversized assets, no lazy loading.
- cache and network audits: static asset headers, CDN settings, framework asset config.
- LCP regressions: hero image strategy, server render delays, font loading, blocking scripts.

Do not stop at generic advice. Point to concrete files, components, routes, or configuration when evidence supports it.

For interpretation guidance and response structure, read [references/report-format.md](references/report-format.md).

### 6. Suggest or implement code changes

After correlating the PSI findings with the repo, propose the smallest high-impact changes first.

Good outputs include:

- a Markdown report in `reports/pagespeed/...`,
- a short human summary for the user,
- a concrete change plan tied to files,
- optional direct code edits when the user wants fixes applied.

When suggesting code changes:

- distinguish certain findings from likely hypotheses,
- prioritize mobile issues first when they dominate user impact,
- prefer changes that improve LCP, INP, CLS, and transfer size before cosmetic micro-optimizations,
- mention tradeoffs when a fix may affect UX, analytics, or rendering behavior.

### 7. Verify after changes

If code changes are applied, rerun the relevant local checks and, when possible, rerun PSI against the same public URLs with `--compare-dir` pointing to the previous run so the report shows before and after deltas.

## Output conventions

Prefer this repo-local layout:

```text
reports/
  pagespeed/
    <run-name>/
      index.md
      <target-slug>/
        mobile.json
        desktop.json
        summary.md
```

Use dated run folders or semantic names like `baseline`, `after-image-fixes`, or `pre-release-homepage` instead of overwriting previous runs silently.

## Resources

### scripts/run_pagespeed_insights.py

Call the PSI API, persist raw JSON, generate per-route reports, and generate a consolidated index.

### references/report-format.md

Use when you need a quick reminder of what the generated reports include and how to interpret the main sections, comparisons, budgets, and code-mapping workflow.
