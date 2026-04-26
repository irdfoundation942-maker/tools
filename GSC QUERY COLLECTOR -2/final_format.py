#!/usr/bin/env python3

import argparse
import csv
import os
import re
from collections import OrderedDict
from urllib.parse import urlparse

import yaml


CONFIG_FILE = "config.yaml"


def normalize_slug(value):
    if not value:
        return ""
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def load_config(config_path=None):
    if config_path:
        path = config_path
    else:
        path = os.path.join(os.path.dirname(__file__), CONFIG_FILE)

    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def resolve_input_path(input_path, config):
    expected_mode = str(config.get("extraction_mode", "query_wise")).strip().lower()

    if input_path:
        selected = input_path
    else:
        configured_input = config.get("final_format", {}).get("input_csv")
        if configured_input:
            selected = configured_input
        else:
            raise ValueError(
                "Input CSV path missing. Pass input_csv argument or set final_format.input_csv in config.yaml."
            )

    if expected_mode in {"query_wise", "page_wise"}:
        expected_fragment = f"_{expected_mode}_"
        if expected_fragment not in os.path.basename(selected):
            raise ValueError(
                f"Mode/input mismatch: extraction_mode='{expected_mode}' requires input file containing '{expected_fragment}' in name. Got: {selected}"
            )

    return selected


def resolve_output_path(input_path, output_path, config):
    if output_path:
        return output_path

    configured_output = config.get("final_format", {}).get("output_csv")
    if configured_output:
        return configured_output

    base, ext = os.path.splitext(input_path)
    ext = ext or ".csv"
    return f"{base}_final_format{ext}"


def pick_first_available(row, candidates):
    for key in candidates:
        value = row.get(key)
        if value is not None:
            return value.strip()
    return ""


def to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def format_number(value):
    return f"{value:.6f}".rstrip("0").rstrip(".") if isinstance(value, float) else value


def resolve_city_csv_path(config):
    city_cfg = config.get("city_mapping", {})
    csv_file = city_cfg.get("csv_file", "all-cities.csv")

    if os.path.isabs(csv_file):
        return csv_file

    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, csv_file)


def load_country_mapping(config):
    csv_path = resolve_city_csv_path(config)
    if not os.path.exists(csv_path):
        return {}

    mapping = {}
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            country = str(row.get("country", "")).strip()
            if not country:
                continue
            slug = normalize_slug(country)
            if slug and slug not in mapping:
                mapping[slug] = country

    return mapping


def extract_country_slug_from_url(page_url):
    if not page_url:
        return ""

    parsed = urlparse(page_url)
    parts = [p for p in parsed.path.split("/") if p]
    if "countries" not in parts:
        return ""

    idx = parts.index("countries")
    if idx + 1 >= len(parts):
        return ""

    return normalize_slug(parts[idx + 1])


def resolve_country(country_value, page_url, country_mapping):
    if country_value:
        return country_value

    slug = extract_country_slug_from_url(page_url)
    if not slug:
        return ""

    return country_mapping.get(slug, slug.replace("-", " "))


