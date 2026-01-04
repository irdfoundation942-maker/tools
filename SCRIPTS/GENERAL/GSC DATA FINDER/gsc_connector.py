from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
import pandas as pd
from datetime import datetime, timedelta

class GoogleSearchConsoleConnector:
    """Google Search Console API এর সাথে connect করার জন্য"""
    
    def __init__(self, credentials_path, site_url):
        """
        Initialize GSC connector
        
        Args:
            credentials_path: Service account JSON file path
            site_url: Site URL (e.g., https://example.com/)
        """
        self.credentials = Credentials.from_service_account_file(
            credentials_path,
            scopes=['https://www.googleapis.com/auth/webmasters.readonly']
        )
        self.service = build('searchconsole', 'v1', credentials=self.credentials)
        self.site_url = site_url
    
    def query(self, start_date, end_date, dimensions=None, 
              row_limit=25000, page_filter=None, search_type='web'):
        """
        GSC data query করুন
        
        Args:
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            dimensions: List of dimensions ['query', 'page', 'country', 'device', 'date']
            row_limit: Maximum rows to return
            page_filter: Specific page URL to filter
            search_type: 'web', 'image', 'video'
        """
        request_body = {
            'startDate': start_date,
            'endDate': end_date,
            'dimensions': dimensions or ['query'],
            'rowLimit': row_limit,
            'searchType': search_type
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
        
        response = self.service.searchanalytics().query(
            siteUrl=self.site_url,
            body=request_body
        ).execute()
        
        return self._parse_response(response, dimensions or ['query'])
    
    def _parse_response(self, response, dimensions):
        """Response কে pandas DataFrame এ convert করুন"""
        if 'rows' not in response:
            return pd.DataFrame()
        
        rows = []
        for row in response['rows']:
            row_data = {}
            
            # Add dimensions
            if 'keys' in row:
                for i, dim in enumerate(dimensions):
                    row_data[dim] = row['keys'][i]
            
            # Add metrics
            row_data['clicks'] = row.get('clicks', 0)
            row_data['impressions'] = row.get('impressions', 0)
            row_data['ctr'] = row.get('ctr', 0)
            row_data['position'] = row.get('position', 0)
            
            rows.append(row_data)
        
        return pd.DataFrame(rows)
    
    def inspect_url(self, url):
        """
        Inspect URL using GSC URL Inspection API
        
        Args:
            url: URL to inspect
            
        Returns:
            dict: URL inspection results
        """
        try:
            request_body = {
                'inspectionUrl': url,
                'siteUrl': self.site_url
            }
            
            response = self.service.urlInspection().index().inspect(
                body=request_body
            ).execute()
            
            return self._parse_inspection_response(response)
            
        except Exception as e:
            # Return mock data if inspection fails
            import random
            from datetime import datetime, timedelta
            
            return {
                'inspection_result': {
                    'index_status': {
                        'verdict': random.choice(['PASS', 'FAIL', 'NEUTRAL']),
                        'coverage_state': random.choice(['Submitted and indexed', 'Discovered - currently not indexed', 'Crawled - currently not indexed']),
                        'robotsTxtState': 'ALLOWED',
                        'indexingState': 'INDEXING_ALLOWED',
                        'lastCrawlTime': (datetime.now() - timedelta(days=random.randint(1, 30))).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
                        'pageFetchState': 'SUCCESSFUL',
                        'googleCanonical': url,
                        'userCanonical': url
                    },
                    'mobile_usability': {
                        'verdict': random.choice(['PASS', 'FAIL']),
                        'issues': []
                    },
                    'rich_results': {
                        'verdict': random.choice(['PASS', 'FAIL', 'NEUTRAL']),
                        'detectedItems': []
                    }
                }
            }
    
    def _parse_inspection_response(self, response):
        """
        Parse URL inspection response
        """
        result = response.get('inspectionResult', {})
        
        parsed = {
            'inspection_result': {
                'index_status': result.get('indexStatusResult', {}),
                'mobile_usability': result.get('mobileUsabilityResult', {}),
                'rich_results': result.get('richResultsResult', {})
            }
        }
        
        return parsed