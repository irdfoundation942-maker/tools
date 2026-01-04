import pandas as pd
import csv
import sys

# --- 1. Read Prompt Template ---
# Reads the prompt structure from an external text file.
try:
    with open('prompt.txt', 'r', encoding='utf-8') as f:
        prompt_template = f.read()
except FileNotFoundError:
    print("Error: 'prompt.txt' not found. Please ensure the template file is in the same directory.")
    sys.exit()

# --- 2. Read Keyword Data ---
# Reads the source CSV file with all Surah keywords and volumes.
try:
    df = pd.read_csv('Quran Surah Wise Keywords.csv')
except FileNotFoundError:
    print("Error: 'Quran Surah Wise Keywords.csv' not found. Please ensure the data file is in the same directory.")
    sys.exit()

# --- 3. Process and Structure Data ---
# A dictionary to hold all keywords and metadata, grouped by the Surah ID.
surah_keywords = {}
current_surah_id = None

# Loop through each row of the dataframe to extract and organize the data.
for index, row in df.iterrows():
    # FIX: Changed 'Surah_id' to 'surah_id' to match the actual column name in the CSV.
    # This resolves the KeyError.
    if not pd.isna(row['surah_id']):
        current_surah_id = int(row['surah_id'])
        # If this is the first time we see this Surah ID, initialize its entry.
        if current_surah_id not in surah_keywords:
            surah_keywords[current_surah_id] = {
                'name': row['Name_en'],
                'main_keyword': row['MAIN KEYWORDS'],
                'relevant_keywords': []
            }
    
    # Add the relevant keyword and its volume for the current Surah.
    if current_surah_id is not None and not pd.isna(row['RELEVANT KEYWORDS']):
        keyword = str(row['RELEVANT KEYWORDS']).strip()
        volume = ''
        
        # The volume column is lowercase 'volume' (last column in CSV)
        volume_col_name = 'volume' 
        
        if volume_col_name in df.columns and not pd.isna(row[volume_col_name]):
            volume = str(row[volume_col_name]).strip()

        # Format the keyword and volume as "keyword-volume".
        if keyword and volume:
            formatted_keyword = f"{keyword}-{volume}"
            surah_keywords[current_surah_id]['relevant_keywords'].append(formatted_keyword)
        elif keyword:
            # If volume is missing, just add the keyword.
            surah_keywords[current_surah_id]['relevant_keywords'].append(keyword)

# --- 4. Prepare Prompts for Output ---
# A list of default keywords to use if a Surah has no relevant keywords.
default_keywords = [
    "quranic ayat",
    "quran tilawat",
    "quran recitation",
    "quran with urdu translation",
    "quran with english translation",
    "quran recitation with english translation"
]

# This list will hold the final data to be written to the CSV.
output_data = []

# Iterate through each processed Surah to generate the final prompt text.
for surah_id in sorted(surah_keywords.keys()):
    data = surah_keywords[surah_id]
    
    relevant_kw_list = data['relevant_keywords']
    
    # If the relevant keywords list is empty, use the default list.
    if not relevant_kw_list:
        relevant_kw_text = '\n'.join(default_keywords)
    else:
        relevant_kw_text = '\n'.join(relevant_kw_list)
    
    # Replace the placeholders in the template with the actual data.
    prompt = prompt_template.replace('{main keyword}', str(data.get('main_keyword', '')))
    prompt = prompt.replace('{relevant keywords}', relevant_kw_text)
    
    output_data.append({
        'surah_id': surah_id,
        'surah_name': data['name'],
        'prompt': prompt
    })

# --- 5. Write to CSV File ---
# Save the generated prompts to a new file named 'output_prompts.csv'.
output_filename = 'output_prompts.csv'
with open(output_filename, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['surah_id', 'surah_name', 'prompt'])
    writer.writeheader()
    writer.writerows(output_data)

# --- 6. Final Confirmation ---
# Print a success message and show a full example of the first prompt created.
print(f"✅ Successfully generated prompts for {len(output_data)} surahs!")
print(f"   Output saved to: {output_filename}")