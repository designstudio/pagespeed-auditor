#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"]
DEFAULT_DIAGNOSTIC_IDS = [
    "render-blocking-resources",
    "unused-javascript",
    "unused-css-rules",
    "modern-image-formats",
    "uses-responsive-images",
    "uses-optimized-images",
    "offscreen-images",
    "server-response-time",
    "font-display",
    "unminified-css",
    "unminified-javascript",
    "uses-text-compression",
    "efficient-animated-content",
    "duplicated-javascript",
    "legacy-javascript",
    "third-party-summary",
    "mainthread-work-breakdown",
    "bootup-time",
    "dom-size",
]
PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run PageSpeed Insights for one or more public URLs, save raw JSON artifacts, "
            "and generate Markdown reports with optional comparisons and budgets."
        )
    )
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="Public URL to audit. Repeat the flag to audit multiple URLs.",
    )
    parser.add_argument(
        "--urls-file",
        help="Optional text file with one URL per line. Blank lines and lines starting with # are ignored.",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="Output directory where per-URL artifacts and reports will be written.",
    )
    parser.add_argument(
        "--strategy",
        choices=["mobile", "desktop", "both"],
        default="both",
        help="PageSpeed Insights strategy to run.",
    )
    parser.add_argument(
        "--categories",
        default=",".join(DEFAULT_CATEGORIES),
        help="Comma-separated Lighthouse categories to request.",
    )
    parser.add_argument(
        "--api-key-env",
        default="PSI_API_KEY",
        help="Environment variable holding a PageSpeed Insights API key.",
    )
    parser.add_argument(
        "--locale",
        default="en-US",
        help="Locale forwarded to PageSpeed Insights.",
    )
    parser.add_argument(
        "--budget",
        action="append",
        default=[],
        help=(
            "Optional category budget in the form category=score. "
            "Repeat the flag for multiple budgets, for example --budget performance=90."
        ),
    )
    parser.add_argument(
        "--compare-dir",
        help=(
            "Optional previous output directory to compare against. "
            "The script looks for matching <compare-dir>/<target-slug>/<strategy>.json files."
        ),
    )
    parser.add_argument(
        "--report-file",
        default="summary.md",
        help="Per-URL Markdown report filename. Defaults to summary.md.",
    )
    parser.add_argument(
        "--index-file",
        default="index.md",
        help="Top-level consolidated Markdown report filename. Defaults to index.md.",
    )
    return parser.parse_args()


def ensure_public_url(url: str) -> None:
    lowered = url.lower()
    if "localhost" in lowered or "127.0.0.1" in lowered:
        raise ValueError(
            "PageSpeed Insights requires a publicly reachable URL. "
            "Provide a staging, preview, or production address instead of localhost."
        )


def slugify_url(url: str) -> str:
    slug = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE)
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", slug).strip("-")
    return slug or "pagespeed-target"


def load_urls(url_args: list[str], urls_file: str | None) -> list[str]:
    urls = list(url_args)
    if urls_file:
        for raw in Path(urls_file).read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            urls.append(line)
    unique_urls: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)
    if not unique_urls:
        raise ValueError("At least one --url or --urls-file entry is required.")
    for url in unique_urls:
        ensure_public_url(url)
    return unique_urls


def parse_categories(raw: str) -> list[str]:
    categories = [item.strip() for item in raw.split(",") if item.strip()]
    if not categories:
        raise ValueError("At least one category must be provided.")
    return categories


def parse_budgets(items: list[str]) -> dict[str, int]:
    budgets: dict[str, int] = {}
    for item in items:
        if "=" not in item:
            raise ValueError(f"Invalid --budget '{item}'. Expected category=score.")
        key, value = item.split("=", 1)
        category = key.strip().lower()
        if not category:
            raise ValueError(f"Invalid --budget '{item}'. Category is required.")
        try:
            score = int(value.strip())
        except ValueError as exc:
            raise ValueError(f"Invalid --budget '{item}'. Score must be an integer.") from exc
        if score < 0 or score > 100:
            raise ValueError(f"Invalid --budget '{item}'. Score must be between 0 and 100.")
        budgets[category] = score
    return budgets


