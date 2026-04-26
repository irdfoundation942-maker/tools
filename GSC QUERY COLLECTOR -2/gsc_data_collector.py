#!/usr/bin/env python3

import csv
import os
import re
import sys
from datetime import datetime, timedelta
from urllib.parse import urlparse

import yaml
from google.oauth2 import service_account
from googleapiclient.discovery import build

CONFIG_FILE = "config.yaml"


def configure_stdio():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def load_config(config_path=None):
    if config_path is None:
        config_path = os.path.join(os.path.dirname(__file__), CONFIG_FILE)
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_gsc_service(config):
    credentials = service_account.Credentials.from_service_account_file(
        config["credentials_file"],
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )
    return build("searchconsole", "v1", credentials=credentials)


def get_date_range(config):
    delay_days = config["date_range"].get("delay_days", 0)
    days = config["date_range"]["days"]
    end_date = datetime.now() - timedelta(days=delay_days)
    start_date = end_date - timedelta(days=days)
    return start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d")


def build_url_for_language(target_url, lang_id):
    if not lang_id or lang_id == "bn":
        return target_url
    parsed = urlparse(target_url)
    new_path = f"/{lang_id}{parsed.path}"
    return parsed._replace(path=new_path).geturl()


def build_regex_pattern(config):
    regex_cfg = config.get("query_regex", {})
    if not regex_cfg or not regex_cfg.get("enabled", False):
        return None

    raw = regex_cfg.get("patterns", "")
    if not raw:
        return None

    if isinstance(raw, list):
        pattern_str = "|".join(re.escape(kw.strip()) for kw in raw if kw.strip())
    else:
        raw = raw.strip()
        if "," in raw:
            pattern_str = "|".join(
                re.escape(kw.strip()) for kw in raw.split(",") if kw.strip()
            )
        else:
            pattern_str = raw

    if not pattern_str:
        return None

    try:
        return re.compile(pattern_str, re.IGNORECASE)
    except re.error as exc:
        print(f"[WARNING] Invalid regex pattern '{pattern_str}': {exc}. Filter skipped.")
        return None


def normalize_slug(value):
    if not value:
        return ""
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def load_city_mapping(config):
    city_cfg = config.get("city_mapping", {})
    csv_file = city_cfg.get("csv_file", "all-cities.csv")

    if os.path.isabs(csv_file):
        csv_path = csv_file
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        csv_path = os.path.join(base_dir, csv_file)

    if not os.path.exists(csv_path):
        print(f"[WARNING] City mapping file not found: {csv_path}")
        return {"by_country_city": {}, "by_city": {}}

    by_country_city = {}
    by_city = {}
    by_country = {}

    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            city_id = str(row.get("id", "")).strip()
            country = str(row.get("country", "")).strip()
            city = str(row.get("city", "")).strip()
            if not city:
                continue

            country_slug = normalize_slug(country)
            city_slug = normalize_slug(city)
            payload = {"id": city_id, "country": country, "city": city}

            by_country_city[(country_slug, city_slug)] = payload
            by_city.setdefault(city_slug, []).append(payload)
            if country_slug and country_slug not in by_country:
                by_country[country_slug] = country

    return {
        "by_country_city": by_country_city,
        "by_city": by_city,
        "by_country": by_country,
    }


def extract_country_city_from_url(page_url):
    if not page_url:
        return "", ""

    parsed = urlparse(page_url)
    parts = [p for p in parsed.path.split("/") if p]

    country_slug = ""
    city_slug = ""

    if "countries" in parts:
        idx = parts.index("countries")
        if idx + 1 < len(parts):
            country_slug = normalize_slug(parts[idx + 1])

    for part in parts:
        if part.startswith("prayer-times-"):
            city_slug = normalize_slug(part.replace("prayer-times-", "", 1))
            break

    return country_slug, city_slug


def resolve_city_details(page_url, city_mapping):
    country_slug, city_slug = extract_country_city_from_url(page_url)
    by_country = city_mapping.get("by_country", {})
    resolved_country = by_country.get(country_slug, country_slug.replace("-", " ")) if country_slug else ""

    if not city_slug:
        return {"id": "", "country": resolved_country, "city": ""}

    by_country_city = city_mapping.get("by_country_city", {})
    by_city = city_mapping.get("by_city", {})

    matched = by_country_city.get((country_slug, city_slug))
    if matched:
        return matched

    fallback = by_city.get(city_slug, [])
    if len(fallback) == 1:
        return fallback[0]

    return {"id": "", "country": resolved_country, "city": ""}


