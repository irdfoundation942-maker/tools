#!/usr/bin/env python3

import csv
import subprocess
import sys
import re
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
import yaml


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.yaml"

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_file(str(BASE_DIR / "dashboard.html"))


def load_config():
    if not CONFIG_PATH.exists():
        return {}
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _nested_get(data, path, default=None):
    node = data
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def _as_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return bool(value)


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_mode(value):
    mode = str(value or "query_wise").strip().lower()
    return mode if mode in {"query_wise", "page_wise"} else "query_wise"


def _build_final_input_csv(config_data):
    output_cfg = config_data.get("output", {})
    sorting_cfg = config_data.get("sorting", {})
    date_cfg = config_data.get("date_range", {})

    output_directory = str(output_cfg.get("output_directory") or "output").strip() or "output"
    prefix = str(output_cfg.get("prefix") or "top_kws").strip() or "top_kws"
    extraction_mode = _normalize_mode(config_data.get("extraction_mode"))
    sort_by = str(sorting_cfg.get("sort_by") or "clicks").strip() or "clicks"
    days = _as_int(date_cfg.get("days"), 7)

    return f"{output_directory}/{prefix}_{extraction_mode}_{sort_by}_{days}days.csv"


def _sync_final_format_paths(config_data):
    if not isinstance(config_data, dict):
        return config_data

    final_format = config_data.setdefault("final_format", {})
    if not isinstance(final_format, dict):
        final_format = {}
        config_data["final_format"] = final_format

    final_format["input_csv"] = _build_final_input_csv(config_data)
    return config_data


