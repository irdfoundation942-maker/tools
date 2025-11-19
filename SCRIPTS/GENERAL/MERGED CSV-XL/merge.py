#!/usr/bin/env python3
"""
CSV and Excel File Merger Script
Author: Assistant
Description: Merges all CSV and Excel files from specified folders and subfolders
"""

import os
import pandas as pd
from pathlib import Path
import sys
import argparse
from typing import List, Union
import warnings

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

class CSVExcelMerger:
    """Class to handle merging of CSV and Excel files from folders"""
    
    def __init__(self):
        self.supported_extensions = ['.csv', '.xlsx', '.xls', '.xlsm']
        self.merged_data = pd.DataFrame()
        self.files_processed = []
        self.files_skipped = []
        
    def find_files(self, folder_path: str) -> List[str]:
        """
        Recursively find all CSV and Excel files in folder and subfolders
        
        Args:
            folder_path: Path to the folder to search
            
        Returns:
            List of file paths
        """
        files = []
        
        # Convert to Path object for better handling
        folder = Path(folder_path)
        
        if not folder.exists():
            print(f"❌ Folder not found: {folder_path}")
            return files
            
        if not folder.is_dir():
            print(f"❌ Not a directory: {folder_path}")
            return files
            
        # Recursively find all files with supported extensions
        for ext in self.supported_extensions:
            files.extend(folder.rglob(f"*{ext}"))
            
        # Convert Path objects to strings
        files = [str(f) for f in files]
                
        return files
    
    def read_file(self, file_path: str) -> pd.DataFrame:
        """
        Read a CSV or Excel file into a DataFrame
        
        Args:
            file_path: Path to the file
            
        Returns:
            DataFrame with file contents
        """
        try:
            file_ext = Path(file_path).suffix.lower()
            
            if file_ext == '.csv':
                # Try different encodings for CSV files
                encodings = ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']
                for encoding in encodings:
                    try:
                        df = pd.read_csv(file_path, encoding=encoding)
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    print(f"  ⚠ Could not read CSV with any encoding: {file_path}")
                    return pd.DataFrame()
                    
            elif file_ext in ['.xlsx', '.xls', '.xlsm']:
                # Read Excel file (first sheet by default)
                df = pd.read_excel(file_path, engine='openpyxl' if file_ext == '.xlsx' else None)
                
            else:
                print(f"  ⚠ Unsupported file type: {file_path}")
                return pd.DataFrame()
                
            return df
            
        except Exception as e:
            print(f"  ⚠ Error reading file {file_path}: {str(e)}")
            self.files_skipped.append(file_path)
            return pd.DataFrame()
    
    def merge_files(self, folder_paths: Union[str, List[str]], output_path: str = None):
        """
        Merge all CSV and Excel files from specified folder(s)
        
        Args:
            folder_paths: Single folder path or list of folder paths
            output_path: Path for the output file (optional)
        """
        # Convert single path to list
        if isinstance(folder_paths, str):
            folder_paths = [folder_paths]
            
        all_files = []
        
        for folder_path in folder_paths:
            folder_files = self.find_files(folder_path)
            all_files.extend(folder_files)
            
        if not all_files:
            print("\n❌ No CSV or Excel files found in the specified folder(s)")
            return
        
        # Process each file
        dataframes = []
        
        for i, file_path in enumerate(all_files, 1):            
            df = self.read_file(file_path)
            
            if not df.empty:
                dataframes.append(df)
                self.files_processed.append(file_path)
            else:
                print(f"  ⚠ Skipped (empty or error)")
                
        # Merge all dataframes
        if dataframes:
            self.merged_data = pd.concat(dataframes, ignore_index=True)
            
            # Save the merged file
            if output_path is None:
                output_path = "merged_output.xlsx"
                
            self.save_output(output_path)
            
            # Print summary
            self.print_summary()
        else:
            print("\n❌ No valid data found to merge")
    
    def save_output(self, output_path: str):
        """
        Save the merged data to a file
        
        Args:
            output_path: Path for the output file
        """
        try:
            # Determine file type from extension
            file_ext = Path(output_path).suffix.lower()
            
            if file_ext == '.csv':
                self.merged_data.to_csv(output_path, index=False)
            else:
                # Default to Excel if not CSV
                if not file_ext in ['.xlsx', '.xls']:
                    output_path = str(Path(output_path).with_suffix('.xlsx'))
                self.merged_data.to_excel(output_path, index=False, engine='openpyxl')
                
            # Restore save confirmation log
            print(f"\n✅ Merged file saved: {output_path}")
            
        except Exception as e:
            print(f"\n❌ Error saving file: {str(e)}")

    def print_summary(self):
        """Print summary of the merge operation"""
        # Restore summary log
        print("📈 MERGE SUMMARY")
        print("=" * 50)
        print(f"✓ Files processed: {len(self.files_processed)}")
        print(f"⚠ Files skipped: {len(self.files_skipped)}")
        print(f"📊 Total rows in merged data: {len(self.merged_data)}")
        print(f"📋 Total columns: {len(self.merged_data.columns)}")
        print(f"🏷 Column names: {', '.join(self.merged_data.columns[:10])}")
        if len(self.merged_data.columns) > 10:
            print(f"   ... and {len(self.merged_data.columns) - 10} more columns")
        
        if self.files_skipped:
            print("\n⚠ Skipped files:")
            for file in self.files_skipped[:5]:
                print(f"  - {Path(file).name}")
            if len(self.files_skipped) > 5:
                print(f"  ... and {len(self.files_skipped) - 5} more")


