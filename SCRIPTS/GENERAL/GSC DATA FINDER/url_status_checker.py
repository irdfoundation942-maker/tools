#!/usr/bin/env python3

import asyncio
import aiohttp
import ssl
import time
import argparse
import sys
from pathlib import Path
from typing import Optional
from dataclasses import dataclass
import csv

try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False


@dataclass
class URLCheckResult:
    url: str
    status: str
    status_code: Optional[int]
    response_time_ms: Optional[float]
    redirect_target: Optional[str]
    error: Optional[str]
    content_type: Optional[str]
    server: Optional[str]


class BulkURLChecker:
    DEFAULT_USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    def __init__(
        self,
        timeout: int = 30,
        max_concurrent: int = 50,
        verify_ssl: bool = True,
        follow_redirects: bool = False,
        user_agent: Optional[str] = None,
        retry_count: int = 1,
        url_column: Optional[str] = None
    ):
        self.timeout = timeout
        self.max_concurrent = max_concurrent
        self.verify_ssl = verify_ssl
        self.follow_redirects = follow_redirects
        self.user_agent = user_agent or self.DEFAULT_USER_AGENT
        self.retry_count = retry_count
        self.url_column = url_column
        self.results: list[URLCheckResult] = []

    def load_urls(self, file_path: str) -> list[str]:
        path = Path(file_path)
        urls = []

        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        suffix = path.suffix.lower()

        if suffix == '.txt':
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    url = line.strip()
                    if url and not url.startswith('#'):
                        urls.append(self._normalize_url(url))

        elif suffix == '.csv':
            with open(path, 'r', encoding='utf-8', newline='') as f:
                reader = csv.reader(f)
                header = next(reader, None)

                url_col_idx = 0
                if header:
                    header_lower = [h.lower().strip() for h in header]

                    if self.url_column:
                        target_col = self.url_column.lower().strip()
                        for idx, col in enumerate(header_lower):
                            if col == target_col:
                                url_col_idx = idx
                                break
                        else:
                            for idx, col in enumerate(header):
                                if col.lower().strip() == target_col:
                                    url_col_idx = idx
                                    break
                    else:
                        for idx, col in enumerate(header_lower):
                            if col in ('url', 'urls', 'link', 'links', 'address', 'page', 'page url'):
                                url_col_idx = idx
                                break

                    if not any(h in header_lower for h in ('url', 'urls', 'link', 'links', 'address', 'domain', 'page', 'page url')) and not self.url_column:
                        if header and header[0]:
                            urls.append(self._normalize_url(header[0]))

                for row in reader:
                    if row and len(row) > url_col_idx and row[url_col_idx]:
                        url = row[url_col_idx].strip()
                        if url and not url.startswith('#'):
                            urls.append(self._normalize_url(url))
        else:
            raise ValueError(f"Unsupported file format: {suffix}. Use .txt or .csv")

        seen = set()
        unique_urls = []
        for url in urls:
            if url not in seen:
                seen.add(url)
                unique_urls.append(url)

        print(f"[INFO] Loaded {len(unique_urls)} unique URLs from {file_path}")
        return unique_urls

    def _normalize_url(self, url: str) -> str:
        url = url.strip()
        if not url:
            return url
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        return url

    async def _check_single_url(
        self,
        session: aiohttp.ClientSession,
        url: str,
        semaphore: asyncio.Semaphore
    ) -> URLCheckResult:
        async with semaphore:
            result = URLCheckResult(
                url=url,
                status="Unknown",
                status_code=None,
                response_time_ms=None,
                redirect_target=None,
                error=None,
                content_type=None,
                server=None
            )

            for attempt in range(self.retry_count + 1):
                try:
                    start_time = time.perf_counter()

                    async with session.head(
                        url,
                        allow_redirects=self.follow_redirects,
                        timeout=aiohttp.ClientTimeout(total=self.timeout)
                    ) as response:
                        end_time = time.perf_counter()

                        result.status_code = response.status
                        result.response_time_ms = round((end_time - start_time) * 1000, 2)
                        result.content_type = response.headers.get('Content-Type', '')
                        result.server = response.headers.get('Server', '')

                        if 200 <= response.status < 300:
                            result.status = "OK"
                        elif 300 <= response.status < 400:
                            result.status = "Redirect"
                            result.redirect_target = response.headers.get('Location', '')
                        elif 400 <= response.status < 500:
                            result.status = "Client Error"
                        elif 500 <= response.status < 600:
                            result.status = "Server Error"
                        else:
                            result.status = "Unknown"

                        if self.follow_redirects and response.history:
                            result.redirect_target = str(response.url)

                        break

                except asyncio.TimeoutError:
                    result.status = "Timeout"
                    result.error = f"Request timed out after {self.timeout}s"

                except aiohttp.ClientSSLError as e:
                    result.status = "SSL Error"
                    result.error = f"SSL certificate error: {str(e)}"

                except aiohttp.ClientConnectorError as e:
                    result.status = "Connection Error"
                    result.error = f"Connection failed: {str(e)}"

                except aiohttp.InvalidURL:
                    result.status = "Invalid URL"
                    result.error = "URL format is invalid"
                    break

                except aiohttp.ClientError as e:
                    result.status = "Client Error"
                    result.error = str(e)

                except Exception as e:
                    result.status = "Error"
                    result.error = f"Unexpected error: {str(e)}"

                if attempt < self.retry_count:
                    await asyncio.sleep(0.5)

            return result

    async def check_urls_async(
        self,
        urls: list[str],
        progress_callback: Optional[callable] = None
    ) -> list[URLCheckResult]:
        semaphore = asyncio.Semaphore(self.max_concurrent)

        if self.verify_ssl:
            ssl_context = ssl.create_default_context()
        else:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        connector = aiohttp.TCPConnector(
            ssl=ssl_context,
            limit=self.max_concurrent,
            limit_per_host=10
        )

        headers = {
            'User-Agent': self.user_agent,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        }

        async with aiohttp.ClientSession(
            connector=connector,
            headers=headers
        ) as session:
            tasks = []
            for url in urls:
                task = asyncio.create_task(
                    self._check_single_url(session, url, semaphore)
                )
                tasks.append(task)

            results = []
            completed = 0
            total = len(tasks)

            for coro in asyncio.as_completed(tasks):
                result = await coro
                results.append(result)
                completed += 1

                if progress_callback:
                    progress_callback(completed, total)

        self.results = results
        return results

    def check_urls(
        self,
        urls: list[str],
        show_progress: bool = True
    ) -> list[URLCheckResult]:
        def progress_callback(checked, total):
            if show_progress:
                percent = (checked / total) * 100
                bar_length = 40
                filled = int(bar_length * checked / total)
                bar = '#' * filled + '-' * (bar_length - filled)
                print(f"\r[{bar}] {percent:5.1f}% ({checked}/{total})", end='', flush=True)

        if show_progress:
            print(f"\n[INFO] Checking {len(urls)} URLs with {self.max_concurrent} concurrent requests...")

        results = asyncio.run(
            self.check_urls_async(urls, progress_callback if show_progress else None)
        )

        if show_progress:
            print("\n[INFO] URL checking complete!")

        return results

    def export_to_csv(self, output_path: str) -> str:
        if not self.results:
            raise ValueError("No results to export. Run check_urls first.")

        path = Path(output_path)
        if not path.suffix:
            path = path.with_suffix('.csv')

        fieldnames = [
            'URL', 'Status', 'Status Code', 'Response Time (ms)',
            'Redirect Target', 'Error', 'Content Type', 'Server'
        ]

        with open(path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(fieldnames)

            for r in self.results:
                writer.writerow([
                    r.url,
                    r.status,
                    r.status_code if r.status_code else '',
                    r.response_time_ms if r.response_time_ms else '',
                    r.redirect_target if r.redirect_target else '',
                    r.error if r.error else '',
                    r.content_type if r.content_type else '',
                    r.server if r.server else ''
                ])

        print(f"[INFO] Results exported to: {path}")
        return str(path)

    def export_to_excel(self, output_path: str) -> str:
        if not PANDAS_AVAILABLE:
            raise ImportError("pandas is required for Excel export. Install with: pip install pandas")
        if not OPENPYXL_AVAILABLE:
            raise ImportError("openpyxl is required for Excel export. Install with: pip install openpyxl")

        if not self.results:
            raise ValueError("No results to export. Run check_urls first.")

        path = Path(output_path)
        if not path.suffix:
            path = path.with_suffix('.xlsx')

        data = []
        for r in self.results:
            data.append({
                'URL': r.url,
                'Status': r.status,
                'Status Code': r.status_code,
                'Response Time (ms)': r.response_time_ms,
                'Redirect Target': r.redirect_target,
                'Error': r.error,
                'Content Type': r.content_type,
                'Server': r.server
            })

        df = pd.DataFrame(data)

        with pd.ExcelWriter(path, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='URL Status Report', index=False)

            worksheet = writer.sheets['URL Status Report']
            for idx, col in enumerate(df.columns):
                max_length = max(
                    df[col].astype(str).apply(len).max(),
                    len(col)
                ) + 2
                worksheet.column_dimensions[chr(65 + idx)].width = min(max_length, 50)

        print(f"[INFO] Results exported to: {path}")
        return str(path)

    def get_summary(self) -> dict:
        if not self.results:
            return {}

        summary = {
            'total': len(self.results),
            'ok': 0,
            'redirects': 0,
            'client_errors': 0,
            'server_errors': 0,
            'timeouts': 0,
            'ssl_errors': 0,
            'connection_errors': 0,
            'other_errors': 0,
            'avg_response_time_ms': 0
        }

        response_times = []

        for r in self.results:
            if r.status == "OK":
                summary['ok'] += 1
            elif r.status == "Redirect":
                summary['redirects'] += 1
            elif r.status == "Client Error":
                summary['client_errors'] += 1
            elif r.status == "Server Error":
                summary['server_errors'] += 1
            elif r.status == "Timeout":
                summary['timeouts'] += 1
            elif r.status == "SSL Error":
                summary['ssl_errors'] += 1
            elif r.status == "Connection Error":
                summary['connection_errors'] += 1
            else:
                summary['other_errors'] += 1

            if r.response_time_ms:
                response_times.append(r.response_time_ms)

        if response_times:
            summary['avg_response_time_ms'] = round(
                sum(response_times) / len(response_times), 2
            )

        return summary

    def print_summary(self):
        summary = self.get_summary()

        if not summary:
            print("[WARN] No results to summarize.")
            return

        print("\n" + "=" * 60)
        print("                    URL CHECK SUMMARY")
        print("=" * 60)
        print(f"  Total URLs Checked:    {summary['total']}")
        print("-" * 60)
        print(f"  [OK]  2xx Success:     {summary['ok']}")
        print(f"  [->]  3xx Redirects:   {summary['redirects']}")
        print(f"  [4x]  4xx Client Err:  {summary['client_errors']}")
        print(f"  [5x]  5xx Server Err:  {summary['server_errors']}")
        print(f"  [TO]  Timeouts:        {summary['timeouts']}")
        print(f"  [SSL] SSL Errors:      {summary['ssl_errors']}")
        print(f"  [CN]  Connection Err:  {summary['connection_errors']}")
        print(f"  [??]  Other Errors:    {summary['other_errors']}")
        print("-" * 60)
        print(f"  Avg Response Time:     {summary['avg_response_time_ms']} ms")
        print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Bulk URL Status Checker",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument('input_file', help='Input file (.txt or .csv)')
    parser.add_argument('-o', '--output', default='url_status_report', help='Output file path')
    parser.add_argument('-f', '--format', choices=['csv', 'excel', 'both'], default='csv', help='Output format')
    parser.add_argument('-t', '--timeout', type=int, default=30, help='Request timeout (seconds)')
    parser.add_argument('-c', '--concurrent', type=int, default=50, help='Max concurrent requests')
    parser.add_argument('--url-column', help='CSV column name containing URLs (e.g., "url", "page", "link")')
    parser.add_argument('--no-ssl-verify', action='store_true', help='Disable SSL verification')
    parser.add_argument('--follow-redirects', action='store_true', help='Follow redirects')
    parser.add_argument('-r', '--retry', type=int, default=1, help='Retry attempts')
    parser.add_argument('-q', '--quiet', action='store_true', help='Suppress progress')

    args = parser.parse_args()

    if not Path(args.input_file).exists():
        print(f"[ERROR] Input file not found: {args.input_file}")
        sys.exit(1)

    if args.format in ('excel', 'both') and not (PANDAS_AVAILABLE and OPENPYXL_AVAILABLE):
        print("[ERROR] Excel export requires: pip install pandas openpyxl")
        sys.exit(1)

    checker = BulkURLChecker(
        timeout=args.timeout,
        max_concurrent=args.concurrent,
        verify_ssl=not args.no_ssl_verify,
        follow_redirects=args.follow_redirects,
        retry_count=args.retry,
        url_column=args.url_column
    )

    try:
        urls = checker.load_urls(args.input_file)

        if not urls:
            print("[ERROR] No URLs found in input file.")
            sys.exit(1)

        checker.check_urls(urls, show_progress=not args.quiet)

        output_base = Path(args.output).stem
        output_dir = Path(args.output).parent or Path('.')

        if args.format in ('csv', 'both'):
            checker.export_to_csv(output_dir / f"{output_base}.csv")

        if args.format in ('excel', 'both'):
            checker.export_to_excel(output_dir / f"{output_base}.xlsx")

        if not args.quiet:
            checker.print_summary()

    except KeyboardInterrupt:
        print("\n[INFO] Operation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()
