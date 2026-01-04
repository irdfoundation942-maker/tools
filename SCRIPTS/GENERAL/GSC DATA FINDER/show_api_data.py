import json
from gsc_connector import GoogleSearchConsoleConnector
from datetime import datetime, timedelta

# Configuration
SERVICE_ACCOUNT_FILE = r'C:\Users\seo1i\Downloads\TOP QUERIES\gsc-dashboard-474505-12ef60690267.json'
PROPERTY_URI = 'sc-domain:duaruqyah.com'

def show_api_response():
    """
    GSC API থেকে যে data আসে তা দেখান
    """
    print("=" * 80)
    print("Google Search Console API - RAW DATA দেখাচ্ছি")
    print("=" * 80)
    
    # Connect to GSC
    gsc = GoogleSearchConsoleConnector(SERVICE_ACCOUNT_FILE, PROPERTY_URI)
    
    # Set date range (last 7 days for quick testing)
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=7)
    
    print(f"\n📅 Date Range: {start_date} to {end_date}\n")
    
    # Example 1: Simple query dimension only
    print("\n" + "="*80)
    print("📊 Example 1: শুধুমাত্র QUERY dimension (সবচেয়ে common)")
    print("="*80)
    
    request_body = {
        'startDate': str(start_date),
        'endDate': str(end_date),
        'dimensions': ['query'],
        'rowLimit': 5,
        'searchType': 'web'
    }
    
    print("\n🔹 Request Body:")
    print(json.dumps(request_body, indent=2))
    
    response = gsc.service.searchanalytics().query(
        siteUrl=PROPERTY_URI,
        body=request_body
    ).execute()
    
    print("\n🔹 Response (Raw JSON):")
    print(json.dumps(response, indent=2, ensure_ascii=False))
    
    print("\n🔹 Available Fields in Each Row:")
    if 'rows' in response and len(response['rows']) > 0:
        first_row = response['rows'][0]
        print("  • keys: ", first_row.get('keys', []))
        print("  • clicks: ", first_row.get('clicks', 0))
        print("  • impressions: ", first_row.get('impressions', 0))
        print("  • ctr: ", first_row.get('ctr', 0))
        print("  • position: ", first_row.get('position', 0))
    
    # Example 2: Multiple dimensions
    print("\n\n" + "="*80)
    print("📊 Example 2: Multiple Dimensions (QUERY + PAGE)")
    print("="*80)
    
    request_body_2 = {
        'startDate': str(start_date),
        'endDate': str(end_date),
        'dimensions': ['query', 'page'],
        'rowLimit': 3,
        'searchType': 'web'
    }
    
    print("\n🔹 Request Body:")
    print(json.dumps(request_body_2, indent=2))
    
    response_2 = gsc.service.searchanalytics().query(
        siteUrl=PROPERTY_URI,
        body=request_body_2
    ).execute()
    
    print("\n🔹 Response Sample:")
    print(json.dumps(response_2, indent=2, ensure_ascii=False))
    
    # Example 3: With page filter
    print("\n\n" + "="*80)
    print("📊 Example 3: Specific Page Filter দিয়ে")
    print("="*80)
    
    # Get a page URL from previous response
    if 'rows' in response_2 and len(response_2['rows']) > 0:
        sample_page = response_2['rows'][0]['keys'][1]
        
        request_body_3 = {
            'startDate': str(start_date),
            'endDate': str(end_date),
            'dimensions': ['query'],
            'rowLimit': 3,
            'searchType': 'web',
            'dimensionFilterGroups': [{
                'filters': [{
                    'dimension': 'page',
                    'operator': 'equals',
                    'expression': sample_page
                }]
            }]
        }
        
        print(f"\n🔹 Filtering for page: {sample_page}")
        print("\n🔹 Request Body:")
        print(json.dumps(request_body_3, indent=2))
        
        response_3 = gsc.service.searchanalytics().query(
            siteUrl=PROPERTY_URI,
            body=request_body_3
        ).execute()
        
        print("\n🔹 Response:")
        print(json.dumps(response_3, indent=2, ensure_ascii=False))
    
    # Example 4: All available dimensions
    print("\n\n" + "="*80)
    print("📊 Example 4: ALL Dimensions একসাথে")
    print("="*80)
    
    request_body_4 = {
        'startDate': str(start_date),
        'endDate': str(end_date),
        'dimensions': ['query', 'page', 'country', 'device', 'date'],
        'rowLimit': 2,
        'searchType': 'web'
    }
    
    print("\n🔹 Request Body:")
    print(json.dumps(request_body_4, indent=2))
    
    response_4 = gsc.service.searchanalytics().query(
        siteUrl=PROPERTY_URI,
        body=request_body_4
    ).execute()
    
    print("\n🔹 Response:")
    print(json.dumps(response_4, indent=2, ensure_ascii=False))
    
    print("\n\n" + "="*80)
    print("📝 SUMMARY: API থেকে যা যা পাওয়া যায়")
    print("="*80)
    print("""
🔹 DIMENSIONS (যেকোনো combination use করতে পারবেন):
   • query      - Search query/keyword
   • page       - Landing page URL
   • country    - Country code (BGD, USA, IND, etc.)
   • device     - Device type (DESKTOP, MOBILE, TABLET)
   • date       - Date (YYYY-MM-DD format)

🔹 METRICS (সবসময় available):
   • clicks      - Total clicks
   • impressions - Total impressions
   • ctr         - Click-through rate (0.0 to 1.0)
   • position    - Average position in search results

🔹 FILTERS (optional):
   • dimension filter দিয়ে specific page/query/country/device filter করতে পারবেন
   • Operators: equals, contains, notContains, includingRegex, excludingRegex

🔹 SEARCH TYPES:
   • web    - Regular web search
   • image  - Image search
   • video  - Video search
   • news   - News search
    """)

if __name__ == "__main__":
    try:
        show_api_response()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
