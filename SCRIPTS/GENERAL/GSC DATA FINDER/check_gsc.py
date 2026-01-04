import os
from google.oauth2 import service_account
from googleapiclient.discovery import build
from google.api_core import exceptions

# --- Configuration - Update your information here ---
# Using the credentials we already set up in the dashboard

SERVICE_ACCOUNT_FILE = r'C:\Users\seo1i\Downloads\SEO Dashboard v2\gsc-dashboard-474505-12ef60690267.json' 
# আপনার নতুন JSON ফাইলের পাথ দিন


PROPERTY_URI = 'sc-domain:duaruqyah.com'  # আপনার নতুন website URL দিন
# --- End Configuration ---

SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']

try:
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)

    # Create Search Console service
    searchconsole = build('searchconsole', 'v1', credentials=creds)

    # Make a simple data request
    request = {
        'startDate': '2023-10-01',
        'endDate': '2023-10-01',
        'dimensions': ['page']
    }
    
    print("Trying to fetch data from Google Search Console...")
    response = searchconsole.searchanalytics().query(siteUrl=PROPERTY_URI, body=request).execute()
    print("✅ Success! Your service account has proper access to Google Search Console.")

except exceptions.PermissionDenied:
    print("❌ Failed! Permission Denied (403 Error).")
    print("Possible cause: Service account email not added to GSC or doesn't have 'Reader' permission.")
except Exception as e:
    print(f"❌ An error occurred: {e}")
    print("Possible causes: API not enabled, wrong website URL (PROPERTY_URI), or incorrect JSON file path.")