def apply_regex_filter(queries, pattern):
    if pattern is None:
        return queries
    return [q for q in queries if pattern.search(q["query"])]


def get_language_ids(config):
    raw = config.get("language_ids")

    if raw is None:
        return ["bn"]

    if not isinstance(raw, list):
        raw = [raw]

    language_ids = [str(item).strip() for item in raw if str(item).strip()]
    return language_ids or ["bn"]


def get_extraction_mode(config):
    mode = str(config.get("extraction_mode", "query_wise")).strip().lower()
    return mode if mode in {"query_wise", "page_wise"} else "query_wise"


def _get_mode_block(raw_block, mode):
    if not isinstance(raw_block, dict):
        return {}

    mode_block = raw_block.get(mode)
    if isinstance(mode_block, dict):
        return mode_block
    return {}


def get_mode_sorting(config):
    mode = get_extraction_mode(config)
    sorting_cfg = config.get("sorting") or {}
    mode_sorting = _get_mode_block(sorting_cfg, mode)

    sort_by = str(mode_sorting.get("sort_by", sorting_cfg.get("sort_by", "clicks"))).strip() or "clicks"
    order = str(mode_sorting.get("order", sorting_cfg.get("order", "descending"))).strip().lower() or "descending"
    if order not in {"ascending", "descending"}:
        order = "descending"

    return sort_by, order


def get_mode_min_filter(config):
    mode = get_extraction_mode(config)
    min_cfg = config.get("min_filter") or {}
    mode_min_cfg = _get_mode_block(min_cfg, mode)

    min_impressions = mode_min_cfg.get("impressions", min_cfg.get("impressions"))
    min_clicks = mode_min_cfg.get("clicks", min_cfg.get("clicks"))
    return min_impressions, min_clicks


def ensure_output_directory(config):
    directory = config.get("output", {}).get("output_directory", ".")
    if directory and directory != ".":
        os.makedirs(directory, exist_ok=True)
    return directory


def _sort_rows(rows, sort_by, order):
    reverse = order == "descending"
    if sort_by == "position":
        reverse = not reverse
    rows.sort(key=lambda x: x[sort_by], reverse=reverse)


def get_top_queries_for_url(service, config, url_filter, start_date, end_date):
    site_url = config["site_url"]
    row_limit = config["api"]["row_limit"]
    sort_by, order = get_mode_sorting(config)

    response = (
        service.searchanalytics()
        .query(
            siteUrl=site_url,
            body={
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": ["query"],
                "rowLimit": row_limit,
                "dimensionFilterGroups": [
                    {
                        "filters": [
                            {
                                "dimension": "page",
                                "operator": "contains",
                                "expression": url_filter,
                            }
                        ]
                    }
                ],
            },
        )
        .execute()
    )

    queries = []
    for row in response.get("rows", []):
        queries.append(
            {
                "query": row["keys"][0],
                "clicks": row["clicks"],
                "impressions": row["impressions"],
                "ctr": row["ctr"],
                "position": row["position"],
            }
        )

    _sort_rows(queries, sort_by, order)
    min_impressions, min_clicks = get_mode_min_filter(config)
    queries = apply_min_filter(
        queries,
        min_impressions=min_impressions,
        min_clicks=min_clicks,
    )
    return queries


def get_pages_for_query(service, config, query_text, url_filter, start_date, end_date):
    site_url = config["site_url"]
    row_limit = config["api"]["row_limit"]
    sort_by, order = get_mode_sorting(config)
    pages_per_query = config["display"].get("pages_per_query", 0)

    response = (
        service.searchanalytics()
        .query(
            siteUrl=site_url,
            body={
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": ["page"],
                "rowLimit": row_limit,
                "dimensionFilterGroups": [
                    {
                        "filters": [
                            {
                                "dimension": "query",
                                "operator": "equals",
                                "expression": query_text,
                            },
                            {
                                "dimension": "page",
                                "operator": "contains",
                                "expression": url_filter,
                            },
                        ]
                    }
                ],
            },
        )
        .execute()
    )

    pages = []
    for row in response.get("rows", []):
        pages.append(
            {
                "page": row["keys"][0],
                "clicks": row["clicks"],
                "impressions": row["impressions"],
                "ctr": row["ctr"],
                "position": row["position"],
            }
        )

    _sort_rows(pages, sort_by, order)

    range_filter = config.get("range_filter", {})
    if range_filter.get("enabled", False):
        start_row = range_filter.get("start_row", 1)
        end_row = range_filter.get("end_row")
        start_idx = max(0, start_row - 1)
        end_idx = end_row if end_row else len(pages)
        pages = pages[start_idx:end_idx]
    elif pages_per_query > 0:
        pages = pages[:pages_per_query]

    return pages