def convert_csv(input_path, output_path, config, expected_mode=None):
    grouped = OrderedDict()
    country_mapping = load_country_mapping(config)

    with open(input_path, "r", encoding="utf-8", newline="") as infile:
        reader = csv.DictReader(infile)
        if not reader.fieldnames:
            raise ValueError("Input CSV is empty or missing headers.")

        available_fields = set(reader.fieldnames)
        if "query" not in available_fields:
            raise ValueError("Input CSV must contain a 'query' column.")
        if "source_page" not in available_fields and "page" not in available_fields:
            raise ValueError("Input CSV must contain 'source_page' or 'page' column.")
        if expected_mode and "mode" not in available_fields:
            raise ValueError(
                "Input CSV must contain a 'mode' column for extraction_mode validation."
            )

        for row_number, row in enumerate(reader, start=2):
            row_mode = pick_first_available(row, ["mode"]).lower()
            if expected_mode:
                if row_mode and row_mode != expected_mode:
                    raise ValueError(
                        f"Mode mismatch in input CSV at row {row_number}: expected '{expected_mode}', got '{row_mode}'."
                    )

            language = pick_first_available(row, ["language"])
            item_id = pick_first_available(row, ["id"])
            country = pick_first_available(row, ["country"])
            city = pick_first_available(row, ["city"])
            page = pick_first_available(row, ["source_page", "page"])
            query = pick_first_available(row, ["query"])

            if not page:
                continue

            country = resolve_country(country, page, country_mapping)

            group_key = (language, item_id, country, city, page)
            if group_key not in grouped:
                grouped[group_key] = {
                    "queries": [],
                    "mode": row_mode or expected_mode or "",
                    "clicks": 0.0,
                    "impressions": 0.0,
                    "ctr": 0.0,
                    "position": 0.0,
                    "position_weighted_sum": 0.0,
                    "position_simple_sum": 0.0,
                    "metric_count": 0,
                }

            if row_mode and not grouped[group_key]["mode"]:
                grouped[group_key]["mode"] = row_mode

            if query and query not in grouped[group_key]["queries"]:
                grouped[group_key]["queries"].append(query)

            clicks = to_float(pick_first_available(row, ["clicks"]))
            impressions = to_float(pick_first_available(row, ["impressions"]))
            ctr = to_float(pick_first_available(row, ["ctr"]))
            position = to_float(pick_first_available(row, ["position"]))

            mode_for_group = grouped[group_key]["mode"]
            if mode_for_group == "page_wise":
                # Page-wise rows duplicate same page metrics per query, so keep the best single value.
                grouped[group_key]["clicks"] = max(grouped[group_key]["clicks"], clicks)
                grouped[group_key]["impressions"] = max(grouped[group_key]["impressions"], impressions)
                grouped[group_key]["ctr"] = max(grouped[group_key]["ctr"], ctr)
                if grouped[group_key]["metric_count"] == 0:
                    grouped[group_key]["position"] = position
                grouped[group_key]["metric_count"] += 1
            else:
                grouped[group_key]["clicks"] += clicks
                grouped[group_key]["impressions"] += impressions
                grouped[group_key]["position_simple_sum"] += position
                if impressions > 0:
                    grouped[group_key]["position_weighted_sum"] += position * impressions
                grouped[group_key]["metric_count"] += 1

                if grouped[group_key]["impressions"] > 0:
                    grouped[group_key]["ctr"] = grouped[group_key]["clicks"] / grouped[group_key]["impressions"]
                    grouped[group_key]["position"] = (
                        grouped[group_key]["position_weighted_sum"] / grouped[group_key]["impressions"]
                    )
                elif grouped[group_key]["metric_count"] > 0:
                    grouped[group_key]["ctr"] = ctr
                    grouped[group_key]["position"] = (
                        grouped[group_key]["position_simple_sum"] / grouped[group_key]["metric_count"]
                    )

    with open(output_path, "w", encoding="utf-8", newline="") as outfile:
        writer = csv.writer(outfile)
        writer.writerow(
            [
                "language",
                "id",
                "country",
                "city",
                "page",
                "queries",
                "clicks",
                "impressions",
                "ctr",
                "position",
            ]
        )

        for (language, item_id, country, city, page), grouped_data in grouped.items():
            writer.writerow(
                [
                    language,
                    item_id,
                    country,
                    city,
                    page,
                    ", ".join(grouped_data["queries"]),
                    format_number(grouped_data["clicks"]),
                    format_number(grouped_data["impressions"]),
                    format_number(grouped_data["ctr"]),
                    format_number(grouped_data["position"]),
                ]
            )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Group same page queries into one comma-separated cell."
    )
    parser.add_argument(
        "input_csv",
        nargs="?",
        default=None,
        help="Path to input CSV file (optional if set in config.yaml)",
    )
    parser.add_argument(
        "-o",
        "--output",
        dest="output_csv",
        default=None,
        help="Path to output CSV file (optional)",
    )
    parser.add_argument(
        "-c",
        "--config",
        dest="config_path",
        default=None,
        help="Path to config YAML file (optional)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    config = load_config(args.config_path)
    input_csv = resolve_input_path(args.input_csv, config)
    output_csv = resolve_output_path(input_csv, args.output_csv, config)
    expected_mode = str(config.get("extraction_mode", "")).strip().lower()
    if expected_mode not in {"query_wise", "page_wise"}:
        expected_mode = None
    convert_csv(input_csv, output_csv, config, expected_mode=expected_mode)
    print(f"Done. Output written to: {output_csv}")


if __name__ == "__main__":
    main()
