import json
import re
import pandas as pd
import sys

def strip_html_tags(text):
    """Remove HTML tags from text."""
    if not text:
        return ''
    # Remove HTML tags
    clean = re.sub(r'<[^>]+>', '', str(text)) # Added str() conversion for safety
    # Replace multiple spaces/newlines with single space
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()

def process_section(section_data):
    """Process a section that can be either an object or array of objects."""
    results = []

    # Handle array format
    if isinstance(section_data, list):
        for item in section_data:
            if isinstance(item, dict):
                title = item.get('title', '')
                subtitle = item.get('subtitle', '')
                content = item.get('content', [])
                if title: results.append(strip_html_tags(title))
                if subtitle: results.append(strip_html_tags(subtitle))
                if isinstance(content, list):
                    for c in content:
                        if c: results.append(strip_html_tags(c))
                elif content:
                    results.append(strip_html_tags(content))
    # Handle single object format
    elif isinstance(section_data, dict):
        title = section_data.get('title', '')
        subtitle = section_data.get('subtitle', '')
        content = section_data.get('content', [])
        if title: results.append(strip_html_tags(title))
        if subtitle: results.append(strip_html_tags(subtitle))
        if isinstance(content, list):
            for c in content:
                if c: results.append(strip_html_tags(c))
        elif content:
            results.append(strip_html_tags(content))

    return results

def json_to_normal_text(json_str):
    """Parse JSON string and convert to single normal text."""
    if pd.isna(json_str): # Handle Empty/NaN cells
        return ''

    try:
        data = json.loads(str(json_str))
    except (json.JSONDecodeError, TypeError):
        return ''

    parts = []

    # Taglines
    if 'taglines' in data and isinstance(data['taglines'], list):
        for tagline in data['taglines']:
            if tagline: parts.append(strip_html_tags(tagline))

    # Meta title and description
    if 'meta_title' in data and data['meta_title']:
        parts.append(strip_html_tags(data['meta_title']))
    if 'meta_description' in data and data['meta_description']:
        parts.append(strip_html_tags(data['meta_description']))

    # Benefits section (handles both object and array format)
    if 'benefits' in data:
        parts.extend(process_section(data['benefits']))

    # When to recite section (handles both object and array format)
    if 'when_to_recite' in data:
        parts.extend(process_section(data['when_to_recite']))

    # How to perform section (handles both object and array format)
    if 'how_to_perform' in data:
        parts.extend(process_section(data['how_to_perform']))

    # Summary
    if 'summary' in data and isinstance(data['summary'], list):
        for item in data['summary']:
            if item: parts.append(strip_html_tags(item))

    # FAQ section
    if 'faqs' in data and isinstance(data['faqs'], list):
        for faq in data['faqs']:
            question = faq.get('question', '')
            answer = faq.get('answer', '')
            if question: parts.append(strip_html_tags(question))
            if answer: parts.append(strip_html_tags(answer))

    # Legacy format support (meta_data, todays_content, city_article, faq_section)
    if 'meta_data' in data:
        meta_title = data['meta_data'].get('title', '')
        meta_desc = data['meta_data'].get('desc', '')
        if meta_title: parts.append(strip_html_tags(meta_title))
        if meta_desc: parts.append(strip_html_tags(meta_desc))

    if 'todays_content' in data:
        todays_title = data['todays_content'].get('title', '')
        todays_content = data['todays_content'].get('content', '')
        if todays_title: parts.append(strip_html_tags(todays_title))
        if todays_content: parts.append(strip_html_tags(todays_content))

    if 'city_article' in data:
        city_title = data['city_article'].get('title', '')
        city_content = data['city_article'].get('content', '')
        if city_title: parts.append(strip_html_tags(city_title))
        if city_content: parts.append(strip_html_tags(city_content))

    if 'faq_section' in data and isinstance(data['faq_section'], list):
        for faq in data['faq_section']:
            question = faq.get('question', '')
            answer = faq.get('answer', '')
            if question: parts.append(strip_html_tags(question))
            if answer: parts.append(strip_html_tags(answer))

    return '\n\n'.join(parts)

def main():
    input_file = 'input.xlsx'
    output_file = 'data.xlsx'

    print(f"Reading {input_file}...")
    try:
        df = pd.read_excel(input_file)
    except FileNotFoundError:
        print(f"Error: The file '{input_file}' was not found.")
        return

    # --- FIX: CLEAN COLUMN NAMES ---
    # This removes hidden spaces (e.g., "JSON_Data " becomes "JSON_Data")
    df.columns = df.columns.str.strip()

    # --- DEBUG: CHECK COLUMNS ---
    print(f"Columns found in file: {list(df.columns)}")

    target_col = 'content'
    
    # Check if the column exists
    if target_col not in df.columns:
        print(f"\nCRITICAL ERROR: Column '{target_col}' not found.")
        print("Please rename the column in your Excel file or update the script to match one of the columns listed above.")
        return

    print("Processing rows...")
    
    # Convert JSON_Data column to Normal_Data
    # Using apply with a lambda to handle potential errors gracefully
    df['Normal_Data'] = df[target_col].apply(json_to_normal_text)

    # Drop JSON_Data column
    df = df.drop(columns=[target_col])

    # Check if Row_Number exists before renaming, otherwise create index
    if 'Row_Number' in df.columns:
        df = df.rename(columns={'Row_Number': 'id', 'Normal_Data': 'response'})
    else:
        # If Row_Number doesn't exist, just rename Normal_Data and use the index as ID
        print("Note: 'Row_Number' column not found. Creating 'id' from row index.")
        df = df.rename(columns={'Normal_Data': 'response'})
        df['id'] = df.index + 1
    
    # Ensure only id and response are in the final output (optional, based on your request)
    # If there are other columns you want to keep, remove the next line
    df = df[['id', 'response']]

    # Write output Excel file
    df.to_excel(output_file, index=False)

    print(f"\nConversion complete! Output saved to '{output_file}'")
    print(f"Processed {len(df)} rows")

if __name__ == '__main__':
    main()