def get_output_directory(config):
    output_cfg = config.get("output", {})
    configured = output_cfg.get("output_directory", ".")
    if os.path.isabs(configured):
        directory = configured
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        directory = os.path.join(base_dir, configured)
    os.makedirs(directory, exist_ok=True)
    return directory


def sort_rows(rows, sort_by, order):
    reverse = order == "descending"
    if sort_by == "position":
        reverse = not reverse
    rows.sort(key=lambda x: x[sort_by], reverse=reverse)


def apply_min_filter(rows, min_impressions=None, min_clicks=None):
    filtered = rows
    if min_impressions is not None:
        filtered = [r for r in filtered if r["impressions"] >= min_impressions]
    if min_clicks is not None:
        filtered = [r for r in filtered if r["clicks"] >= min_clicks]
    return filtered


def get_top_pages_for_url(service, config, url_filter, start_date, end_date):
    site_url = config["site_url"]
    row_limit = config["api"]["row_limit"]
    sort_by, order = get_mode_sorting(config)
    pages_limit = config["display"].get("pages_per_query", 0)

    response = (
        service.searchanalytics()
        .query(
            siteUrl=site_url,
            body={
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": ["page"],
                "rowLimit": row_limit,
                "dimensionFilterGroups": [
                    {
                        "filters": [
                            {
                                "dimension": "page",
                                "operator": "contains",
                                "expression": url_filter,
                            }
                        ]
                    }
                ],
            },
        )
        .execute()
    )

    pages = []
    for row in response.get("rows", []):
        pages.append(
            {
                "page": row["keys"][0],
                "clicks": row["clicks"],
                "impressions": row["impressions"],
                "ctr": row["ctr"],
                "position": row["position"],
            }
        )

    sort_rows(pages, sort_by, order)
    min_impressions, min_clicks = get_mode_min_filter(config)
    pages = apply_min_filter(
        pages,
        min_impressions=min_impressions,
        min_clicks=min_clicks,
    )

    if pages_limit > 0:
        pages = pages[:pages_limit]

    return pages


def get_queries_for_page(service, config, page_url, start_date, end_date):
    site_url = config["site_url"]
    row_limit = config["api"]["row_limit"]
    sort_by, order = get_mode_sorting(config)
    query_limit = config["display"].get(
        "queries_per_page", config["display"].get("top_queries_count", 0)
    )

    response = (
        service.searchanalytics()
        .query(
            siteUrl=site_url,
            body={
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": ["query"],
                "rowLimit": row_limit,
                "dimensionFilterGroups": [
                    {
                        "filters": [
                            {
                                "dimension": "page",
                                "operator": "equals",
                                "expression": page_url,
                            }
                        ]
                    }
                ],
            },
        )
        .execute()
    )

    queries = []
    for row in response.get("rows", []):
        queries.append(
            {
                "query": row["keys"][0],
                "clicks": row["clicks"],
                "impressions": row["impressions"],
                "ctr": row["ctr"],
                "position": row["position"],
            }
        )

    sort_rows(queries, sort_by, order)

    if query_limit > 0:
        queries = queries[:query_limit]

    return queries


def save_output(rows, config, mode, city_mapping):
    output_cfg = config.get("output", {})
    directory = get_output_directory(config)
    prefix = output_cfg.get("prefix", "top_kws")
    delimiter = output_cfg.get("csv_delimiter", ",")
    encoding = output_cfg.get("csv_encoding", "utf-8")
    include_ts = output_cfg.get("include_timestamp", True)
    days = config.get("date_range", {}).get("days", 7)
    sort_by, _ = get_mode_sorting(config)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S") if include_ts else ""
    parts = [prefix, mode, sort_by, f"{days}days"]
    if ts:
        parts.append(ts)
    filename = "_".join(parts) + ".csv"
    path = os.path.join(directory, filename)

    headers = [
        "mode",
        "language",
        "id",
        "country",
        "city",
        "source_query",
        "source_page",
        "query",
        "clicks",
        "impressions",
        "ctr",
        "position",
    ]

    with open(path, "w", encoding=encoding, newline="") as f:
        writer = csv.writer(f, delimiter=delimiter)
        writer.writerow(headers)
        for row in rows:
            city_details = resolve_city_details(row.get("source_page", ""), city_mapping)
            writer.writerow(
                [
                    row["mode"],
                    row["language"],
                    city_details["id"],
                    city_details["country"],
                    city_details["city"],
                    row["source_query"],
                    row["source_page"],
                    row["query"],
                    row["clicks"],
                    row["impressions"],
                    row["ctr"],
                    row["position"],
                ]
            )

    return path


