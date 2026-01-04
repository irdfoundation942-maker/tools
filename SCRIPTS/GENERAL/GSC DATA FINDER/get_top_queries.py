import pandas as pd
from gsc_connector import GoogleSearchConsoleConnector
from datetime import datetime, timedelta
import os

# --- Configuration ---
SERVICE_ACCOUNT_FILE = r'D:\SHAKIL\0. SEO-TEAM GIT\SCRIPTS\GENERAL\GSC DATA FINDER\gsc-dashboard-474505-12ef60690267.json'
PROPERTY_URI = 'sc-domain:duaruqyah.com'
INPUT_CSV = 'input.csv'  # CSV file with 'URL' column
OUTPUT_EXCEL = 'top_queries_output.xlsx'
TOP_N_QUERIES = 20  # Number of top queries to fetch per URL
# --- End Configuration ---

def get_top_queries_for_urls(input_csv_path, output_excel_path):

    # Check if input file exists
    if not os.path.exists(input_csv_path):
        print(f"❌ Error: {input_csv_path} not found!")
        print(f"Please create an input.csv file with a 'URL' column containing your URLs.")
        return
    
    # Read input CSV
    try:
        df_input = pd.read_csv(input_csv_path)
        print(f"✅ Successfully read {input_csv_path}")
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return
    
    # Check if URL column exists
    if 'URL' not in df_input.columns:
        print(f"❌ Error: 'URL' column not found in {input_csv_path}")
        print(f"Available columns: {list(df_input.columns)}")
        return
    
    # Initialize GSC connector
    try:
        gsc = GoogleSearchConsoleConnector(SERVICE_ACCOUNT_FILE, PROPERTY_URI)
        print(f"✅ Connected to Google Search Console")
    except Exception as e:
        print(f"❌ Error connecting to GSC: {e}")
        return
    
    # Set date range (last 3 months)
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=90)
    
    # Prepare results list
    all_results = []
    
    # Process each URL
    total_urls = len(df_input)
    print(f"\n📊 Processing {total_urls} URLs...")
    print(f"📅 Date range: {start_date} to {end_date}")
    print(f"🔍 Fetching top {TOP_N_QUERIES} queries per URL\n")
    
    for idx, row in df_input.iterrows():
        url = row['URL']
        print(f"[{idx+1}/{total_urls}] Processing: {url}")
        
        try:
            # Query GSC for this specific URL
            df_queries = gsc.query(
                start_date=str(start_date),
                end_date=str(end_date),
                dimensions=['query'],
                row_limit=TOP_N_QUERIES,
                page_filter=url,
                search_type='web'
            )
            
            if df_queries.empty:
                print(f"   ⚠️  No data found for this URL")
                # Add a row indicating no data
                all_results.append({
                    'URL': url,
                    'Query': 'No data found',
                    'Clicks': 0,
                    'Impressions': 0,
                    'CTR': 0,
                    'Position': 0
                })
            else:
                # Sort by clicks (descending)
                df_queries = df_queries.sort_values('clicks', ascending=False)
                
                print(f"   ✅ Found {len(df_queries)} queries")
                
                # Add URL column to each query row
                df_queries['URL'] = url
                
                # Reorder columns
                df_queries = df_queries[['URL', 'query', 'clicks', 'impressions', 'ctr', 'position']]
                df_queries.columns = ['URL', 'Query', 'Clicks', 'Impressions', 'CTR', 'Position']
                
                # Add to results
                all_results.extend(df_queries.to_dict('records'))
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
            all_results.append({
                'URL': url,
                'Query': f'Error: {str(e)}',
                'Clicks': 0,
                'Impressions': 0,
                'CTR': 0,
                'Position': 0
            })
    
    # Create DataFrame from all results
    df_output = pd.DataFrame(all_results)
    
    # Save to Excel
    try:
        df_output.to_excel(output_excel_path, index=False, engine='openpyxl')
        print(f"\n✅ SUCCESS! Results saved to: {output_excel_path}")
        print(f"📊 Total rows: {len(df_output)}")
        print(f"📄 Processed URLs: {total_urls}")
    except Exception as e:
        print(f"\n❌ Error saving Excel file: {e}")
        print(f"Trying to save as CSV instead...")
        csv_output = output_excel_path.replace('.xlsx', '.csv')
        df_output.to_csv(csv_output, index=False)
        print(f"✅ Results saved to: {csv_output}")

if __name__ == "__main__":
    print("=" * 60)
    print("Google Search Console - Top Queries Collector")
    print("=" * 60)
    print()
    
    get_top_queries_for_urls(INPUT_CSV, OUTPUT_EXCEL)
    
    print("\n" + "=" * 60)
    print("Process completed!")
    print("=" * 60)
