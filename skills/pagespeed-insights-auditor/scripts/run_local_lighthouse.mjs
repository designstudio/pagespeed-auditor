#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const DEFAULT_DIAGNOSTIC_IDS = [
  'render-blocking-resources',
  'unused-javascript',
  'unused-css-rules',
  'modern-image-formats',
  'uses-responsive-images',
  'uses-optimized-images',
  'offscreen-images',
  'server-response-time',
  'font-display',
  'unminified-css',
  'unminified-javascript',
  'uses-text-compression',
  'efficient-animated-content',
  'duplicated-javascript',
  'legacy-javascript',
  'third-party-summary',
  'mainthread-work-breakdown',
  'bootup-time',
  'dom-size',
];
const CODE_MAPPING_HINTS = {
  'unused-javascript': 'Inspect large client-only wrappers, broad imports, icon packs, and route-level chunking.',
  'render-blocking-resources': 'Inspect font loading, CSS entrypoints, preload usage, and synchronous third-party scripts.',
  'modern-image-formats': 'Inspect image formats, responsive sources, and asset compression in public/static folders.',
  'uses-responsive-images': 'Inspect image component usage and whether large assets are being shipped to small screens.',
  'uses-optimized-images': 'Inspect public assets and image pipeline choices for oversized or unoptimized files.',
  'offscreen-images': 'Inspect below-the-fold images and lazy-loading behavior.',
  'server-response-time': 'Inspect hosting, route handlers, SSR data loading, and document response latency.',
  'font-display': 'Inspect remote font usage, preload order, and fallback strategy.',
  'unused-css-rules': 'Inspect global CSS, utility generation, and components that no longer render.',
  'third-party-summary': 'Inspect analytics, embeds, tag managers, and any non-critical third-party script cost.',
  'dom-size': 'Inspect repeated lists, very large page trees, and oversized static markup.',
  'bootup-time': 'Inspect hydration scope, client-side initialization, and large startup bundles.',
  'mainthread-work-breakdown': 'Inspect hydration, script execution, and expensive client render paths.',
  'duplicated-javascript': 'Inspect duplicate dependencies, barrels, and overlapping client bundles.',
  'legacy-javascript': 'Inspect build target configuration and whether modern bundles can be shipped more efficiently.',
};
const KEY_ALIASES = {
  'out-dir': 'outDir',
  'urls-file': 'urlsFile',
  'compare-dir': 'compareDir',
  'report-file': 'reportFile',
  'index-file': 'indexFile',
  'chrome-flags': 'chromeFlags',
};
const CLEANUP_ERROR_PATTERNS = [
  'EPERM',
  'operation not permitted',
  'chrome-launcher',
  'cleanup',
  'unlink',
  'rmdir',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillDir = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`Usage: node scripts/run_local_lighthouse.mjs --url <url> --out-dir <dir> [options]

Local Lighthouse-first audit runner for the PageSpeed skill.

Options:
  --url <url>              Repeat for multiple URLs. Localhost is supported.
  --urls-file <file>       Optional text file with one URL per line.
  --out-dir <dir>          Output directory for reports and raw artifacts.
  --outDir <dir>           CamelCase alias for --out-dir.
  --strategy <value>       mobile | desktop | both (default: both)
  --categories <list>      Comma-separated categories (default: performance,accessibility,best-practices,seo)
  --budget <k=v>           Repeat for thresholds like performance=90
  --compare-dir <dir>      Previous run directory for score deltas.
  --report-file <name>     Per-route Markdown report filename (default: summary.md)
  --index-file <name>      Consolidated Markdown report filename (default: index.md)
  --locale <value>         Lighthouse locale (default: en-US)
  --chrome-flags <value>   Extra Chrome flags (default: --headless=new --disable-dev-shm-usage)
`);
}