def request_psi(url: str, strategy: str, categories: list[str], locale: str, api_key: str | None) -> dict[str, Any]:
    params: list[tuple[str, str]] = [
        ("url", url),
        ("strategy", strategy),
        ("locale", locale),
        ("utm_source", "codex-pagespeed-skill"),
    ]
    for category in categories:
        params.append(("category", category))
    if api_key:
        params.append(("key", api_key))

    request = Request(f"{PSI_ENDPOINT}?{urlencode(params)}")
    request.add_header("Accept", "application/json")

    try:
        with urlopen(request, timeout=120) as response:
            return json.load(response)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"PageSpeed Insights returned HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Failed to reach PageSpeed Insights: {exc.reason}") from exc


def get_lighthouse(result: dict[str, Any]) -> dict[str, Any]:
    return result.get("lighthouseResult", {})


def get_audits(result: dict[str, Any]) -> dict[str, Any]:
    return get_lighthouse(result).get("audits", {})


def score_value(result: dict[str, Any], category: str) -> int | None:
    categories = get_lighthouse(result).get("categories", {})
    entry = categories.get(category, {})
    score = entry.get("score")
    if score is None:
        return None
    return round(score * 100)


def score_display(result: dict[str, Any], category: str) -> str:
    score = score_value(result, category)
    return "n/a" if score is None else str(score)


def metric_display(result: dict[str, Any], audit_id: str) -> str:
    audit = get_audits(result).get(audit_id, {})
    return audit.get("displayValue") or "n/a"


def metric_numeric(result: dict[str, Any], audit_id: str) -> float | None:
    audit = get_audits(result).get(audit_id, {})
    value = audit.get("numericValue")
    if isinstance(value, (int, float)):
        return float(value)
    return None


def extract_field_items(result: dict[str, Any]) -> list[str]:
    experience = result.get("loadingExperience") or {}
    metrics = experience.get("metrics") or {}
    items: list[str] = []
    labels = {
        "LARGEST_CONTENTFUL_PAINT_MS": "LCP",
        "INTERACTION_TO_NEXT_PAINT": "INP",
        "CUMULATIVE_LAYOUT_SHIFT_SCORE": "CLS",
        "EXPERIMENTAL_TIME_TO_FIRST_BYTE": "TTFB",
    }
    for key, label in labels.items():
        metric = metrics.get(key)
        if not metric:
            continue
        percentile = metric.get("percentile")
        category = metric.get("category", "n/a")
        if percentile is None:
            continue
        items.append(f"- {label}: `{percentile}` ({category.lower()})")

    overall = experience.get("overall_category")
    if overall:
        items.append(f"- Overall field assessment: `{overall.lower()}`")
    return items


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text or "")).strip()


def numeric_savings(audit: dict[str, Any]) -> float:
    details = audit.get("details") or {}
    for key in ("overallSavingsMs", "overallSavingsBytes"):
        value = details.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    numeric_value = audit.get("numericValue")
    if isinstance(numeric_value, (int, float)):
        return float(numeric_value)
    return 0.0


def extract_opportunities(result: dict[str, Any], limit: int = 8) -> list[dict[str, Any]]:
    ranked: list[tuple[float, dict[str, Any]]] = []
    for audit_id, audit in get_audits(result).items():
        details = audit.get("details") or {}
        if details.get("type") != "opportunity":
            continue
        savings = numeric_savings(audit)
        ranked.append(
            (
                savings,
                {
                    "id": audit_id,
                    "title": audit.get("title", audit_id),
                    "displayValue": audit.get("displayValue") or "",
                    "description": clean_text(audit.get("description", "")),
                    "score": audit.get("score"),
                    "savingsMs": details.get("overallSavingsMs"),
                    "savingsBytes": details.get("overallSavingsBytes"),
                },
            )
        )
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item for _, item in ranked[:limit]]


def extract_diagnostics(result: dict[str, Any]) -> list[dict[str, Any]]:
    audits = get_audits(result)
    diagnostics: list[dict[str, Any]] = []
    for audit_id in DEFAULT_DIAGNOSTIC_IDS:
        audit = audits.get(audit_id)
        if not audit:
            continue
        diagnostics.append(
            {
                "id": audit_id,
                "title": audit.get("title", audit_id),
                "displayValue": audit.get("displayValue") or "",
                "description": clean_text(audit.get("description", "")),
                "score": audit.get("score"),
            }
        )
    return diagnostics


