import pandas as pd
from gsc_connector import GoogleSearchConsoleConnector
from datetime import datetime, timedelta
import os


JSON_FILENAME = 'gsc-dashboard-474505-12ef60690267.json'

# 🔍 Automatic path detection - এই সব জায়গায় খুঁজবে
POSSIBLE_PATHS = [
    os.path.join(os.getcwd(), JSON_FILENAME),  # বর্তমান folder
    os.path.join(r'C:\Users\seo1i\Downloads', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Downloads\TOP QUERIES', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Downloads\PROJECT-WISE\GSC DATA FINDER', JSON_FILENAME),
    os.path.join(r'C:\Users\seo1i\Desktop', JSON_FILENAME),
]

SERVICE_ACCOUNT_FILE = None  # Auto-detect করবে

PROPERTY_URI = 'sc-domain:ihadis.com'
OUTPUT_EXCEL = 'all_pages_output.xlsx'

# 🎯 Range Configuration
FETCH_MODE = "range"  # "all" or "range"
START_POSITION = 1
END_POSITION = 25000

MIN_CLICKS = 0         
MIN_IMPRESSIONS = 1    
DATE_MODE = "last_days"  # "last_days" অথবা "custom"

LAST_N_DAYS = 90

# FORMAT: 'YYYY-MM-DD'
CUSTOM_START_DATE = '2024-12-01'
CUSTOM_END_DATE = '2024-12-31'

# --- End Configuration ---

def find_json_file():
    """
    JSON file automatically খুঁজে বের করবে
    """
    print("🔍 Searching for JSON file...\n")

    for path in POSSIBLE_PATHS:
        if os.path.exists(path):
            print(f"✅ Found: {path}\n")
            return path

    print("\n⚠️ JSON file not found in any expected location!")
    print("\n💡 Solutions:")
    print("1. Copy the JSON file to your current directory:")
    print(f"   {os.getcwd()}")
    print("\n2. Or update SERVICE_ACCOUNT_FILE with correct path")
    return None

def get_pages_with_range(output_excel_path):
    """
    Range সহ pages নিয়ে আসবে
    """

    # Find JSON file
    global SERVICE_ACCOUNT_FILE
    if SERVICE_ACCOUNT_FILE is None:
        SERVICE_ACCOUNT_FILE = find_json_file()
        if SERVICE_ACCOUNT_FILE is None:
            return

    # Verify file exists
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"\n❌ Error: File not found!")
        print(f"Expected: {SERVICE_ACCOUNT_FILE}")
        return

    # Initialize GSC connector
    try:
        gsc = GoogleSearchConsoleConnector(SERVICE_ACCOUNT_FILE, PROPERTY_URI)
        print(f"✅ Connected to Google Search Console")
    except Exception as e:
        print(f"❌ Error connecting to GSC: {e}")
        return

    # 📅 Set date range based on mode
    if DATE_MODE == "last_days":
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=LAST_N_DAYS)
        print(f"\n📅 Date Mode: Last {LAST_N_DAYS} days")
    else:  # custom
        start_date = datetime.strptime(CUSTOM_START_DATE, '%Y-%m-%d').date()
        end_date = datetime.strptime(CUSTOM_END_DATE, '%Y-%m-%d').date()
        print(f"\n📅 Date Mode: Custom Range")

    print(f"📅 Date range: {start_date} to {end_date}")

    # Calculate number of days
    days_diff = (end_date - start_date).days
    print(f"📊 Total days: {days_diff + 1}")

    # Show filter settings
    print(f"\n🎯 Filter Settings:")
    print(f"   Min Clicks: {MIN_CLICKS}")
    print(f"   Min Impressions: {MIN_IMPRESSIONS}")

    # Calculate range
    if FETCH_MODE == "range":
        print(f"\n🔢 Page Range: Position {START_POSITION} to {END_POSITION}")
        row_start = START_POSITION - 1  # Convert to 0-indexed
        row_end = END_POSITION
        fetch_limit = END_POSITION
    else:
        print(f"\n🔢 Mode: All pages")
        row_start = 0
        row_end = 25000
        fetch_limit = 25000

    try:
        # Fetch data - শুধু page dimension
        print(f"⏳ Fetching data from GSC...")

        df_pages = gsc.query(
            start_date=str(start_date),
            end_date=str(end_date),
            dimensions=['page'],  # ✅ শুধু page/URL
            row_limit=fetch_limit,
            search_type='web'
        )

        if df_pages.empty:
            print(f"⚠️ No data found")
            return

        # Sort by clicks (descending)
        df_pages = df_pages.sort_values('clicks', ascending=False).reset_index(drop=True)

        print(f"📊 Total pages available (before filter): {len(df_pages)}")

        # ✅ Apply minimum clicks/impressions filter
        if MIN_CLICKS > 0:
            df_pages = df_pages[df_pages['clicks'] >= MIN_CLICKS]
            print(f"🔸 After min clicks filter ({MIN_CLICKS}): {len(df_pages)} pages")

        if MIN_IMPRESSIONS > 0:
            df_pages = df_pages[df_pages['impressions'] >= MIN_IMPRESSIONS]
            print(f"🔸 After min impressions filter ({MIN_IMPRESSIONS}): {len(df_pages)} pages")

        if df_pages.empty:
            print(f"⚠️ No pages match your filter criteria!")
            return

        # Reset index after filtering
        df_pages = df_pages.reset_index(drop=True)

        # Apply range filter
        if FETCH_MODE == "range":
            if row_start >= len(df_pages):
                print(f"⚠️ START_POSITION ({START_POSITION}) exceeds available data ({len(df_pages)} pages)")
                return
            df_pages = df_pages.iloc[row_start:row_end]
            print(f"✅ Filtered to range: {len(df_pages)} pages (#{START_POSITION} to #{START_POSITION + len(df_pages) - 1})")

        # Format columns
        df_pages.columns = ['Page URL', 'Clicks', 'Impressions', 'CTR', 'Position']
        df_pages = df_pages[['Page URL', 'Clicks', 'Impressions', 'CTR', 'Position']]

        # Add rank column
        if FETCH_MODE == "range":
            df_pages.insert(0, 'Rank', range(START_POSITION, START_POSITION + len(df_pages)))
        else:
            df_pages.insert(0, 'Rank', range(1, len(df_pages) + 1))

        # Save to Excel
        df_pages.to_excel(output_excel_path, index=False, engine='openpyxl')

        print(f"\n✅ SUCCESS!")
        print(f"📁 File: {output_excel_path}")
        print(f"📊 Total rows: {len(df_pages)}")
        print(f"📈 Total clicks: {df_pages['Clicks'].sum():,}")
        print(f"👁️ Total impressions: {df_pages['Impressions'].sum():,}")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    print("=" * 60)
    print("Google Search Console - Page Exporter")
    print("=" * 60)
    print()

    get_pages_with_range(OUTPUT_EXCEL)

    print("\n" + "=" * 60)
    print("✅ Process completed!")
    print("=" * 60)