function parseArgs(argv) {
  const args = {
    url: [],
    budget: [],
    strategy: 'both',
    categories: DEFAULT_CATEGORIES.join(','),
    reportFile: 'summary.md',
    indexFile: 'index.md',
    locale: 'en-US',
    chromeFlags: '--headless=new --disable-dev-shm-usage',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const trimmed = item.slice(2);
    const equalsIndex = trimmed.indexOf('=');
    const rawKey = equalsIndex >= 0 ? trimmed.slice(0, equalsIndex) : trimmed;
    const key = KEY_ALIASES[rawKey] || rawKey;
    const inlineValue = equalsIndex >= 0 ? trimmed.slice(equalsIndex + 1) : undefined;
    const nextValue = inlineValue ?? argv[index + 1];
    const consumeNext = inlineValue === undefined && nextValue && !nextValue.startsWith('--');
    const value = inlineValue ?? (consumeNext ? nextValue : true);

    if (consumeNext) {
      index += 1;
    }

    if (key === 'help' || key === 'h') {
      args.help = true;
      continue;
    }
    if (key === 'url') {
      args.url.push(String(value));
      continue;
    }
    if (key === 'budget') {
      args.budget.push(String(value));
      continue;
    }
    args[key] = value;
  }

  return args;
}

function parseCategories(raw) {
  const categories = String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!categories.length) {
    throw new Error('At least one category must be provided.');
  }
  return categories;
}

function parseBudgets(items) {
  const budgets = {};
  for (const item of items) {
    const text = String(item);
    const parts = text.split('=');
    if (parts.length !== 2) {
      throw new Error(`Invalid --budget '${text}'. Expected category=score.`);
    }
    const category = parts[0].trim().toLowerCase();
    const score = Number.parseInt(parts[1].trim(), 10);
    if (!category || Number.isNaN(score) || score < 0 || score > 100) {
      throw new Error(`Invalid --budget '${text}'. Score must be an integer from 0 to 100.`);
    }
    budgets[category] = score;
  }
  return budgets;
}

function loadUrls(urlArgs, urlsFile) {
  const urls = [...urlArgs];
  if (urlsFile) {
    const content = readFileSync(String(urlsFile), 'utf8');
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      urls.push(line);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      unique.push(url);
    }
  }
  if (!unique.length) {
    throw new Error('At least one --url or --urls-file entry is required.');
  }
  return unique;
}