def extract_scores(result: dict[str, Any], categories: list[str]) -> dict[str, int | None]:
    return {category: score_value(result, category) for category in categories}


def extract_metrics(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    mapping = {
        "fcp": "first-contentful-paint",
        "lcp": "largest-contentful-paint",
        "cls": "cumulative-layout-shift",
        "tbt": "total-blocking-time",
        "speed_index": "speed-index",
        "inp": "interaction-to-next-paint",
    }
    return {
        key: {
            "display": metric_display(result, audit_id),
            "numeric": metric_numeric(result, audit_id),
        }
        for key, audit_id in mapping.items()
    }


def load_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def compare_scores(current: dict[str, int | None], previous: dict[str, int | None]) -> dict[str, int] | None:
    deltas: dict[str, int] = {}
    found = False
    for category, value in current.items():
        previous_value = previous.get(category)
        if value is None or previous_value is None:
            continue
        deltas[category] = value - previous_value
        found = True
    return deltas if found else None


def budget_results(scores: dict[str, int | None], budgets: dict[str, int]) -> list[dict[str, Any]]:
    findings = []
    for category, threshold in budgets.items():
        score = scores.get(category)
        if score is None:
            findings.append({"category": category, "threshold": threshold, "score": None, "status": "missing"})
        elif score >= threshold:
            findings.append({"category": category, "threshold": threshold, "score": score, "status": "pass"})
        else:
            findings.append({"category": category, "threshold": threshold, "score": score, "status": "fail"})
    return findings


def format_delta(value: int | None) -> str:
    if value is None:
        return "n/a"
    if value > 0:
        return f"+{value}"
    return str(value)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def collect_route_result(
    url: str,
    out_dir: Path,
    strategies: list[str],
    categories: list[str],
    locale: str,
    api_key: str | None,
    compare_dir: Path | None,
    budgets: dict[str, int],
) -> dict[str, Any]:
    slug = slugify_url(url)
    route_dir = out_dir / slug
    route_dir.mkdir(parents=True, exist_ok=True)

    strategy_results: dict[str, dict[str, Any]] = {}
    for strategy in strategies:
        payload = request_psi(url, strategy, categories, locale, api_key)
        strategy_results[strategy] = payload
        write_json(route_dir / f"{strategy}.json", payload)

    comparisons: dict[str, Any] = {}
    if compare_dir:
        compare_route_dir = compare_dir / slug
        for strategy in strategies:
            previous_payload = load_json_if_exists(compare_route_dir / f"{strategy}.json")
            if not previous_payload:
                continue
            comparisons[strategy] = {
                "scores": compare_scores(
                    extract_scores(strategy_results[strategy], categories),
                    extract_scores(previous_payload, categories),
                )
            }

    route_summary = {
        "url": url,
        "slug": slug,
        "strategies": {},
        "budgets": {},
    }

    for strategy in strategies:
        payload = strategy_results[strategy]
        scores = extract_scores(payload, categories)
        budget_status = budget_results(scores, budgets)
        route_summary["strategies"][strategy] = {
            "final_url": get_lighthouse(payload).get("finalDisplayedUrl") or payload.get("id", url),
            "fetch_time": get_lighthouse(payload).get("fetchTime"),
            "lighthouse_version": get_lighthouse(payload).get("lighthouseVersion"),
            "scores": scores,
            "metrics": extract_metrics(payload),
            "field_data": extract_field_items(payload),
            "opportunities": extract_opportunities(payload),
            "diagnostics": extract_diagnostics(payload),
            "comparison": comparisons.get(strategy),
            "budget_status": budget_status,
        }

    return route_summary


def build_route_report(
    summary: dict[str, Any],
    categories: list[str],
    used_api_key: bool,
    api_key_env: str,
    compare_dir: Path | None,
) -> str:
    url = summary["url"]
    slug = summary["slug"]
    strategies = summary["strategies"]
    lines = [
        "# PageSpeed Insights Report",
        "",
        f"- Requested URL: `{url}`",
        f"- Route slug: `{slug}`",
        f"- Generated at: `{datetime.now(timezone.utc).isoformat()}`",
    ]
    if used_api_key:
        lines.append(f"- API key: loaded from environment variable `{api_key_env}`")
    else:
        lines.append(f"- API key: not provided; request ran on anonymous quota. Set `{api_key_env}` for more reliable automation.")
    if compare_dir:
        lines.append(f"- Comparison baseline: `{compare_dir}`")
    lines.extend([
        "",
        "## Summary",
        "",
        "| Strategy | " + " | ".join(category.title() for category in categories) + " |",
        "| --- | " + " | ".join(["---:"] * len(categories)) + " |",
    ])
    for strategy, data in strategies.items():
        row = [strategy] + [str(data["scores"].get(category, "n/a")) if data["scores"].get(category) is not None else "n/a" for category in categories]
        lines.append("| " + " | ".join(row) + " |")

    lines.extend([
        "",
        "## Core Metrics",
        "",
        "| Strategy | FCP | LCP | CLS | INP | TBT | Speed Index |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for strategy, data in strategies.items():
        metrics = data["metrics"]
        lines.append(
            f"| {strategy} | {metrics['fcp']['display']} | {metrics['lcp']['display']} | {metrics['cls']['display']} | {metrics['inp']['display']} | {metrics['tbt']['display']} | {metrics['speed_index']['display']} |"
        )

    for strategy, data in strategies.items():
        lines.extend([
            "",
            f"## {strategy.title()}",
            "",
            f"- Final URL: `{data['final_url']}`",
            f"- Lighthouse version: `{data['lighthouse_version'] or 'n/a'}`",
            f"- Fetch time: `{data['fetch_time'] or 'n/a'}`",
        ])
        comparison = data.get("comparison") or {}
        if comparison.get("scores"):
            lines.append("- Score deltas vs baseline:")
            for category in categories:
                delta = comparison["scores"].get(category)
                if delta is not None:
                    lines.append(f"  - {category}: `{format_delta(delta)}`")
        budget_status = data.get("budget_status") or []
        if budget_status:
            lines.append("- Budget checks:")
            for item in budget_status:
                status = item["status"]
                score = "n/a" if item["score"] is None else str(item["score"])
                lines.append(f"  - {item['category']}: `{score}` vs threshold `{item['threshold']}` -> `{status}`")

        field_data = data.get("field_data") or []
        lines.extend(["", "### Field Data", ""])
        if field_data:
            lines.extend(field_data)
        else:
            lines.append("- No CrUX field data was returned for this strategy.")

        lines.extend(["", "### Highest-Impact Opportunities", ""])
        opportunities = data.get("opportunities") or []
        if opportunities:
            for index, item in enumerate(opportunities, start=1):
                detail_bits = []
                if item.get("displayValue"):
                    detail_bits.append(item["displayValue"])
                if isinstance(item.get("savingsMs"), (int, float)):
                    detail_bits.append(f"estimated savings {round(item['savingsMs'])} ms")
                if isinstance(item.get("savingsBytes"), (int, float)):
                    detail_bits.append(f"estimated savings {round(item['savingsBytes'])} bytes")
                detail_text = " - ".join(detail_bits) if detail_bits else "No display value"
                lines.append(f"{index}. **{item['title']}** - {detail_text}")
                lines.append(f"   - Audit ID: `{item['id']}`")
                if item.get("description"):
                    lines.append(f"   - {item['description']}")
        else:
            lines.append("No major opportunities were returned.")

        lines.extend(["", "### Diagnostics", ""])
        diagnostics = data.get("diagnostics") or []
        if diagnostics:
            for item in diagnostics:
                display = item["displayValue"] or "No display value"
                lines.append(f"- **{item['title']}** - {display}")
                lines.append(f"  - Audit ID: `{item['id']}`")
                if item.get("description"):
                    lines.append(f"  - {item['description']}")
        else:
            lines.append("No selected diagnostics were returned.")

    lines.extend([
        "",
        "## Recommended Fixes In This Codebase",
        "",
        "Map the strongest PSI findings back to concrete files, routes, components, and configuration before editing code.",
        "Prioritize LCP, INP/TBT, render-blocking resources, oversized images, and unused JavaScript before lower-impact polish work.",
        "",
        "## Suggested Implementation Order",
        "",
        "1. Fix LCP blockers first: hero image strategy, server response time, render-blocking CSS/JS, and font loading.",
        "2. Reduce JavaScript cost: remove unused scripts, split bundles, and lazy-load non-critical components.",
        "3. Optimize images: modern formats, correct dimensions, responsive loading, and lazy loading.",
        "4. Improve layout stability: reserve image and embed space, and remove late layout shifts.",
        "5. Address accessibility and SEO findings after the critical performance path is stable.",
        "",
        "## Raw Artifacts",
        "",
        f"- JSON files saved under `{slug}/` for this route.",
    ])
    return "\n".join(lines).rstrip() + "\n"


def build_index_report(
    route_summaries: list[dict[str, Any]],
    categories: list[str],
    used_api_key: bool,
    api_key_env: str,
    compare_dir: Path | None,
    budgets: dict[str, int],
    out_dir: Path,
) -> str:
    lines = [
        "# PageSpeed Insights Audit Index",
        "",
        f"- Generated at: `{datetime.now(timezone.utc).isoformat()}`",
        f"- Output directory: `{out_dir}`",
    ]
    if used_api_key:
        lines.append(f"- API key: loaded from environment variable `{api_key_env}`")
    else:
        lines.append(f"- API key: not provided; request ran on anonymous quota. Set `{api_key_env}` for more reliable automation.")
    if compare_dir:
        lines.append(f"- Comparison baseline: `{compare_dir}`")
    if budgets:
        formatted = ", ".join(f"{key}={value}" for key, value in budgets.items())
        lines.append(f"- Budgets: `{formatted}`")
    lines.extend([
        "",
        "## Routes",
        "",
        "| Route | Strategy | " + " | ".join(category.title() for category in categories) + " | Report |",
        "| --- | --- | " + " | ".join(["---:"] * len(categories)) + " | --- |",
    ])
    for route_summary in route_summaries:
        slug = route_summary["slug"]
        for strategy, data in route_summary["strategies"].items():
            row = [
                route_summary["url"],
                strategy,
                *[
                    str(data["scores"].get(category, "n/a")) if data["scores"].get(category) is not None else "n/a"
                    for category in categories
                ],
                f"`{slug}/summary.md`",
            ]
            lines.append("| " + " | ".join(row) + " |")

    lines.extend([
        "",
        "## Recommended Workflow",
        "",
        "1. Start from the lowest mobile scores and the largest LCP or INP regressions.",
        "2. Open the per-route report to inspect opportunities and diagnostics.",
        "3. Map the top findings back to code before proposing edits.",
        "4. Apply small, measurable fixes and rerun the same route to verify impact.",
    ])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    args = parse_args()
    urls = load_urls(args.url, args.urls_file)
    categories = parse_categories(args.categories)
    budgets = parse_budgets(args.budget)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    api_key = os.getenv(args.api_key_env) or None
    used_api_key = bool(api_key)
    strategies = ["mobile", "desktop"] if args.strategy == "both" else [args.strategy]
    compare_dir = Path(args.compare_dir) if args.compare_dir else None

    if used_api_key:
        print(f"Using PSI API key from environment variable: {args.api_key_env}")
    else:
        print(
            f"WARNING: {args.api_key_env} is not set. Running on anonymous PSI quota, which may be rate-limited.",
            file=sys.stderr,
        )

    route_summaries: list[dict[str, Any]] = []
    for url in urls:
        summary = collect_route_result(
            url=url,
            out_dir=out_dir,
            strategies=strategies,
            categories=categories,
            locale=args.locale,
            api_key=api_key,
            compare_dir=compare_dir,
            budgets=budgets,
        )
        route_summaries.append(summary)
        route_report = build_route_report(summary, categories, used_api_key, args.api_key_env, compare_dir)
        (out_dir / summary["slug"] / args.report_file).write_text(route_report, encoding="utf-8")

    index_report = build_index_report(route_summaries, categories, used_api_key, args.api_key_env, compare_dir, budgets, out_dir)
    (out_dir / args.index_file).write_text(index_report, encoding="utf-8")

    print(f"Saved PageSpeed Insights artifacts to: {out_dir}")
    print(f"- consolidated report: {out_dir / args.index_file}")
    for route_summary in route_summaries:
        print(f"- route report: {out_dir / route_summary['slug'] / args.report_file}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
