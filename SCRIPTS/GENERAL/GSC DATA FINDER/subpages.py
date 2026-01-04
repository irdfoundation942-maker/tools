import pandas as pd
from gsc_connector import GoogleSearchConsoleConnector
from datetime import datetime, timedelta
import os


JSON_FILENAME = 'gsc-dashboard-474505-12ef60690267.json'

POSSIBLE_PATHS = [
    os.path.join(os.getcwd(), JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Downloads', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Downloads\TOP QUERIES', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Downloads\PROJECT-WISE\GSC DATA FINDER', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Desktop', JSON_FILENAME),
]

SERVICE_ACCOUNT_FILE = None

PROPERTY_URI = 'sc-domain:quranmazid.com'
OUTPUT_EXCEL = 'top_subpages_output.xlsx'

# INPUT URL - এই URL এর sub-pages দেখাবে
INPUT_URL = 'https://quranmazid.com/countries'

# Minimum filter
MIN_CLICKS = 0
MIN_IMPRESSIONS = 0

# Date settings
DATE_MODE = "last_days"  # "last_days" or "custom"
LAST_N_DAYS = 90

CUSTOM_START_DATE = '2024-12-01'
CUSTOM_END_DATE = '2025-12-31'


def find_json_file():
    print("Looking for JSON file...\n")
    for path in POSSIBLE_PATHS:
        if os.path.exists(path):
            print(f"Found: {path}\n")
            return path
    print("JSON file not found!")
    return None


def get_top_subpages(output_excel_path):
    global SERVICE_ACCOUNT_FILE
    
    if SERVICE_ACCOUNT_FILE is None:
        SERVICE_ACCOUNT_FILE = find_json_file()
        if SERVICE_ACCOUNT_FILE is None:
            return

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"Error: File not found - {SERVICE_ACCOUNT_FILE}")
        return

    # Connect to GSC
    try:
        gsc = GoogleSearchConsoleConnector(SERVICE_ACCOUNT_FILE, PROPERTY_URI)
        print("Connected to Google Search Console")
    except Exception as e:
        print(f"Error connecting to GSC: {e}")
        return

    # Set date range
    if DATE_MODE == "last_days":
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=LAST_N_DAYS)
        print(f"\nDate Mode: Last {LAST_N_DAYS} days")
    else:
        start_date = datetime.strptime(CUSTOM_START_DATE, '%Y-%m-%d').date()
        end_date = datetime.strptime(CUSTOM_END_DATE, '%Y-%m-%d').date()
        print(f"\nDate Mode: Custom Range")

    print(f"Date range: {start_date} to {end_date}")
    print(f"\nInput URL: {INPUT_URL}")

    try:
        # Fetch page data from GSC
        print("\nFetching page data from GSC...")
        
        df_data = gsc.query(
            start_date=str(start_date),
            end_date=str(end_date),
            dimensions=['page'],
            row_limit=25000,
            search_type='web'
        )

        if df_data.empty:
            print("No data found")
            return

        df_data.columns = ['Page', 'Clicks', 'Impressions', 'CTR', 'Position']
        print(f"Total pages fetched: {len(df_data)}")

        # Filter pages that start with INPUT_URL
        url_prefix = INPUT_URL.rstrip('/')
        
        df_filtered = df_data[df_data['Page'].str.startswith(url_prefix)]
        
        # Exclude the exact URL (only sub-pages)
        df_filtered = df_filtered[df_filtered['Page'] != url_prefix]
        df_filtered = df_filtered[df_filtered['Page'] != url_prefix + '/']
        
        print(f"\nSub-pages found under '{url_prefix}': {len(df_filtered)}")

        if df_filtered.empty:
            print("No sub-pages found for this URL!")
            return

        # Apply min filters
        if MIN_CLICKS > 0:
            df_filtered = df_filtered[df_filtered['Clicks'] >= MIN_CLICKS]
            print(f"After min clicks filter ({MIN_CLICKS}): {len(df_filtered)} pages")
        if MIN_IMPRESSIONS > 0:
            df_filtered = df_filtered[df_filtered['Impressions'] >= MIN_IMPRESSIONS]
            print(f"After min impressions filter ({MIN_IMPRESSIONS}): {len(df_filtered)} pages")

        if df_filtered.empty:
            print("No pages match your filter criteria!")
            return

        # Sort by clicks descending
        df_result = df_filtered.sort_values('Clicks', ascending=False).reset_index(drop=True)
        
        # Add rank column
        df_result.insert(0, 'Rank', range(1, len(df_result) + 1))

        # Save to Excel
        df_result.to_excel(output_excel_path, index=False, engine='openpyxl')

        # Summary
        total_pages = len(df_result)
        total_clicks = df_result['Clicks'].sum()
        total_impressions = df_result['Impressions'].sum()

        print(f"\n{'='*60}")
        print("SUCCESS!")
        print(f"{'='*60}")
        print(f"File: {output_excel_path}")
        print(f"Total sub-pages: {total_pages}")
        print(f"Total clicks: {total_clicks:,}")
        print(f"Total impressions: {total_impressions:,}")
        print(f"{'='*60}")

        # Show top 10 pages
        print("\nTop 10 Sub-pages:")
        for i, row in df_result.head(10).iterrows():
            print(f"  {row['Rank']}. {row['Page']}")
            print(f"     Clicks: {row['Clicks']:,} | Impressions: {row['Impressions']:,}")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("=" * 60)
    print("Top Sub-Pages Finder")
    print("=" * 60)
    print()
    
    get_top_subpages(OUTPUT_EXCEL)
    
    print("\nProcess completed!")