function slugifyUrl(url) {
  return url
    .replace(/^https?:\/\//iu, '')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'target';
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function detectMode(routeCount, compareDir, budgets) {
  if (compareDir) {
    return 'compare';
  }
  if (Object.keys(budgets).length) {
    return 'budget-check';
  }
  if (routeCount > 1) {
    return 'multi-route';
  }
  return 'baseline';
}

function createLighthouseInvoker() {
  const filename = process.platform === 'win32' ? 'lighthouse.cmd' : 'lighthouse';
  const localBin = path.join(skillDir, 'node_modules', '.bin', filename);
  if (existsSync(localBin)) {
    return {
      label: 'local-node-modules',
      run(args) {
        return spawnSync(localBin, args, { cwd: skillDir, encoding: 'utf8', stdio: 'pipe' });
      },
    };
  }

  if (process.platform === 'win32') {
    return {
      label: 'npx-lighthouse',
      run(args) {
        return spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx', 'lighthouse', ...args], {
          cwd: skillDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      },
    };
  }

  return {
    label: 'npx-lighthouse',
    run(args) {
      return spawnSync('npx', ['lighthouse', ...args], {
        cwd: skillDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    },
  };
}

function isRecoverableCleanupError(result) {
  const combined = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  return CLEANUP_ERROR_PATTERNS.some((pattern) => combined.includes(pattern.toLowerCase()));
}

function normalizeStatus(result) {
  return typeof result.status === 'number' ? result.status : 1;
}

function runLighthouse(url, strategy, categories, locale, chromeFlags, routeDir, invoker) {
  const jsonPath = path.join(routeDir, `${strategy}.lighthouse.json`);
  const warnings = [];
  const args = [
    url,
    '--quiet',
    `--only-categories=${categories.join(',')}`,
    `--locale=${locale}`,
    `--chrome-flags=${chromeFlags}`,
    '--output=json',
    `--output-path=${jsonPath}`,
  ];

  if (strategy === 'desktop') {
    args.push('--preset=desktop');
  }

  const result = invoker.run(args);
  const outputExists = existsSync(jsonPath);
  const status = normalizeStatus(result);

  if (status !== 0 && !(outputExists && isRecoverableCleanupError(result))) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(
      stderr || stdout || `Lighthouse JSON run failed using ${invoker.label}. Install Lighthouse locally or ensure npx can fetch it.`
    );
  }

  if (status !== 0 && outputExists) {
    warnings.push('Lighthouse exited with a cleanup error after writing JSON artifacts. Results were recovered from disk.');
  }

  if (!outputExists) {
    throw new Error(`Lighthouse did not produce the expected JSON artifact: ${jsonPath}`);
  }

  const lhr = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return { jsonPath, lhr, engineSource: invoker.label, warnings };
}

function getCategories(lhr) {
  return lhr.categories || {};
}

function getAudits(lhr) {
  return lhr.audits || {};
}

function scoreValue(lhr, category) {
  const entry = getCategories(lhr)[category];
  if (!entry || typeof entry.score !== 'number') {
    return null;
  }
  return Math.round(entry.score * 100);
}

function extractScores(lhr, categories) {
  const scores = {};
  for (const category of categories) {
    scores[category] = scoreValue(lhr, category);
  }
  return scores;
}

function metricInfo(lhr, auditId) {
  const audit = getAudits(lhr)[auditId] || {};
  return {
    display: audit.displayValue || 'n/a',
    numeric: typeof audit.numericValue === 'number' ? audit.numericValue : null,
  };
}

function extractMetrics(lhr) {
  return {
    fcp: metricInfo(lhr, 'first-contentful-paint'),
    lcp: metricInfo(lhr, 'largest-contentful-paint'),
    cls: metricInfo(lhr, 'cumulative-layout-shift'),
    inp: metricInfo(lhr, 'interaction-to-next-paint'),
    tbt: metricInfo(lhr, 'total-blocking-time'),
    speedIndex: metricInfo(lhr, 'speed-index'),
  };
}

function extractOpportunities(lhr, limit = 8) {
  return Object.entries(getAudits(lhr))
    .filter(([, audit]) => audit?.details?.type === 'opportunity')
    .map(([id, audit]) => ({
      id,
      title: audit.title || id,
      description: cleanText(audit.description || ''),
      displayValue: audit.displayValue || '',
      savingsMs: typeof audit?.details?.overallSavingsMs === 'number' ? audit.details.overallSavingsMs : null,
      savingsBytes: typeof audit?.details?.overallSavingsBytes === 'number' ? audit.details.overallSavingsBytes : null,
      score: typeof audit.score === 'number' ? audit.score : null,
    }))
    .sort((left, right) => (right.savingsMs || 0) - (left.savingsMs || 0) || (left.score || 1) - (right.score || 1))
    .slice(0, limit);
}

function extractDiagnostics(lhr) {
  const audits = getAudits(lhr);
  return DEFAULT_DIAGNOSTIC_IDS
    .map((id) => {
      const audit = audits[id];
      if (!audit) {
        return null;
      }
      return {
        id,
        title: audit.title || id,
        description: cleanText(audit.description || ''),
        displayValue: audit.displayValue || '',
        score: typeof audit.score === 'number' ? audit.score : null,
      };
    })
    .filter(Boolean);
}

function extractManualFacts(lhr) {
  return {
    capturedAt: lhr.fetchTime || null,
    lighthouseVersion: lhr.lighthouseVersion || null,
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl || null,
    requestedUrl: lhr.requestedUrl || null,
  };
}

function cleanText(text) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/\s+/gu, ' ').trim();
}

function compareScores(current, previous) {
  const deltas = {};
  let found = false;
  for (const [category, score] of Object.entries(current)) {
    const previousScore = previous[category];
    if (score === null || previousScore === null || previousScore === undefined) {
      continue;
    }
    deltas[category] = score - previousScore;
    found = true;
  }
  return found ? deltas : null;
}

function budgetResults(scores, budgets) {
  return Object.entries(budgets).map(([category, threshold]) => {
    const score = scores[category];
    if (score === null || score === undefined) {
      return { category, threshold, score: null, status: 'missing' };
    }
    return {
      category,
      threshold,
      score,
      status: score >= threshold ? 'pass' : 'fail',
    };
  });
}

function formatDelta(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return value > 0 ? `+${value}` : String(value);
}

function uniqueTopIssues(routeSummary) {
  const items = [];
  for (const strategy of Object.values(routeSummary.strategies)) {
    for (const opportunity of strategy.opportunities) {
      items.push({
        title: opportunity.title,
        detail: opportunity.displayValue || (opportunity.savingsMs ? `estimated savings ${Math.round(opportunity.savingsMs)} ms` : 'Opportunity detected'),
        id: opportunity.id,
      });
    }
    for (const diagnostic of strategy.diagnostics.slice(0, 4)) {
      items.push({
        title: diagnostic.title,
        detail: diagnostic.displayValue || 'Diagnostic signal',
        id: diagnostic.id,
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
    if (unique.length === 3) {
      break;
    }
  }
  return unique;
}

function buildCodeMappingLeads(routeSummary) {
  const seen = new Set();
  const leads = [];
  for (const strategy of Object.values(routeSummary.strategies)) {
    for (const opportunity of strategy.opportunities) {
      if (CODE_MAPPING_HINTS[opportunity.id] && !seen.has(opportunity.id)) {
        seen.add(opportunity.id);
        leads.push({ id: opportunity.id, hint: CODE_MAPPING_HINTS[opportunity.id] });
      }
    }
    for (const diagnostic of strategy.diagnostics) {
      if (CODE_MAPPING_HINTS[diagnostic.id] && !seen.has(diagnostic.id)) {
        seen.add(diagnostic.id);
        leads.push({ id: diagnostic.id, hint: CODE_MAPPING_HINTS[diagnostic.id] });
      }
    }
  }
  return leads.slice(0, 5);
}

function loadPreviousLhr(compareDir, slug, strategy) {
  if (!compareDir) {
    return null;
  }
  const filePath = path.join(compareDir, slug, `${strategy}.lighthouse.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectRouteResult(url, outDir, strategies, categories, budgets, compareDir, locale, chromeFlags, invoker) {
  const slug = slugifyUrl(url);
  const routeDir = path.join(outDir, slug);
  ensureDir(routeDir);

  const routeSummary = {
    url,
    slug,
    strategies: {},
  };

  for (const strategy of strategies) {
    const { lhr, jsonPath, engineSource, warnings } = runLighthouse(url, strategy, categories, locale, chromeFlags, routeDir, invoker);
    const scores = extractScores(lhr, categories);
    const previous = loadPreviousLhr(compareDir, slug, strategy);
    const previousScores = previous ? extractScores(previous, categories) : null;
    routeSummary.strategies[strategy] = {
      facts: extractManualFacts(lhr),
      scores,
      metrics: extractMetrics(lhr),
      opportunities: extractOpportunities(lhr),
      diagnostics: extractDiagnostics(lhr),
      comparison: previousScores ? compareScores(scores, previousScores) : null,
      budgetStatus: budgetResults(scores, budgets),
      rawJson: path.basename(jsonPath),
      passedAudits: Object.values(getAudits(lhr)).filter((audit) => audit.score === 1).length,
      engineSource,
      warnings,
    };
  }

  return routeSummary;
}

function categoryLabel(category) {
  return category.replace('best-practices', 'Best Practices').replace(/^./u, (char) => char.toUpperCase());
}

function buildRouteReport(routeSummary, categories, mode, compareDir, budgets) {
  const firstStrategy = Object.values(routeSummary.strategies)[0];
  const engineSource = firstStrategy?.engineSource || 'unknown';
  const allWarnings = [...new Set(Object.values(routeSummary.strategies).flatMap((item) => item.warnings || []))];
  const lines = [
    '# Local Lighthouse Report',
    '',
    '**Run Status**',
    'Engine: local-lighthouse',
    `Engine source: ${engineSource}`,
    `Mode: ${mode}`,
    'Execution: completed',
    `Target: ${routeSummary.url}`,
  ];

  if (compareDir) {
    lines.push(`Comparison baseline: \`${compareDir}\``);
  }
  if (Object.keys(budgets).length) {
    const formattedBudgets = Object.entries(budgets).map(([key, value]) => `${key}=${value}`).join(', ');
    lines.push(`Budgets: \`${formattedBudgets}\``);
  }
  if (allWarnings.length) {
    lines.push(`Warnings: ${allWarnings.join(' ')}`);
  }

  lines.push('', '**Route Summary**');
  lines.push(`| Strategy | ${categories.map(categoryLabel).join(' | ')} |`);
  lines.push(`|---|${categories.map(() => '---:').join('|')}|`);
  for (const [strategy, data] of Object.entries(routeSummary.strategies)) {
    const row = categories.map((category) => data.scores[category] ?? 'n/a');
    lines.push(`| ${strategy} | ${row.join(' | ')} |`);
  }

  lines.push('', '**Metrics**');
  lines.push('| Strategy | FCP | LCP | TBT | CLS | SI | INP |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [strategy, data] of Object.entries(routeSummary.strategies)) {
    const metrics = data.metrics;
    lines.push(`| ${strategy} | ${metrics.fcp.display} | ${metrics.lcp.display} | ${metrics.tbt.display} | ${metrics.cls.display} | ${metrics.speedIndex.display} | ${metrics.inp.display} |`);
  }

  lines.push('', '**Top Issues**');
  const topIssues = uniqueTopIssues(routeSummary);
  if (topIssues.length) {
    topIssues.forEach((issue, index) => {
      lines.push(`${index + 1}. **${issue.title}** - ${issue.detail}`);
    });
  } else {
    lines.push('1. No major failing opportunities were surfaced by Lighthouse in this run.');
  }

  lines.push('', '**Code Mapping Leads**');
  const leads = buildCodeMappingLeads(routeSummary);
  if (leads.length) {
    leads.forEach((lead) => {
      lines.push(`- \`${lead.id}\`: ${lead.hint}`);
    });
  } else {
    lines.push('- Use the highest-cost opportunities and diagnostics to inspect matching assets, routes, and client-side bundles in the repo.');
  }

  for (const [strategy, data] of Object.entries(routeSummary.strategies)) {
    lines.push('', `**${strategy[0].toUpperCase()}${strategy.slice(1)} Details**`);
    const facts = data.facts;
    lines.push(`- Engine source: \`${data.engineSource}\``);
    if (facts.finalUrl) {
      lines.push(`- Final URL: \`${facts.finalUrl}\``);
    }
    if (facts.lighthouseVersion) {
      lines.push(`- Lighthouse version: \`${facts.lighthouseVersion}\``);
    }
    if (facts.capturedAt) {
      lines.push(`- Captured at: \`${facts.capturedAt}\``);
    }
    if (data.warnings.length) {
      data.warnings.forEach((warning) => lines.push(`- Warning: ${warning}`));
    }
    if (data.comparison) {
      lines.push('- Score deltas:');
      for (const category of categories) {
        if (data.comparison[category] !== undefined) {
          lines.push(`  - ${category}: \`${formatDelta(data.comparison[category])}\``);
        }
      }
    }
    if (data.budgetStatus.length) {
      lines.push('- Budget checks:');
      for (const item of data.budgetStatus) {
        lines.push(`  - ${item.category}: \`${item.score ?? 'n/a'}\` vs \`${item.threshold}\` -> \`${item.status}\``);
      }
    }
    lines.push(`- Passed audits: ${data.passedAudits}`);

    lines.push('', 'Highest-impact opportunities:');
    if (data.opportunities.length) {
      data.opportunities.slice(0, 5).forEach((item, index) => {
        const parts = [];
        if (item.displayValue) parts.push(item.displayValue);
        if (item.savingsMs) parts.push(`estimated savings ${Math.round(item.savingsMs)} ms`);
        if (item.savingsBytes) parts.push(`estimated savings ${Math.round(item.savingsBytes)} bytes`);
        lines.push(`${index + 1}. **${item.title}** - ${parts.join(' - ') || 'Opportunity detected'}`);
      });
    } else {
      lines.push('1. No major failing opportunities were returned.');
    }

    lines.push('', 'Selected diagnostics:');
    if (data.diagnostics.length) {
      data.diagnostics.slice(0, 6).forEach((item) => {
        lines.push(`- **${item.title}** - ${item.displayValue || 'Diagnostic signal'}`);
      });
    } else {
      lines.push('- No selected diagnostics were returned.');
    }
  }

  lines.push('', '**Raw Artifacts**');
  for (const [strategy, data] of Object.entries(routeSummary.strategies)) {
    lines.push(`- ${strategy}: \`${path.join(routeSummary.slug, data.rawJson)}\``);
  }

  lines.push('', '**Next Pass**');
  lines.push('- Map the biggest Lighthouse failures back to specific components, assets, and route-level code in the repository.');
  if (mode !== 'compare') {
    lines.push('- After fixes, rerun this same route set in compare mode to verify score deltas.');
  }
  lines.push('- If you also want Google field data or external validation, run the optional PSI script against the public URLs.');

  return `${lines.join('\n')}\n`;
}

function buildIndexReport(routeSummaries, categories, mode, compareDir, budgets, outDir) {
  const engineSources = [...new Set(routeSummaries.flatMap((routeSummary) => Object.values(routeSummary.strategies).map((entry) => entry.engineSource)))];
  const warnings = [...new Set(routeSummaries.flatMap((routeSummary) => Object.values(routeSummary.strategies).flatMap((entry) => entry.warnings || [])))];
  const lines = [
    '# Local Lighthouse Audit Index',
    '',
    '**Run Status**',
    'Engine: local-lighthouse',
    `Engine source: ${engineSources.join(', ') || 'unknown'}`,
    `Mode: ${mode}`,
    'Execution: completed',
    `Output directory: \`${outDir}\``,
  ];

  if (compareDir) {
    lines.push(`Comparison baseline: \`${compareDir}\``);
  }
  if (Object.keys(budgets).length) {
    const formattedBudgets = Object.entries(budgets).map(([key, value]) => `${key}=${value}`).join(', ');
    lines.push(`Budgets: \`${formattedBudgets}\``);
  }
  if (warnings.length) {
    lines.push(`Warnings: ${warnings.join(' ')}`);
  }

  lines.push('', '**Routes**');
  lines.push(`| Route | Strategy | ${categories.map(categoryLabel).join(' | ')} | Report |`);
  lines.push(`|---|---|${categories.map(() => '---:').join('|')}|---|`);
  for (const routeSummary of routeSummaries) {
    for (const [strategy, data] of Object.entries(routeSummary.strategies)) {
      const row = categories.map((category) => data.scores[category] ?? 'n/a');
      lines.push(`| ${routeSummary.url} | ${strategy} | ${row.join(' | ')} | \`${path.join(routeSummary.slug, 'summary.md')}\` |`);
    }
  }

  lines.push('', '**Recommended Workflow**');
  lines.push('1. Prefer a production-like target first: built preview, static output, or framework preview server.');
  lines.push('2. Start from the lowest mobile scores and the biggest LCP or TBT regressions.');
  lines.push('3. Open each route summary and inspect the highest-impact opportunities.');
  lines.push('4. Map those findings back to code before editing.');
  lines.push('5. Rerun locally after fixes, then optionally validate with PSI on a public URL.');

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.outDir) {
    throw new Error('--out-dir is required.');
  }

  const urls = loadUrls(args.url, args.urlsFile);
  const strategies = args.strategy === 'both' ? ['mobile', 'desktop'] : [String(args.strategy)];
  const categories = parseCategories(args.categories);
  const budgets = parseBudgets(args.budget);
  const compareDir = args.compareDir ? path.resolve(String(args.compareDir)) : null;
  const outDir = path.resolve(String(args.outDir));
  const mode = detectMode(urls.length, compareDir, budgets);
  const invoker = createLighthouseInvoker();

  ensureDir(outDir);

  const routeSummaries = urls.map((url) => {
    const routeSummary = collectRouteResult(
      url,
      outDir,
      strategies,
      categories,
      budgets,
      compareDir,
      String(args.locale),
      String(args.chromeFlags),
      invoker
    );
    const report = buildRouteReport(routeSummary, categories, mode, compareDir, budgets);
    writeFileSync(path.join(outDir, routeSummary.slug, String(args.reportFile)), report, 'utf8');
    return routeSummary;
  });

  const indexReport = buildIndexReport(routeSummaries, categories, mode, compareDir, budgets, outDir);
  writeFileSync(path.join(outDir, String(args.indexFile)), indexReport, 'utf8');

  console.log(`Saved local Lighthouse artifacts to: ${outDir}`);
  console.log(`- consolidated report: ${path.join(outDir, String(args.indexFile))}`);
  for (const routeSummary of routeSummaries) {
    console.log(`- route report: ${path.join(outDir, routeSummary.slug, String(args.reportFile))}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