def main():
    parser = argparse.ArgumentParser(
        description='Merge CSV and Excel files from folders',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python merge_csv_excel.py /path/to/folder
  python merge_csv_excel.py /path/to/folder -o merged_data.xlsx
  python merge_csv_excel.py /path1 /path2 /path3 -o output.csv
  python merge_csv_excel.py ~/Downloads/MERGED\ CSV-XL/DAY-WISE
        """
    )
    
    parser.add_argument(
        'folders',
        nargs='+',
        help='Folder path(s) to search for CSV/Excel files'
    )
    
    parser.add_argument(
        '-o', '--output',
        default='merged_output.xlsx',
        help='Output file path (default: merged_output.xlsx)'
    )
    
    args = parser.parse_args()
    
    # Create merger instance
    merger = CSVExcelMerger()
    
    # Run the merge
    merger.merge_files(args.folders, args.output)
    

# Interactive mode if no arguments provided
def interactive_mode():
    """Run in interactive mode"""
    merger = CSVExcelMerger()

    
    folder_paths = []
    
    while True:
        folder = input("\n📁 Enter folder path (or 'done' to start merging): ").strip()
        
        if folder.lower() == 'done':
            if folder_paths:
                break
            else:
                print("❌ Please enter at least one folder path")
                continue
                
        if folder:
            # Expand user home directory if needed
            folder = os.path.expanduser(folder)
            if os.path.exists(folder):
                folder_paths.append(folder)
                print(f"✓ Added: {folder}")
            else:
                print(f"❌ Folder not found: {folder}")
                
    output_path = input("\n💾 Enter output file name (default: merged_output.xlsx): ").strip()
    if not output_path:
        output_path = "merged_output.xlsx"
        
    # Run the merge
    merger.merge_files(folder_paths, output_path)


if __name__ == "__main__":

    FOLDER_PATH = r"c:\Users\seo1i\Downloads\MERGED CSV-XL\DAY-WISE"
    OUTPUT_FILE = "merged_output.xlsx"
    
    # Create merger instance
    merger = CSVExcelMerger()
    
    # Run the merge with the specified folder path
    merger.merge_files(FOLDER_PATH, OUTPUT_FILE)