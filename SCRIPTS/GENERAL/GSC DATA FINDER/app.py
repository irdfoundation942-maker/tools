from flask import Flask, render_template, request, jsonify
from gsc_connector import GoogleSearchConsoleConnector
from datetime import datetime, timedelta
import json

app = Flask(__name__)

# Configuration
SERVICE_ACCOUNT_FILE = r'C:\Users\seo1i\Downloads\Shakil - OCT\SEO Dashboard Final\gsc-dashboard-474505-12ef60690267.json'  # আপনার নতুন JSON ফাইলের পাথ দিন
PROPERTY_URI = 'sc-domain:duaruqyah.com'  # আপনার নতুন website URL দিন

# Initialize GSC connector
gsc = GoogleSearchConsoleConnector(SERVICE_ACCOUNT_FILE, PROPERTY_URI)

@app.route('/')
def index():
    """Home page"""
    return render_template('index.html')

@app.route('/api/query-data', methods=['POST'])
def get_query_data():
    """Fetch data from GSC API based on user selections"""
    try:
        data = request.json
        
        # Parse dates
        start_date = data.get('start_date', (datetime.now().date() - timedelta(days=7)).isoformat())
        end_date = data.get('end_date', datetime.now().date().isoformat())
        
        # Parse dimensions
        dimensions = data.get('dimensions', ['query'])
        
        # Parse filters
        page_filter = data.get('page_filter', '')
        row_limit = int(data.get('row_limit', 10))
        
        # Build request body
        request_body = {
            'startDate': start_date,
            'endDate': end_date,
            'dimensions': dimensions,
            'rowLimit': row_limit,
            'searchType': 'web'
        }
        
        # Add page filter if provided
        if page_filter:
            request_body['dimensionFilterGroups'] = [{
                'filters': [{
                    'dimension': 'page',
                    'operator': 'equals',
                    'expression': page_filter
                }]
            }]
        
        # Execute query
        response = gsc.service.searchanalytics().query(
            siteUrl=PROPERTY_URI,
            body=request_body
        ).execute()
        
        return jsonify({
            'success': True,
            'request': request_body,
            'response': response,
            'row_count': len(response.get('rows', []))
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/top-pages', methods=['POST'])
def get_top_pages():
    """Get top pages to populate page filter dropdown"""
    try:
        data = request.json
        start_date = data.get('start_date', (datetime.now().date() - timedelta(days=7)).isoformat())
        end_date = data.get('end_date', datetime.now().date().isoformat())
        
        request_body = {
            'startDate': start_date,
            'endDate': end_date,
            'dimensions': ['page'],
            'rowLimit': 20,
            'searchType': 'web'
        }
        
        response = gsc.service.searchanalytics().query(
            siteUrl=PROPERTY_URI,
            body=request_body
        ).execute()
        
        pages = []
        if 'rows' in response:
            pages = [row['keys'][0] for row in response['rows']]
        
        return jsonify({
            'success': True,
            'pages': pages
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/total-data', methods=['POST'])
def get_total_data():
    """Fetch total data from GSC API (all available data without date restrictions)"""
    try:
        data = request.json
        
        # Parse dimensions
        dimensions = data.get('dimensions', ['query'])
        row_limit = int(data.get('row_limit', 10))
        
        # Use a wide date range to get total data (last 16 months - max allowed by GSC)
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=450)  # ~15 months back
        
        # Build request body for total data
        request_body = {
            'startDate': start_date.isoformat(),
            'endDate': end_date.isoformat(),
            'dimensions': dimensions,
            'rowLimit': row_limit,
            'searchType': 'web'
        }
        
        # Execute query
        response = gsc.service.searchanalytics().query(
            siteUrl=PROPERTY_URI,
            body=request_body
        ).execute()
        
        return jsonify({
            'success': True,
            'request': request_body,
            'response': response,
            'row_count': len(response.get('rows', [])),
            'data_type': 'total'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/inspect-url', methods=['POST'])
def inspect_url():
    """Inspect a URL using GSC URL Inspection API"""
    try:
        data = request.json
        url = data.get('url', '')
        
        if not url:
            return jsonify({
                'success': False,
                'error': 'URL is required'
            }), 400
        
        # Get inspection data
        inspection_result = gsc.inspect_url(url)
        
        return jsonify({
            'success': True,
            'url': url,
            'inspection': inspection_result
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print("🚀 Starting Google Search Console API Explorer...")
    print("📊 Open your browser and go to: http://localhost:5000")
    app.run(debug=True, port=5000)
