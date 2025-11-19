// Runs on SEMrush Organic Positions page
(async function(){
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let shouldStop = false;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STOP_SCRAPING') {
      shouldStop = true;
      console.log('Stop signal received from background');
    }
  });

  function getSiteFromUrl(){
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('q') || '';
      return decodeURIComponent(q);
    } catch(e){ return location.href; }
  }

  async function waitForTable(timeoutMs = 30000){
    const start = Date.now();
    console.log(`Waiting for table to load (timeout: ${timeoutMs}ms)...`);
    
    while (Date.now() - start < timeoutMs){
      // Fast-path: if the explicit "no data" banner is present, bail out immediately
      const noDataTitleFast = document.querySelector('[data-at="nf-title"]');
      if (noDataTitleFast) {
        const t = noDataTitleFast.textContent || '';
        if (t.includes('We couldn\'t find any data') || t.includes('Nothing found')){
          console.log('waitForTable: No data banner detected – short-circuiting');
          return null;
        }
      }
      // Check for error messages first
      const errorMessages = [
        'Something went wrong',
        'We are aware of the issue',
        'Please try again later',
        'Error loading data',
        'Service temporarily unavailable',
        'Something went wrong'
      ];
      
      const errorElement = document.querySelector('*');
      if (errorElement) {
        const pageText = errorElement.textContent || '';
        const hasError = errorMessages.some(msg => pageText.includes(msg));
        if (hasError) {
          console.log('Error message detected on page');
          chrome.runtime.sendMessage({ 
            type: 'SCRAPE_ERROR', 
            site: getSiteFromUrl(),
            error: 'SEMrush error message detected: ' + errorMessages.find(msg => pageText.includes(msg))
          });
          return null;
        }
      }
      
      // Try multiple table detection strategies
      const tableSelectors = [
        '#cl-position-changes-table',
        'table[data-testid*="table"]',
        '.sem-table',
        '.sem-table-container table',
        '.positions-table',
        '.organic-research-table',
        'table[class*="table"]',
        'table',
        '[role="table"]',
        '.table-container table',
        '.data-table',
        '.results-table'
      ];
      
      for (const selector of tableSelectors) {
        const table = document.querySelector(selector);
        if (table) {
          // Check if table has data rows
          const hasDataRows = table.querySelector('[data-at="table-row"]') || 
                            table.querySelector('tbody tr') ||
                            table.querySelector('tr:not(:first-child)') ||
                            table.querySelector('.sem-table-row');
          
          if (hasDataRows) {
            console.log(`Found table with data using selector: ${selector}`);
            return table;
          }
        }
      }
      
      // Also check for any element containing keyword data
      const keywordElements = document.querySelectorAll('*');
      for (const el of keywordElements) {
        if (el.textContent && (el.textContent.includes('prayer times toronto') || 
                              el.textContent.includes('maghrib time mississauga') ||
                              el.textContent.includes('prayer time montreal'))) {
          console.log('Found element with keyword data:', el);
          const parentTable = el.closest('table');
          if (parentTable) {
            console.log('Found table containing keyword data:', parentTable);
            return parentTable;
          }
        }
      }
      
      // Check for any element that looks like a table structure
      const possibleTables = document.querySelectorAll('div[class*="table"], div[class*="grid"], div[class*="list"]');
      for (const possibleTable of possibleTables) {
        if (possibleTable.textContent && possibleTable.textContent.includes('prayer times')) {
          console.log('Found div with table-like structure containing keywords:', possibleTable);
          return possibleTable;
        }
      }
      
      await sleep(1000); // Increased wait time
    }
    
    console.log('Table timeout reached');
    return null;
  }

  function findSearchBox(){
    // Primary: SEMrush search bar
    const direct = document.querySelector('input[data-test="searchbar_input"]');
    if (direct) return direct;
    // Fallback heuristic if classes change
    const candidates = Array.from(document.querySelectorAll('input[type="search"], input[type="text"]'));
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return candidates.find(isVisible) || null;
  }

  async function ensureSearch(site){
    // Use the page search box and click the Search button; do not reload.
    const input = findSearchBox();
    if (input){
      input.focus();
      // Clear existing value
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Set new value
      input.value = site;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      // NEW CODE START: Select "Exact URL" from search type dropdown
      await sleep(500);
      const searchTypeBtn = document.querySelector('button[data-test="searchbar_searchtype_trigger"]');
      if (searchTypeBtn) {
        console.log('Clicking search type dropdown...');
        searchTypeBtn.click();
        await sleep(800); // Wait for dropdown to open
        
        // Find and click "Exact URL" option
        const dropdownOptions = document.querySelectorAll('[data-ui-name="Select.Option"], [role="option"], div[data-at="select-option"], [class*="Option"]');
        for (const option of dropdownOptions) {
          const text = (option.textContent || '').trim().toLowerCase();
          if (text.includes('exact url') || text === 'exact url') {
            console.log('Selecting "Exact URL" option...');
            option.click();
            await sleep(500);
            break;
          }
        }
      }
      // NEW CODE END
      
      // Click the dedicated search submit if available
      const btn = document.querySelector('[data-test="searchbar_search_submit"]');
      if (btn){
        btn.click();
      } else {
        // Enter fallback
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      await sleep(1200);
      return true;
    }
    return false;
  }

  async function selectTopCountry(){
    console.log('Attempting to select top country...');
    
    // Use the same selector as clickCountrySelector
    const selector = 'button[data-ui-name="Select.Trigger"][aria-haspopup="listbox"]';
    const el = document.querySelector(selector);
    
    if (el) {
      console.log('Clicking country selector...');
      el.click();
      await sleep(900); // Wait for dropdown to appear (faster)
      
      // Use the same selector as getCountryElements
      const countryOptionSelector = 'div[data-ui-name="Select.Option"][data-at="db-option"]';
      const countries = document.querySelectorAll(countryOptionSelector);
      
      if (countries.length > 0) {
        const firstCountry = countries[0];
        const nameEl = firstCountry.querySelector('[data-ui-name="Box"]');
        const countryName = nameEl ? nameEl.textContent.trim() : 'Unknown';
        console.log(`Selecting first country: ${countryName}`);
        firstCountry.click();
        await sleep(1200); // Wait for data to load (faster)
        return countryName; // Return the country name
      }
    }
    
    console.log('Could not find country selector');
    return null;
  }

  function checkForErrors(){
    const errorMessages = [
      'Something went wrong',
      'We are aware of the issue',
      'Please try again later',
      'Error loading data',
      'Service temporarily unavailable',
      'No data available',
      'Unable to load results',
      'We couldn\'t find any data related to your request in the Google top 100'
    ];
    
    const pageText = document.body.textContent || '';
    const detectedError = errorMessages.find(msg => pageText.includes(msg));
    
    if (detectedError) {
      console.log(`Error detected: ${detectedError}`);
      // If it's the "no data" message, return special code instead of generic error
      if (detectedError.includes('We couldn\'t find any data related to your request in the Google top 100')) {
        return 'NO_DATA_INTERFACE';
      }
      return detectedError;
    }
    
    // Check for the specific "no data" interface using data attribute
    const noDataTitle = document.querySelector('[data-at="nf-title"]');
    if (noDataTitle) {
      const titleText = noDataTitle.textContent || '';
      if (titleText.includes('We couldn\'t find any data') || 
          titleText.includes('Nothing found') ||
          titleText.includes('We couldn\'t find any data related to your request in the Google top 100')) {
        console.log('No data interface detected via data-at attribute');
        return 'NO_DATA_INTERFACE';
      }
    }
    
    // Check for the specific "no data" interfaces including "Nothing found" and "We couldn't find"
    const noDataElements = document.querySelectorAll('*');
    for (const element of noDataElements) {
      const text = element.textContent || '';
      if (
        text.includes('We couldn\'t find any data related to your request in the Google top 100') ||
        text.includes('Nothing found') ||
        text.includes('We have no data. Try to select a different time period') ||
        text.includes('View historical data')
      ) {
        console.log('No data interface detected - will handle appropriately based on context');
        return 'NO_DATA_INTERFACE';
      }
    }
    
    // Check for empty table with error indicators
    const table = document.querySelector('#cl-position-changes-table') || document.querySelector('table');
    if (table) {
      const rows = table.querySelectorAll('[data-at="table-row"], tbody tr');
      if (rows.length === 0) {
        // Check if there's an error message within the table area
        const tableArea = table.closest('.sem-table-container') || table.parentElement;
        if (tableArea && tableArea.textContent.includes('Something went wrong')) {
          return 'Table area shows error message';
        }
      }
    }
    
    return null;
  }

  function scrapeRows(countryName = 'Unknown', hasHighVolumeKeywords = false) {
    const rows = [];
    
    // Check for errors before scraping
    const error = checkForErrors();
    if (error) {
      console.log(`Skipping scrape due to error: ${error}`);
      chrome.runtime.sendMessage({ 
        type: 'SCRAPE_ERROR', 
        site: getSiteFromUrl(),
        error: `Page error detected: ${error}`
      });
      return rows;
    }
    
    // First try to find the scroll container and ensure it's visible
    const scrollContainer = document.querySelector('#igc-ui-kit-rb5n-scroll-container');
    if (scrollContainer) {
      // Scroll to top to ensure we capture all data
      scrollContainer.scrollTop = 0;
    }
    
    // Try multiple table selectors - including Positions page specific ones
    const tableSelectors = [
      '#cl-position-changes-table',
      'table[data-testid*="table"]',
      '.sem-table',
      '.sem-table-container table',
      '.positions-table',
      '.organic-research-table',
      'table[class*="table"]',
      'table',
      '[role="table"]',
      '.table-container table',
      '.data-table',
      '.results-table'
    ];
    
    let table = null;
    for (const selector of tableSelectors) {
      table = document.querySelector(selector);
      if (table) {
        console.log(`Found table with selector: ${selector}`);
        break;
      }
    }
    
    if (!table) {
      console.log('No table found with any selector');
      
      // Try to find table by looking for specific content
      const keywordElements = document.querySelectorAll('*');
      for (const el of keywordElements) {
        if (el.textContent && el.textContent.includes('prayer times burlington ontario')) {
          console.log('Found element with keyword content:', el);
          const parentTable = el.closest('table');
          if (parentTable) {
            console.log('Found table containing keyword:', parentTable);
            table = parentTable;
            break;
          }
        }
      }
      
      if (!table) {
        console.log('Still no table found, trying to find any element with table-like structure');
        // Look for any element that might contain tabular data
        const possibleTables = document.querySelectorAll('div[role="table"], div[class*="table"], div[class*="grid"]');
        if (possibleTables.length > 0) {
          console.log(`Found ${possibleTables.length} possible table-like elements`);
          // Use the first one as a fallback
          table = possibleTables[0];
        }
      }
    }
    
    if (!table) {
      console.log('No table found at all');
      return rows;
    }

    // Custom extraction for SEMrush React table structure
    const rowNodes = table.querySelectorAll('[data-at="table-row"]');
    rowNodes.forEach((row, rowIndex) => {
      // Keyword
      let keyword = '';
      const kwEl = row.querySelector('[name="phrase"] a[data-at="display-keyword"] span');
      if (kwEl) keyword = kwEl.textContent.trim();

      // Volume
      let volume = '';
      const volEl = row.querySelector('[name="volume"] [data-at="display-number"]');
      if (volEl) volume = volEl.textContent.trim();
      
      // Parse volume to number for comparison
      const volumeNum = parseVolumeToNumber(volume);

      // Traffic
      let traffic = '';
      const trafEl = row.querySelector('[name="traffic"] [data-at="display-number"]');
      if (trafEl) traffic = trafEl.textContent.trim();

      // Traffic Percent
      let trafficPercent = '';
      const trafPctEl = row.querySelector('[name="trafficPercent"] [data-ui-name="Box"]');
      if (trafPctEl) trafficPercent = trafPctEl.textContent.trim();

      // URL
      let url = '';
      const urlEl = row.querySelector('[name="url"] a[href^="http"]');
      if (urlEl) url = urlEl.getAttribute('href');

      // Filter based on volume threshold
      // If country has high-volume keywords, only include those with volume >= 5.4k
      // If country doesn't have high-volume keywords, include all (since we're only scraping first page)
      if (keyword) {
        if (hasHighVolumeKeywords && volumeNum < 5400) {
          // Skip this keyword as it doesn't meet the volume threshold
          return;
        }
        
        rows.push({
          country: countryName,
          keyword,
          volume: volume || 'N/A',
          traffic: traffic || 'N/A',
          trafficPercent: trafficPercent || 'N/A',
          url: url || 'N/A'
        });
      }
    });
    console.log(`Custom extracted ${rows.length} rows from SEMrush table (filtered by volume: ${hasHighVolumeKeywords ? '>= 5.4k' : 'all'})`);
    return rows;
  }

  async function clickNext(){
    // Try common next/pagination selectors
    const candidates = [
      '#cl-position-table > nav > button.___SNextPage_q4z02-red-team.___SButton_nfevg-red-team._size_m_nfevg-red-team._theme_primary-info_nfevg-red-team',
      'button[aria-label="Next"]',
      'a[aria-label="Next"]',
      '.sem-paginator__next',
      'button:has(svg[aria-label="Next"])',
      '[data-testid="pagination-next"]',
      '.pagination-next'
      // Removed all :contains("Next") selectors
    ];
    
    for (const sel of candidates){
      const el = document.querySelector(sel);
      if (el && !el.disabled && !el.classList.contains('disabled')){
        // Scroll to the pagination button to ensure it's clickable
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        el.click(); 
        return true;
      }
    }
    
    // If no next button found, try scrolling within the container to load more data
    const scrollContainer = document.querySelector('#igc-ui-kit-rb5n-scroll-container');
    if (scrollContainer) {
      const currentScrollTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await sleep(1000);
      
      // Check if new content loaded
      if (scrollContainer.scrollTop > currentScrollTop) {
        return true; // New content loaded
      }
    }
    
    return false;
  }

  function debugTableStructure(){
    console.log('=== DEBUGGING TABLE STRUCTURE ===');
    
    // Check for any tables on the page
    const allTables = document.querySelectorAll('table');
    console.log(`Found ${allTables.length} tables on page`);
    
    allTables.forEach((table, index) => {
      console.log(`Table ${index}:`, table);
      console.log(`Table ${index} classes:`, table.className);
      console.log(`Table ${index} id:`, table.id);
      
      const rows = table.querySelectorAll('tr');
      console.log(`Table ${index} has ${rows.length} rows`);
      
      if (rows.length > 0) {
        const firstRow = rows[0];
        const cells = firstRow.querySelectorAll('td, th');
        console.log(`Table ${index} first row has ${cells.length} cells`);
        
        cells.forEach((cell, cellIndex) => {
          console.log(`Table ${index} cell ${cellIndex}: "${cell.textContent.trim()}"`);
        });
      }
    });
    
    // Check for specific SEMrush elements
    const semrushElements = document.querySelectorAll('[data-at], [data-testid], .sem-');
    console.log(`Found ${semrushElements.length} SEMrush-specific elements`);
    
    console.log('=== END DEBUG ===');
  }

  async function run(){
    const site = getSiteFromUrl();
    console.log(`Starting scrape for site: ${site}`);
    
    // Debug table structure
    debugTableStructure();
    
    // Check for errors immediately
    const initialError = checkForErrors();
    if (initialError) {
      if (initialError === 'NO_DATA_INTERFACE') {
        console.log('No data interface detected after search - selecting top country...');
        const countrySelected = await selectTopCountry();
        if (countrySelected) {
          // Wait for page to reload and try again
          await sleep(3000);
          // Re-check for errors after country selection
          const postCountryError = checkForErrors();
          if (postCountryError && postCountryError !== 'NO_DATA_INTERFACE') {
            chrome.runtime.sendMessage({ 
              type: 'SCRAPE_ERROR', 
              site, 
              error: `Error after country selection: ${postCountryError}` 
            });
            return;
          }
        } else {
          chrome.runtime.sendMessage({ 
            type: 'SCRAPE_ERROR', 
            site, 
            error: 'Could not select top country' 
          });
          return;
        }
      } else {
        chrome.runtime.sendMessage({ 
          type: 'SCRAPE_ERROR', 
          site, 
          error: `Initial error detected: ${initialError}` 
        });
        return;
      }
    }
    
    // ensure page is ready; trigger search if needed
    await ensureSearch(site);
    
    // Check for errors after search
    const postSearchError = checkForErrors();
    let firstCountryAlreadySelected = null;
    if (postSearchError) {
      if (postSearchError === 'NO_DATA_INTERFACE') {
        console.log('No data interface detected after search (including "We couldn\'t find any data") - selecting top country...');
        const selectedCountry = await selectTopCountry();
        if (selectedCountry) {
          firstCountryAlreadySelected = selectedCountry;
          console.log(`Successfully selected country: ${selectedCountry}`);
          // Wait for table to load after country selection
          await sleep(1000);
        } else {
          chrome.runtime.sendMessage({ type: 'SCRAPE_ERROR', site, error: 'Could not select top country after search' });
          return;
        }
      } else {
        chrome.runtime.sendMessage({ 
          type: 'SCRAPE_ERROR', 
          site, 
          error: `Error after search: ${postSearchError}` 
        });
        return;
      }
    }
    
    let table = await waitForTable(45000);
    if (!table && !firstCountryAlreadySelected){
      // If this is the no-data interface and we haven't already selected a country, pick the top country
      const maybeNoData = checkForErrors();
      if (maybeNoData === 'NO_DATA_INTERFACE') {
        chrome.runtime.sendMessage({ type: 'LOG', message: 'No data interface detected. Selecting top country…' });
        const selectedCountry = await selectTopCountry();
        if (selectedCountry) {
          firstCountryAlreadySelected = selectedCountry;
          await sleep(2000);
          table = await waitForTable(15000);
        }
      }
    }

    // If we selected a country due to "Nothing found", log and continue
    if (firstCountryAlreadySelected && table) {
      chrome.runtime.sendMessage({ type: 'LOG', message: `Starting scrape with auto-selected country: ${firstCountryAlreadySelected}` });
    }

    let all = [];
    const scrapedCountries = new Set();
    let countryIndex = 0;
    const MAX_COUNTRIES = 20; // Only scrape top 20 countries
    
    // UPDATED COUNTRY LOOP SECTION - for automatic iteration through ALL countries
    while (countryIndex < MAX_COUNTRIES) { // Loop through top 20 countries only
      // CHECK FOR STOP - ADD THIS CHECK AT START OF LOOP
      if (shouldStop) {
        console.log('Scraping stopped by user');
        chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
        return;
      }
      
      // If we already scraped the first country, skip selector and scrape current view
      if (countryIndex === 0 && firstCountryAlreadySelected) {
        console.log(`Scraping already-selected country: ${firstCountryAlreadySelected}`);
        
        // Check criteria before scraping
        const criteria = await checkCountryCriteria();
        if (!criteria.meets) {
          console.log(`Country ${firstCountryAlreadySelected} does not meet criteria (Keywords: ${criteria.keywordsCount}, Traffic: ${criteria.trafficCount}). Skipping...`);
          countryIndex++;
          continue;
        }
        
        scrapedCountries.add(firstCountryAlreadySelected);
        chrome.runtime.sendMessage({ type: 'COUNTRY_PROGRESS', site, countryCount: scrapedCountries.size });
        
        let pageCount = 0;
        while (true) {
          // CHECK FOR STOP - ADD THIS CHECK AT START OF PAGE LOOP
          if (shouldStop) {
            console.log('Scraping stopped by user during page scraping');
            chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
            return;
          }
          
          await sleep(800);
          const pageError = checkForErrors();
          if (pageError) {
            if (pageError === 'NO_DATA_INTERFACE') {
              console.log(`No data interface for ${firstCountryAlreadySelected} - skipping to next country`);
              break;
            } else {
              console.log(`Error on page ${pageCount + 1} for ${firstCountryAlreadySelected}: ${pageError}`);
              break;
            }
          }
          let currentRows = scrapeRows(firstCountryAlreadySelected, criteria.hasHighVolumeKeywords);
          if (currentRows.length > 0) {
            all = all.concat(currentRows);
            pageCount++;
            
            // Check if we should continue to next page based on keyword volume
            // If this is the first page and the country doesn't have high volume keywords, stop here
            if (pageCount === 1 && !criteria.hasHighVolumeKeywords) {
              console.log(`Country ${firstCountryAlreadySelected} has no keywords with 5.4k+ volume. Only scraping first page.`);
              break;
            }
            
            const moved = await clickNext();
            if (!moved) {
              console.log(`No more pages for ${firstCountryAlreadySelected}`);
              break;
            }
            await sleep(1500);
            if (!await waitForTable(10000)) {
              console.log(`Failed to load next page table for ${firstCountryAlreadySelected}`);
              break;
            }
          } else {
            break;
          }
        }
        
        // SEND DATA IMMEDIATELY AFTER EACH COUNTRY - ADD THIS SECTION
        if (all.length > 0 && !shouldStop) {
          console.log(`Sending ${all.length} rows for ${firstCountryAlreadySelected} to background`);
          const currentCity = new URLSearchParams(location.search).get('city') || 'Unknown';
          chrome.runtime.sendMessage({ 
            type: 'SCRAPE_RESULT', 
            site, 
            city: currentCity, 
            rows: all,
            isPartial: true, // ADD THIS FLAG
            countryName: firstCountryAlreadySelected // ADD THIS
          });
          all = []; // CLEAR THE ARRAY AFTER SENDING
          await sleep(2000); // Wait for CSV download to complete
        }
        
        countryIndex++;
        continue; // UPDATED: Continue to next country after finishing first one
      }
      
      // Open country selector dropdown
      if (!await clickCountrySelector()) {
        console.log(`Could not open country selector on iteration ${countryIndex}. Stopping country scrape.`);
        break;
      }
      
      console.log(`Country selector clicked successfully, getting country elements...`);
      const countryElements = await getCountryElements();
      console.log(`Retrieved ${countryElements.length} country elements in order`);
      
      // UPDATED: Get country at countryIndex position (top to bottom order)
      if (countryIndex >= countryElements.length) {
        console.log(`Reached end of country list at index ${countryIndex}. Total countries processed: ${scrapedCountries.size}`);
        console.log('Already scraped countries:', Array.from(scrapedCountries));
        break;
      }
      
      const currentCountryElement = countryElements[countryIndex];
      const countryName = getCountryName(currentCountryElement);
      
      console.log(`[Country ${countryIndex + 1}/${countryElements.length}] Processing country: ${countryName}`);
      
      // Click the country to change the view
      currentCountryElement.click();
      await sleep(3000); // Wait for data to reload
      
      // Check criteria BEFORE scraping
      const criteria = await checkCountryCriteria();
      console.log(`Country ${countryName} - Keywords: ${criteria.keywordsCount}, Traffic: ${criteria.trafficCount}, HasHighVolumeKeywords: ${criteria.hasHighVolumeKeywords}`);
      
      console.log(`Processing country: ${countryName}`);
      scrapedCountries.add(countryName);
      chrome.runtime.sendMessage({ type: 'COUNTRY_PROGRESS', site, countryCount: scrapedCountries.size });

      let pageCount = 0;
      while (true) {
        // CHECK FOR STOP - ADD THIS CHECK AT START OF PAGE LOOP
        if (shouldStop) {
          console.log('Scraping stopped by user during page scraping');
          chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
          return;
        }
        
        await sleep(800);
        const pageError = checkForErrors();
        if (pageError) {
          if (pageError === 'NO_DATA_INTERFACE') {
            console.log(`No data interface for ${countryName} - skipping to next country`);
            break;
          } else {
            console.log(`Error on page ${pageCount + 1} for ${countryName}: ${pageError}`);
            break;
          }
        }
        
        let currentRows = scrapeRows(countryName, criteria.hasHighVolumeKeywords);
        if (currentRows.length > 0) {
          all = all.concat(currentRows);
          pageCount++;
          
          // Check if we should continue to next page based on keyword volume
          // If this is the first page and the country doesn't have high volume keywords, stop here
          if (pageCount === 1 && !criteria.hasHighVolumeKeywords) {
            console.log(`Country ${countryName} has no keywords with 5.4k+ volume. Only scraping first page.`);
            break;
          }
          
          const moved = await clickNext();
          if (!moved) {
            console.log(`No more pages for ${countryName}`);
            break;
          }
          await sleep(1500);
          if (!await waitForTable(10000)) {
            console.log(`Failed to load next page table for ${countryName}`);
            break;
          }
        } else {
          break;
        }
      }
      
      // SEND DATA IMMEDIATELY AFTER EACH COUNTRY - ADD THIS SECTION
      if (all.length > 0 && !shouldStop) {
        console.log(`Sending ${all.length} rows for ${countryName} to background`);
        const currentCity = new URLSearchParams(location.search).get('city') || 'Unknown';
        chrome.runtime.sendMessage({ 
          type: 'SCRAPE_RESULT', 
          site, 
          city: currentCity, 
          rows: all,
          isPartial: true, // ADD THIS FLAG
          countryName: countryName // ADD THIS
        });
        all = []; // CLEAR THE ARRAY AFTER SENDING
        await sleep(2000); // Wait for CSV download to complete
      }
      
      countryIndex++;
    }

    console.log(`Total scraped: ${all.length} rows for ${site}`);
    const currentCity = new URLSearchParams(location.search).get('city') || 'Unknown';
    chrome.runtime.sendMessage({ type: 'SCRAPE_COMPLETE', site, city: currentCity });
  }

  // Listen for controlled runs from background. Also auto-run once on page load.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'RUN_SCRAPE' && msg.site){
      shouldStop = false; // RESET FLAG - ADD THIS LINE
      const scrapedCity = msg.city || 'Unknown'; // Get city from message
      ensureSearch(msg.site).then(async () => {
        console.log(`Controlled scrape for site: ${msg.site}`);
        
        // Check for errors after search
        const postSearchError = checkForErrors();
        let firstCountryAlreadySelected = null;
        if (postSearchError) {
          if (postSearchError === 'NO_DATA_INTERFACE') {
            console.log('No data interface (including "We couldn\'t find any data") in controlled run - selecting top country...');
            const selectedCountry = await selectTopCountry();
            if (selectedCountry) {
              firstCountryAlreadySelected = selectedCountry;
              await sleep(2000);
            } else {
              chrome.runtime.sendMessage({ type: 'SCRAPE_ERROR', site: msg.site, error: 'Could not select top country' });
              return;
            }
          } else {
            chrome.runtime.sendMessage({ 
              type: 'SCRAPE_ERROR', 
              site: msg.site, 
              error: `Error after search: ${postSearchError}` 
            });
            return;
          }
        }
        
        await sleep(800);
        let table = await waitForTable(45000);
        if (!table && !firstCountryAlreadySelected) {
          const maybeNoData = checkForErrors();
          if (maybeNoData === 'NO_DATA_INTERFACE') {
            chrome.runtime.sendMessage({ type: 'LOG', message: 'No data interface in controlled run. Selecting top country…' });
            const selectedCountry = await selectTopCountry();
            if (selectedCountry) {
              firstCountryAlreadySelected = selectedCountry;
              await sleep(2000);
              table = await waitForTable(15000);
            }
          }
        }
        if (!table) {
          chrome.runtime.sendMessage({ type: 'LOG', message: 'Proceeding to country loop without initial table (controlled run).' });
        }

        let all = [];
        const scrapedCountries = new Set();
        let countryIndex = 0;
        const MAX_COUNTRIES = 20; // Only scrape top 20 countries
        
        // UPDATED COUNTRY LOOP SECTION - for automatic iteration through ALL countries
        while (countryIndex < MAX_COUNTRIES) { // Loop through top 20 countries only
          // ADD STOP CHECK
          if (shouldStop) {
            console.log('Controlled scraping stopped by user');
            chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
            return;
          }
          
          // If we already scraped the first country, skip selector and scrape current view
          if (countryIndex === 0 && firstCountryAlreadySelected) {
            console.log(`Controlled scrape - scraping already-selected country: ${firstCountryAlreadySelected}`);
            
            // Check criteria before scraping
            const criteria = await checkCountryCriteria();
            console.log(`Country ${firstCountryAlreadySelected} - Keywords: ${criteria.keywordsCount}, Traffic: ${criteria.trafficCount}, HasHighVolumeKeywords: ${criteria.hasHighVolumeKeywords}`);
            
            scrapedCountries.add(firstCountryAlreadySelected);
            chrome.runtime.sendMessage({ type: 'COUNTRY_PROGRESS', site: msg.site, countryCount: scrapedCountries.size });
            
            let pageCount = 0;
            while (true) {
              // ADD STOP CHECK
              if (shouldStop) {
                console.log('Controlled scraping stopped by user during page scraping');
                chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
                return;
              }
              
              await sleep(800);
              const pageError = checkForErrors();
              if (pageError) {
                if (pageError === 'NO_DATA_INTERFACE') {
                  console.log(`No data interface for ${firstCountryAlreadySelected} - skipping to next country`);
                  break;
                } else {
                  console.log(`Error on page ${pageCount + 1} for ${firstCountryAlreadySelected}: ${pageError}`);
                  break;
                }
              }
              let currentRows = scrapeRows(firstCountryAlreadySelected, criteria.hasHighVolumeKeywords);
              if (currentRows.length > 0) {
                all = all.concat(currentRows);
                pageCount++;
                
                // Check if we should continue to next page based on keyword volume
                // If this is the first page and the country doesn't have high volume keywords, stop here
                if (pageCount === 1 && !criteria.hasHighVolumeKeywords) {
                  console.log(`Country ${firstCountryAlreadySelected} has no keywords with 5.4k+ volume. Only scraping first page.`);
                  break;
                }
                
                const moved = await clickNext();
                if (!moved) {
                  console.log(`No more pages for ${firstCountryAlreadySelected}`);
                  break;
                }
                await sleep(1500);
                if (!await waitForTable(10000)) {
                  console.log(`Failed to load next page table for ${firstCountryAlreadySelected}`);
                  break;
                }
              } else {
                break;
              }
            }
            
            // SEND DATA IMMEDIATELY AFTER EACH COUNTRY
            if (all.length > 0 && !shouldStop) {
              console.log(`Controlled scrape - Sending ${all.length} rows for ${firstCountryAlreadySelected} to background`);
              chrome.runtime.sendMessage({ 
                type: 'SCRAPE_RESULT', 
                site: msg.site, 
                city: scrapedCity, 
                rows: all,
                isPartial: true,
                countryName: firstCountryAlreadySelected
              });
              all = [];
              await sleep(2000);
            }
            
            countryIndex++;
            continue; // UPDATED: Continue to next country after finishing first one
          }
          
          // Open country selector dropdown
          if (!await clickCountrySelector()) {
            console.log(`Could not open country selector on iteration ${countryIndex}. Stopping country scrape.`);
            break;
          }
          
          console.log(`Controlled scrape - Country selector clicked successfully, getting country elements...`);
          const countryElements = await getCountryElements();
          console.log(`Controlled scrape - Retrieved ${countryElements.length} country elements in order`);
          
          // UPDATED: Get country at countryIndex position (top to bottom order)
          if (countryIndex >= countryElements.length) {
            console.log(`Reached end of country list at index ${countryIndex}. Total countries processed: ${scrapedCountries.size}`);
            console.log('Controlled scrape - Already scraped countries:', Array.from(scrapedCountries));
            break;
          }
          
          const currentCountryElement = countryElements[countryIndex];
          const countryName = getCountryName(currentCountryElement);
          
          console.log(`Controlled scrape - [Country ${countryIndex + 1}/${countryElements.length}] Processing country: ${countryName}`);
          
          // Click the country to change the view
          currentCountryElement.click();
          await sleep(3000); // Wait for data to reload
          
          // Check criteria BEFORE scraping
          const criteria = await checkCountryCriteria();
          console.log(`Country ${countryName} - Keywords: ${criteria.keywordsCount}, Traffic: ${criteria.trafficCount}, HasHighVolumeKeywords: ${criteria.hasHighVolumeKeywords}`);
          
          console.log(`Processing country: ${countryName}`);
          scrapedCountries.add(countryName);
          chrome.runtime.sendMessage({ type: 'COUNTRY_PROGRESS', site: msg.site, countryCount: scrapedCountries.size });
          
          let pageCount = 0;
          while (true) {
            // ADD STOP CHECK
            if (shouldStop) {
              console.log('Controlled scraping stopped by user during page scraping');
              chrome.runtime.sendMessage({ type: 'LOG', message: 'Scraping stopped by user.' });
              return;
            }
            
            await sleep(800);
            const pageError = checkForErrors();
            if (pageError) {
              if (pageError === 'NO_DATA_INTERFACE') {
                console.log(`No data interface for ${countryName} - skipping to next country`);
                break;
              } else {
                console.log(`Error on page ${pageCount + 1} for ${countryName}: ${pageError}`);
                break;
              }
            }
            let currentRows = scrapeRows(countryName, criteria.hasHighVolumeKeywords);
            if (currentRows.length > 0) {
              all = all.concat(currentRows);
              pageCount++;
              
              // Check if we should continue to next page based on keyword volume
              // If this is the first page and the country doesn't have high volume keywords, stop here
              if (pageCount === 1 && !criteria.hasHighVolumeKeywords) {
                console.log(`Country ${countryName} has no keywords with 5.4k+ volume. Only scraping first page.`);
                break;
              }
              
              const moved = await clickNext();
              if (!moved) {
                console.log(`No more pages for ${countryName}`);
                break;
              }
              await sleep(1500);
              if (!await waitForTable(10000)) {
                console.log(`Failed to load next page table for ${countryName}`);
                break;
              }
            } else {
              break;
            }
          }
          
          // SEND DATA IMMEDIATELY AFTER EACH COUNTRY
          if (all.length > 0 && !shouldStop) {
            console.log(`Controlled scrape - Sending ${all.length} rows for ${countryName} to background`);
            chrome.runtime.sendMessage({ 
              type: 'SCRAPE_RESULT', 
              site: msg.site, 
              city: scrapedCity, 
              rows: all,
              isPartial: true,
              countryName: countryName
            });
            all = [];
            await sleep(2000);
          }
          
          countryIndex++;
        }

        console.log(`Controlled scrape completed for ${msg.site}`);
        chrome.runtime.sendMessage({ 
          type: 'SCRAPE_COMPLETE', 
          site: msg.site, 
          city: scrapedCity 
        });
      });
    }
  });

  async function clickCountrySelector() {
    console.log('Attempting to click country selector...');
    
    // Try multiple selectors to find the country selector button
    const selectors = [
      'button[data-ui-name="Select.Trigger"][aria-haspopup="listbox"]',
      'button[aria-haspopup="listbox"]',
      '.country-selector button',
      '[data-at="country-selector"]'
    ];
    
    let el = null;
    for (const selector of selectors) {
      el = document.querySelector(selector);
      if (el) {
        console.log(`Found country selector using: ${selector}`);
        break;
      }
    }
    
    if (el) {
      console.log('Clicking country selector...');
      el.click();
      await sleep(1200); // Wait for dropdown to appear and stabilize
      console.log('Country selector clicked.');
      return true;
    }
    
    console.log('Country selector not found with any selector. Debugging DOM...');
    const buttons = document.querySelectorAll('button');
    console.log(`Found ${buttons.length} buttons on page`);
    buttons.forEach((btn, index) => {
      if (index < 5) {
        console.log(`Button ${index}:`, btn.outerHTML.substring(0, 100));
      }
    });
    
    return false;
  }

  async function getCountryElements() {
    // Wait for the dropdown container to be fully visible
    await sleep(800);
    
    // UPDATED: Use the popper container ID that holds all country options
    const popperContainer = document.querySelector('#igc-ui-kit-r2co-popper');
    
    let countries = [];
    
    if (popperContainer) {
      console.log('Found popper container, extracting country options...');
      // Find all country option elements within the popper
      const selectors = [
        'div[data-ui-name="Select.Option"][data-at="db-option"]',
        'div[data-ui-name="Select.Option"]',
        'div[role="option"]',
        'div[data-at="select-option"]'
      ];
      
      for (const selector of selectors) {
        countries = Array.from(popperContainer.querySelectorAll(selector));
        if (countries.length > 0) {
          console.log(`Found ${countries.length} country elements in popper using selector: ${selector}`);
          break;
        }
      }
    }
    
    // Fallback: search entire document if popper approach fails
    if (countries.length === 0) {
      console.log('Popper container search yielded no results, trying fallback selectors...');
      const fallbackSelectors = [
        'div[data-ui-name="Select.Option"][data-at="db-option"]',
        'div[data-ui-name="Select.Option"]',
        '[role="option"]',
        'div[data-at="select-option"]'
      ];
      
      for (const selector of fallbackSelectors) {
        countries = Array.from(document.querySelectorAll(selector));
        if (countries.length > 0) {
          console.log(`Found ${countries.length} country elements in document using selector: ${selector}`);
          break;
        }
      }
    }
    
    if (countries.length === 0) {
      console.log('No country elements found with any selector. Debugging DOM...');
      const dropdown = document.querySelector('[role="listbox"], [data-ui-name="Select.Content"], #igc-ui-kit-r2co-popper');
      if (dropdown) {
        console.log('Found dropdown container:', dropdown);
        console.log('Dropdown innerHTML:', dropdown.innerHTML.substring(0, 500));
      } else {
        console.log('No dropdown container found');
      }
    }
    
    return countries;
  }

  function getCountryName(countryElement) {
    const nameEl = countryElement.querySelector('[data-ui-name="Box"]');
    return nameEl ? nameEl.textContent.trim() : 'Unknown';
  }

  function parseVolumeToNumber(volume) {
    if (!volume || volume === 'N/A') return 0;
    let v = volume.toString().replace(/,/g, '').toUpperCase();
    if (v.endsWith('K')) v = parseFloat(v) * 1000;
    else v = parseFloat(v);
    return isNaN(v) ? 0 : v;
  }

  // This function checks if current country meets the criteria
  async function checkCountryCriteria() {
    await sleep(1000); // Wait for summary to load
    
    // Get Keywords count
    let keywordsCount = 0;
    const keywordsSummary = document.querySelector('[data-at="summary-keywords"] [data-at="summary-value"]');
    if (keywordsSummary) {
      const keywordsText = keywordsSummary.textContent.trim().replace(/,/g, '');
      keywordsCount = parseInt(keywordsText) || 0;
    }
    
    // Get Traffic count
    let trafficCount = 0;
    const trafficSummary = document.querySelector('[data-at="summary-traffic"] [data-at="summary-value"]');
    if (trafficSummary) {
      const trafficText = trafficSummary.textContent.trim().replace(/,/g, '');
      trafficCount = parseInt(trafficText) || 0;
    }
    
    // Check if country has high volume keywords (5.4k or above)
    let hasHighVolumeKeywords = false;
    const table = document.querySelector('#cl-position-changes-table') || document.querySelector('table');
    if (table) {
      const rowNodes = table.querySelectorAll('[data-at="table-row"]');
      for (const row of rowNodes) {
        const volEl = row.querySelector('[name="volume"] [data-at="display-number"]');
        if (volEl) {
          const volumeText = volEl.textContent.trim();
          const volume = parseVolumeToNumber(volumeText);
          if (volume >= 5400) {
            hasHighVolumeKeywords = true;
            break;
          }
        }
      }
    }
    
    console.log(`Country criteria check: Keywords=${keywordsCount}, Traffic=${trafficCount}, HasHighVolumeKeywords=${hasHighVolumeKeywords}`);
    
    // Check if meets criteria: Always return true to process all countries
    // We'll use volume-based filtering instead
    return { 
      meets: true, // Always process all countries
      keywordsCount,
      trafficCount,
      hasHighVolumeKeywords
    };
  }

  // Auto-run removed - only use controlled runs via RUN_SCRAPE message
})();