def collect_query_wise(service, config, start_date, end_date, regex_pattern):
    target_url = config["target_url"]
    language_ids = get_language_ids(config)
    top_queries_count = config["display"].get("top_queries_count", 0)

    rows = []
    for lang_id in language_ids:
        lang_label = lang_id if lang_id else "bn"
        url_filter = build_url_for_language(target_url, lang_id)
        print(f"[{lang_label}] Collecting seed queries from: {url_filter}")

        seed_queries = get_top_queries_for_url(
            service, config, url_filter, start_date, end_date
        )
        seed_queries = apply_regex_filter(seed_queries, regex_pattern)
        if top_queries_count > 0:
            seed_queries = seed_queries[:top_queries_count]
        print(f"[{lang_label}]   -> Seed queries: {len(seed_queries)}")

        for seed in seed_queries:
            pages = get_pages_for_query(
                service, config, seed["query"], url_filter, start_date, end_date
            )
            print(
                f"[{lang_label}]   -> Pages for '{seed['query']}': {len(pages)}"
            )

            for page in pages:
                page_queries = get_queries_for_page(
                    service, config, page["page"], start_date, end_date
                )
                page_queries = apply_regex_filter(page_queries, regex_pattern)

                for q in page_queries:
                    rows.append(
                        {
                            "mode": "query_wise",
                            "language": lang_label,
                            "source_query": seed["query"],
                            "source_page": page["page"],
                            "query": q["query"],
                            "clicks": seed["clicks"],
                            "impressions": seed["impressions"],
                            "ctr": seed["ctr"],
                            "position": seed["position"],
                        }
                    )

    return rows


def collect_page_wise(service, config, start_date, end_date, regex_pattern):
    target_url = config["target_url"]
    language_ids = get_language_ids(config)

    rows = []
    for lang_id in language_ids:
        lang_label = lang_id if lang_id else "bn"
        url_filter = build_url_for_language(target_url, lang_id)
        print(f"[{lang_label}] Collecting pages from: {url_filter}")

        pages = get_top_pages_for_url(service, config, url_filter, start_date, end_date)
        print(f"[{lang_label}]   -> Pages selected: {len(pages)}")

        for page in pages:
            page_queries = get_queries_for_page(
                service,
                config,
                page["page"],
                start_date,
                end_date,
            )
            page_queries = apply_regex_filter(page_queries, regex_pattern)
            print(
                f"[{lang_label}]   -> Queries for '{page['page']}': {len(page_queries)}"
            )

            for q in page_queries:
                rows.append(
                    {
                        "mode": "page_wise",
                        "language": lang_label,
                        "source_query": "",
                        "source_page": page["page"],
                        "query": q["query"],
                        "clicks": page["clicks"],
                        "impressions": page["impressions"],
                        "ctr": page["ctr"],
                        "position": page["position"],
                    }
                )

    return rows


def main():
    configure_stdio()
    config = load_config(CONFIG_FILE)
    ensure_output_directory(config)
    get_output_directory(config)

    extraction_mode = str(config.get("extraction_mode", "query_wise")).strip().lower()
    if extraction_mode not in {"query_wise", "page_wise"}:
        raise ValueError(
            "Invalid extraction_mode. Use one of: query_wise, page_wise"
        )

    service = get_gsc_service(config)
    start_date, end_date = get_date_range(config)
    regex_pattern = build_regex_pattern(config)
    city_mapping = load_city_mapping(config)
    sort_by, order = get_mode_sorting(config)

    print("=" * 60)
    print("Flexible GSC Collector")
    print("=" * 60)
    print(f"Mode           : {extraction_mode}")
    print(f"Date range     : {start_date} -> {end_date}")
    print(f"Sort           : {sort_by} ({order})")
    print(f"Top queries    : {config['display'].get('top_queries_count', 0) or 'all'}")
    print(f"Pages/query    : {config['display'].get('pages_per_query', 0) or 'all'}")
    print(f"Queries/page   : {config['display'].get('queries_per_page', config['display'].get('top_queries_count', 0)) or 'all'}")
    print()

    if extraction_mode == "query_wise":
        rows = collect_query_wise(service, config, start_date, end_date, regex_pattern)
    else:
        rows = collect_page_wise(service, config, start_date, end_date, regex_pattern)

    output_path = save_output(rows, config, extraction_mode, city_mapping)

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Rows collected : {len(rows)}")
    print(f"Output file    : {output_path}")


if __name__ == "__main__":
    main()
