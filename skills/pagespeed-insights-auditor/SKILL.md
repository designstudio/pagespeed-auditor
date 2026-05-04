---
name: pagespeed-insights-auditor
description: Run Lighthouse-style web performance audits from inside the current repository, compare mobile and desktop results, generate structured Markdown reports, and map the highest-impact findings back to concrete code changes. Use when Codex needs a local Lighthouse audit for localhost or a repo-run app, a multi-route baseline, a before-vs-after comparison, a budget check, or an optional PageSpeed Insights follow-up for public URLs.
---

# PageSpeed Insights Auditor

## Overview

Use this skill for end-to-end performance review inside a web app repository. Start from the codebase, understand how the app runs, determine the best local or public URL set to audit, run a local Lighthouse audit first, produce structured Markdown reports, and then inspect the relevant code paths to propose or implement targeted improvements.

This skill is Lighthouse-first. The local audit path is the primary experience when the goal is to run a real PageSpeed-style audit from inside the repository without depending on Google quota.

Use the PSI script only as an optional follow-up when you want Google-hosted validation for a public URL.

## Engines

### `local-lighthouse`

Use this first whenever the app can run locally or a preview URL is available.

Best for:

- `localhost`
- repo-run preview servers
- repeated before-vs-after verification
- capturing real Lighthouse scores, metrics, and audits from inside the project

The local runner should first use a Lighthouse engine that is already available. If it does not find one in the skill folder, it should fall back to `npx lighthouse` automatically.

### `psi-remote`

Use this only when you want the Google PSI view for a public URL.

Best for:

- production or preview validation
- external comparison against the public deployment
- situations where field-data-aware follow-up matters

## Modes

Treat the skill as a small family of audit modes instead of a single one-shot report.

- `baseline`: run the first local Lighthouse audit and save the first structured report.
- `multi-route`: audit several important routes in one pass and compare their relative weaknesses.
- `compare`: rerun after fixes and show score deltas against an earlier baseline.
- `budget-check`: verify category thresholds like `performance=90` or `accessibility=95`.
- `psi-followup`: after the local pass, run PSI against the public versions of the same routes if useful.
- `blocked-run`: when PSI follow-up fails because of quota, missing API key, or missing public URL, generate a structured fallback note without pretending the external PSI run succeeded.

Mention the selected mode in the final output whenever it helps the user understand what kind of audit they are seeing.

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
- how to start the app locally,
- critical routes worth auditing, not just the homepage,
- probable public routes if PSI follow-up is needed,
- major rendering model risks such as oversized bundles, image strategy, blocking fonts, client-heavy routes, or third-party scripts.

### 2. Resolve the target set

Prefer this order for the main audit:

1. A production-like local target generated from the repo itself: built preview server, framework preview server, or static output server.
2. A local URL from a repo-run dev server only when no production-like target is available.
3. A preview URL supplied by the user.
4. A production URL supplied by the user.
5. A public route discovered in the repo.

For the primary local-lighthouse pass, `localhost` is allowed and expected.

For PSI follow-up, use only public URLs.

### 3. Keep the startup strategy tight

Prefer the fewest moving parts that can produce a trustworthy audit.

Default approach:

1. Build the app if the repo has a normal build step.
2. Run a production-like preview or static server.
3. Audit that target locally with Lighthouse.

Only fall back to a dev server when a production-like target is not available.

Do not keep trying many server variants. Choose one main path, and if it fails, try one fallback path at most before reporting the blocker.

If a server is started, record the command and port in your notes or report.

### 4. Run the local Lighthouse audit first

Use the bundled local runner:

```powershell
node '<skill-dir>/scripts/run_local_lighthouse.mjs' `
  --url 'http://localhost:4173' `
  --url 'http://localhost:4173/pricing' `
  --out-dir '<repo>/reports/pagespeed/local-baseline' `
  --strategy both `
  --budget performance=90
```

The local runner accepts:

- `--url`: Reachable URL to audit. Repeat for multiple URLs. `localhost` is supported.
- `--urls-file`: Text file with one URL per line.
- `--out-dir` or `--outDir`: Output folder for route subdirectories plus a consolidated index.
- `--strategy`: `mobile`, `desktop`, or `both`.
- `--categories`: Comma-separated list. Default is `performance,accessibility,best-practices,seo`.
- `--budget`: Optional category budget such as `performance=90`. Repeat as needed.
- `--compare-dir`: Previous local output directory for before-vs-after comparison.
- `--report-file`: Per-route Markdown report filename. Default is `summary.md`.
- `--index-file`: Consolidated Markdown report filename. Default is `index.md`.
- `--locale`: Lighthouse locale. Default is `en-US`.
- `--chrome-flags`: Extra Chrome flags. Default is `--headless=new --disable-dev-shm-usage`.

The local runner should prefer a ready Lighthouse binary first and fall back to `npx lighthouse` automatically. It writes real Lighthouse JSON artifacts per route and strategy, plus Markdown summaries.

If Lighthouse writes JSON artifacts but exits with a Windows cleanup error, treat the run as recovered instead of failed and surface that warning in the report.

### 5. Run PSI only as optional follow-up

If the user wants the external PageSpeed Insights view, or if you want to compare local results with public deployment results, run the PSI script after the local pass:

```powershell
python '<skill-dir>/scripts/run_pagespeed_insights.py' `
  --url 'https://example.com' `
  --out-dir '<repo>/reports/pagespeed/psi-followup' `
  --strategy both
```