def _format_config_yaml(config_data):
    credentials_file = _nested_get(
        config_data,
        ["credentials_file"],
        "gsc-dashboard-474505-12ef60690267.json",
    )
    site_url = _nested_get(config_data, ["site_url"], "sc-domain:ihadis.com")
    target_url = _nested_get(config_data, ["target_url"], "https://ihadis.com/countries")

    language_ids = _nested_get(config_data, ["language_ids"], ["bn"])
    if not isinstance(language_ids, list):
        language_ids = [str(language_ids)]
    language_ids = [str(item).strip() for item in language_ids if str(item).strip()]

    extraction_mode = _nested_get(config_data, ["extraction_mode"], "query_wise")

    regex_enabled = _as_bool(_nested_get(config_data, ["query_regex", "enabled"], False))
    regex_patterns = _nested_get(
        config_data,
        ["query_regex", "patterns"],
        "prayer, namaz, salat, magrib, salah, esha, isha, solat",
    )

    sort_by = _nested_get(config_data, ["sorting", "sort_by"], "clicks")
    order = _nested_get(config_data, ["sorting", "order"], "descending")

    days = _as_int(_nested_get(config_data, ["date_range", "days"], 7), 7)
    delay_days = _as_int(_nested_get(config_data, ["date_range", "delay_days"], 0), 0)

    row_limit = _as_int(_nested_get(config_data, ["api", "row_limit"], 25000), 25000)

    range_enabled = _as_bool(_nested_get(config_data, ["range_filter", "enabled"], False))
    start_row = _as_int(_nested_get(config_data, ["range_filter", "start_row"], 1), 1)
    end_row = _as_int(_nested_get(config_data, ["range_filter", "end_row"], 10), 10)

    top_queries_count = _as_int(
        _nested_get(config_data, ["display", "top_queries_count"], 3),
        3,
    )
    pages_per_query = _as_int(
        _nested_get(config_data, ["display", "pages_per_query"], 2),
        2,
    )
    queries_per_page = _as_int(
        _nested_get(config_data, ["display", "queries_per_page"], 5),
        5,
    )

    min_impressions = _nested_get(config_data, ["min_filter", "impressions"], None)
    min_clicks = _nested_get(config_data, ["min_filter", "clicks"], 1)

    output_directory = _nested_get(config_data, ["output", "output_directory"], "output")
    prefix = _nested_get(config_data, ["output", "prefix"], "top_kws")
    include_timestamp = _as_bool(
        _nested_get(config_data, ["output", "include_timestamp"], False)
    )
    separate_by_language = _as_bool(
        _nested_get(config_data, ["output", "separate_by_language"], False)
    )
    csv_delimiter = _nested_get(config_data, ["output", "csv_delimiter"], ",")
    csv_encoding = _nested_get(config_data, ["output", "csv_encoding"], "utf-8")

    input_csv = _nested_get(
        config_data,
        ["final_format", "input_csv"],
        "output/top_kws_query_wise_clicks_7days.csv",
    )
    output_csv = _nested_get(config_data, ["final_format", "output_csv"], "output/Input Data.csv")

    lines = [
        "# Basic configuration and target settings",
        f"credentials_file: {credentials_file}",
        f"site_url: {site_url}",
        f"target_url: {target_url}",
        "language_ids:",
    ]

    if language_ids:
        for lang in language_ids:
            lines.append(f"  - {lang}")
    else:
        lines.append("  - bn")

    min_impressions_text = "null" if min_impressions is None else str(min_impressions)
    min_clicks_text = "null" if min_clicks is None else str(min_clicks)

    lines.extend(
        [
            f"extraction_mode: {extraction_mode}",
            "",
            "# Query keyword matching and filtering settings",
            "query_regex:",
            f"  enabled: {str(regex_enabled).lower()}",
            f"  patterns: {regex_patterns}",
            "",
            "# Data sorting preferences",
            "sorting:",
            f"  sort_by: {sort_by}",
            f"  order: {order}",
            "",
            "# Date range and delay settings",
            "date_range:",
            f"  days: {days}",
            f"  delay_days: {delay_days}",
            "",
            "# API limits and parameters",
            "api:",
            f"  row_limit: {row_limit}",
            "",
            "# Row range limit settings",
            "range_filter:",
            f"  enabled: {str(range_enabled).lower()}",
            f"  start_row: {start_row}",
            f"  end_row: {end_row}",
            "",
            "# Output grouping and display limits",
            "display:",
            f"  top_queries_count: {top_queries_count}",
            f"  pages_per_query: {pages_per_query}",
            f"  queries_per_page: {queries_per_page}",
            "",
            "# Minimum performance thresholds",
            "min_filter:",
            f"  impressions: {min_impressions_text}",
            f"  clicks: {min_clicks_text}",
            "",
            "# Output directory and CSV formatting settings",
            "output:",
            f"  output_directory: {output_directory}",
            f"  prefix: {prefix}",
            f"  include_timestamp: {str(include_timestamp).lower()}",
            f"  separate_by_language: {str(separate_by_language).lower()}",
            f"  csv_delimiter: \"{csv_delimiter}\"",
            f"  csv_encoding: {csv_encoding}",
            "",
            "# Input and output paths for final processing",
            "final_format:",
            f"  input_csv: {input_csv}",
            f"  output_csv: {output_csv}",
            "",
        ]
    )

    return "\n".join(lines)


def save_config(config_data):
    config_data = _sync_final_format_paths(config_data)
    formatted = _format_config_yaml(config_data)
    with CONFIG_PATH.open("w", encoding="utf-8") as handle:
        handle.write(formatted)


def run_python_script(script_name, args=None):
    script_path = BASE_DIR / script_name
    if not script_path.exists():
        return {
            "ok": False,
            "message": f"Script not found: {script_name}",
            "stdout": "",
            "stderr": "",
            "code": -1,
        }

    command = [sys.executable, str(script_path)]
    if args:
        command.extend([str(item) for item in args])

    result = subprocess.run(
        command,
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "ok": result.returncode == 0,
        "message": "ok" if result.returncode == 0 else "failed",
        "stdout": result.stdout,
        "stderr": result.stderr,
        "code": result.returncode,
    }


def resolve_output_path(config_data, requested_path):
    path_value = requested_path or config_data.get("final_format", {}).get("output_csv", "")
    if not path_value:
        return None

    output_path = Path(path_value)
    if not output_path.is_absolute():
        output_path = (BASE_DIR / output_path).resolve()
    return output_path


def resolve_input_path(config_data):
    path_value = config_data.get("final_format", {}).get("input_csv", "")
    if not path_value:
        return None

    input_path = Path(path_value)
    if not input_path.is_absolute():
        input_path = (BASE_DIR / input_path).resolve()
    return input_path


