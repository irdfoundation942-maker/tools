# GSC Query Collector

এই project টি Google Search Console থেকে page এবং query data collect করার জন্য তৈরি করা হয়েছে।

## Prerequisites

- Python 3.7 বা তার পরের version
- Google Search Console এর access
- Service Account credentials file

## Installation Steps

### Step 1: Virtual Environment তৈরি করুন

```bash
python -m venv venv
```

### Step 2: Virtual Environment activate করুন

Windows এ:

```bash
venv\Scripts\activate
```

### Step 3: Dependencies install করুন

```bash
pip install -r requirements.txt
```

## Configuration

### Step 1: Credentials File সেটআপ করুন

আপনার Google Service Account JSON credentials file টি project folder এ রাখুন।

### Step 2: `config.yaml` file edit করুন

নিচের settings গুলো আপনার প্রয়োজন অনুযায়ী পরিবর্তন করুন:

- **credentials_file**: আপনার JSON credentials file এর নাম
- **site_url**: আপনার website এর URL (উদাহরণ: `sc-domain:example.com`)
- **page_filter**: যে page থেকে data collect করতে চান (উদাহরণ: `https://example.com/page`)
- **language_ids**: যে language গুলো collect করতে চান (উদাহরণ: `["bn", "en"]`)
- **date_range.days**: কত দিনের data চান
- **pages_to_collect**: কয়টি page collect করবেন
- **queries_per_page**: প্রতি page এ কয়টি query collect করবেন

## Usage

### HTML Dashboard

Open `dashboard.html` in a browser to edit the config, copy the two script commands, and download an updated `config.yaml` without leaving the UI.

For one-click run and output download from top bar, start the dashboard server:

```bash
python dashboard_server.py
```

Then open:

```text
http://127.0.0.1:5000
```

Workflow:

1. Edit the form values in the dashboard.
2. Download the generated `config.yaml` if you want to keep the changes.
3. Run `python gsc_data_collector.py`.
4. Run `python final_format.py` to get the final output CSV.

### Pages Data Collect করতে:

```bash
python gsc_pages_collector.py
```

এটি configured output directory তে pages data সহ CSV file তৈরি করবে।

### Queries Data Collect করতে:

```bash
python gsc_query_collector.py
```

এটি প্রতি page এর জন্য query data সংগ্রহ করে CSV file এ save করবে।

## Output

সমস্ত output files `config.yaml` এ define করা **output_directory** তে save হবে।

Default output directory: `Prayer time/`

Generated files:

- `pages_data_bn.csv` - Bengali language pages data
- `pages_data_en.csv` - English language pages data
- `gsc_queries_*.csv` - Query data files

## Important Settings

### Date Range

`date_range.days`: কত দিনের data collect করবেন (default: 7)

### Sorting

`sorting.sort_by`: কোন metric দিয়ে sort করবেন

- `clicks`
- `impressions`
- `ctr`
- `position`

### Range Filter

`range_filter.enabled`: true করলে নির্দিষ্ট row range থেকে data collect করবে

## Troubleshooting

- **Authentication Error**: Credentials file path ঠিক আছে কিনা check করুন
- **No Data Found**: Date range এবং page filter সঠিক আছে কিনা verify করুন
- **API Limit Error**: `api.row_limit` কমিয়ে দিন অথবা কিছুক্ষণ অপেক্ষা করুন

## Notes

- GSC data সাধারণত 2-3 দিন পুরনো হয়
- Maximum 25,000 rows প্রতি request এ collect করা যায়
- Large dataset এর জন্য range filter ব্যবহার করুন