Treat PSI as a follow-up, not the primary source of truth for in-repo iteration.

### 6. Handle blocked PSI runs explicitly

When PSI follow-up fails, do not leave the user with an ambiguous half-result.

Treat these cases as `blocked-run` mode:

- `429 RESOURCE_EXHAUSTED`
- anonymous quota exhaustion
- missing public URL
- network failure reaching PSI
- API authentication or permission errors

In blocked-run mode:

- state clearly that local Lighthouse succeeded or failed separately from PSI,
- record the PSI blocking reason,
- keep the local Lighthouse findings as the primary audit evidence,
- continue with repo-based performance investigation,
- give the user rerun instructions.

### 7. Read the results and trace them back to code

The local runner generates:

- a consolidated `index.md` across all audited URLs,
- one route folder per URL,
- one per-route Markdown report with scores, metrics, top issues, code-mapping leads, budget results, and optional comparison data,
- raw Lighthouse JSON artifacts for each strategy.

Use the reports first, then inspect the codebase to connect findings to likely causes. Examples:

- high JS cost: inspect large client bundles, unnecessary client components, third-party SDKs, broad imports.
- render-blocking resources: inspect fonts, CSS entrypoints, preload strategy, synchronous scripts.
- image-related audits: inspect responsive image usage, poor formats, oversized assets, and lazy loading.
- server latency or document delay: inspect hosting, SSR, route handlers, and initial document work.
- LCP regressions: inspect hero image strategy, document response time, font loading, and above-the-fold dependencies.

Do not stop at generic advice. Point to concrete files, components, routes, or configuration when evidence supports it.

For interpretation guidance and response structure, read [references/report-format.md](references/report-format.md).

### 8. Suggest or implement code changes

After correlating the strongest Lighthouse findings with the repo, propose the smallest high-impact changes first.

Good outputs include:

- a Markdown report in `reports/pagespeed/...`,
- a short human summary for the user,
- a concrete change plan tied to files,
- optional direct code edits when the user wants fixes applied.

When suggesting code changes:

- distinguish Lighthouse-confirmed findings from repo-backed hypotheses,
- prioritize mobile issues first when they dominate user impact,
- prefer changes that improve LCP, TBT, CLS, and transfer size before cosmetic micro-optimizations,
- mention tradeoffs when a fix may affect UX, analytics, or rendering behavior.

### 9. Verify after changes

If code changes are applied, rerun the local Lighthouse audit against the same route set with `--compare-dir` pointing to the previous run so the report shows before and after deltas.

If the user also wants public validation, run PSI follow-up after the local compare pass.

## Output Shape

Use a predictable output structure so the user can scan results quickly.

For local Lighthouse runs, prefer:

```markdown
**Run Status**
Engine: local-lighthouse
Mode: baseline / multi-route / compare / budget-check
Execution: completed
Target: ...

**Route Summary**
| Strategy | Performance | Accessibility | Best Practices | SEO |
|---|---:|---:|---:|---:|

**Metrics**
| Strategy | FCP | LCP | TBT | CLS | SI | INP |

**Top Issues**
1. ...
2. ...
3. ...

**Code Mapping Leads**
- ...
- ...

**Raw Artifacts**
- ...

**Next Pass**
- ...
```

For PSI follow-up or blocked runs, keep the same general shape but make the engine and execution status explicit.

Keep the report compact by default. Expand only when the user asks for a deeper audit.

## Output Conventions

Prefer this repo-local layout:

```text
reports/
  pagespeed/
    <run-name>/
      index.md
      <target-slug>/
        mobile.lighthouse.json
        desktop.lighthouse.json
        summary.md
```

Use dated run folders or semantic names like `local-baseline`, `after-image-fixes`, `pre-release-homepage`, `psi-followup`, or `blocked-run` instead of overwriting previous runs silently.

## Resources

### package.json

Optional local cache for Lighthouse when you want the dependency available without fetching it on demand.

### scripts/run_local_lighthouse.mjs

Run real local Lighthouse audits, save JSON artifacts, and generate per-route Markdown reports plus a consolidated index.

### scripts/run_pagespeed_insights.py

Run optional PSI follow-up against public URLs.

### references/report-format.md

Use when you need a quick reminder of what the generated reports should contain, how local Lighthouse differs from PSI follow-up, and how to separate confirmed findings from repo-backed hypotheses.