def load_preview_rows(csv_path, row_limit=1000):
    rows = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for index, row in enumerate(reader, start=1):
            if index > row_limit:
                break
            rows.append(
                {
                    "query": (row.get("query") or "").strip(),
                    "page": (row.get("source_page") or row.get("page") or "").strip(),
                    "language": (row.get("language") or "").strip(),
                    "clicks": row.get("clicks", ""),
                    "impressions": row.get("impressions", ""),
                    "ctr": row.get("ctr", ""),
                    "position": row.get("position", ""),
                }
            )
    return rows


def parse_collector_output_path(stdout_text):
    if not stdout_text:
        return None

    match = re.search(r"^Output file\s*:\s*(.+)$", stdout_text, re.MULTILINE)
    if not match:
        return None

    raw_path = match.group(1).strip()
    if not raw_path:
        return None

    output_path = Path(raw_path)
    if not output_path.is_absolute():
        output_path = (BASE_DIR / output_path).resolve()

    return output_path


@app.get("/")
def index():
    return send_from_directory(str(BASE_DIR), "dashboard.html")


@app.get("/api/config")
def api_get_config():
    return jsonify(load_config())


@app.post("/api/config")
def api_save_config():
    config_data = request.get_json(silent=True)
    if not isinstance(config_data, dict):
        return jsonify({"message": "Invalid config payload"}), 400

    save_config(config_data)
    return jsonify({"message": "saved"})


@app.post("/api/run")
def api_run_pipeline():
    payload = request.get_json(silent=True) or {}
    posted_config = payload.get("config")
    if isinstance(posted_config, dict):
        save_config(posted_config)

    collector = run_python_script("gsc_data_collector.py")
    if not collector["ok"]:
        return (
            jsonify(
                {
                    "message": "gsc_data_collector.py failed",
                    "stage": "collector",
                    "details": collector,
                }
            ),
            500,
        )

    generated_input = parse_collector_output_path(collector.get("stdout", ""))
    formatter_args = None
    if generated_input and generated_input.exists():
        try:
            relative_input = generated_input.relative_to(BASE_DIR)
            formatter_args = [str(relative_input).replace("\\", "/")]
        except ValueError:
            formatter_args = [str(generated_input)]

    formatter = run_python_script("final_format.py", formatter_args)
    if not formatter["ok"]:
        return (
            jsonify(
                {
                    "message": "final_format.py failed",
                    "stage": "formatter",
                    "details": formatter,
                }
            ),
            500,
        )

    return jsonify(
        {
            "message": "pipeline completed",
            "collector": collector,
            "formatter": formatter,
        }
    )


@app.get("/api/download-output")
def api_download_output():
    config_data = load_config()
    requested = request.args.get("path", default="", type=str)
    output_path = resolve_output_path(config_data, requested)

    if output_path is None:
        return jsonify({"message": "No output file path configured"}), 400
    if not output_path.exists() or not output_path.is_file():
        return jsonify({"message": f"Output file not found: {output_path}"}), 404

    return send_file(
        str(output_path),
        as_attachment=True,
        download_name=output_path.name,
    )


@app.get("/api/preview")
def api_preview_data():
    config_data = load_config()
    input_path = resolve_input_path(config_data)

    if input_path is None:
        return jsonify({"rows": [], "message": "No preview input path configured"})
    if not input_path.exists() or not input_path.is_file():
        return jsonify({"rows": [], "message": f"Preview file not found: {input_path}"})

    try:
        rows = load_preview_rows(input_path, row_limit=1000)
    except Exception as exc:
        return jsonify({"rows": [], "message": f"Failed to read preview CSV: {exc}"}), 500

    return jsonify(
        {
            "rows": rows,
            "source": str(input_path),
            "count": len(rows),
        }
    )


@app.get("/<path:file_name>")
def static_files(file_name):
    target = BASE_DIR / file_name
    if target.exists() and target.is_file():
        return send_from_directory(str(BASE_DIR), file_name)
    return jsonify({"message": "Not found"}), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
