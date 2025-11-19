let isRunning = false;
let stopRequested = false; // ADD THIS LINE
let queue = [];
let results = [];
let activeTabId = null;
let totalCount = 0;
let completedCount = 0;
let siteStatus = {};
let siteResults = [];
let activeTimeout = null; // Track active safety timeout
let uiState = {
  urls: [],
  progress: { completed: 0, total: 0, percentage: 0 },
  status: 'Idle'
};

// Load scraped data from storage on startup
chrome.storage.local.get(['scrapedData', 'siteStatus', 'uiState', 'settings'], (data) => {
  if (Array.isArray(data.scrapedData)) {
    results = data.scrapedData;
  }
  if (data.siteStatus) {
    siteStatus = data.siteStatus;
  }
  if (data.uiState) {
    uiState = data.uiState;
    totalCount = uiState.progress.total || 0;
    completedCount = uiState.progress.completed || 0;
  }
  // MODIFIED: Prioritize loading URLs from settings over uiState
  if (data.settings && Array.isArray(data.settings.urls)) {
    uiState.urls = data.settings.urls;
    totalCount = uiState.urls.length; // ADD THIS LINE
    uiState.progress.total = totalCount; // ADD THIS LINE
    chrome.storage.local.set({ uiState }); // ADD THIS LINE
    console.log(`[Startup] Loaded ${data.settings.urls.length} URLs from settings`);
  } else if (data.uiState && data.uiState.urls) {
    totalCount = uiState.urls.length; // ADD THIS LINE
    uiState.progress.total = totalCount; // ADD THIS LINE
    console.log(`[Startup] Loaded ${uiState.urls.length} URLs from uiState`);
  } else {
    console.log('[Startup] No URLs found in storage');
  }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Function to load CSV URLs from input.csv.csv
async function loadCsvUrls() {
  try {
    // This would need to be implemented to read the CSV file
    // For now, return empty array as fallback
    return [];
  } catch (error) {
    console.error('Error loading CSV URLs:', error);
    return [];
  }
}

function sendLog(message){
  chrome.runtime.sendMessage({ type: 'LOG', message }).catch(()=>{});
}

function setStatus(status){
  uiState.status = status;
  chrome.storage.local.set({ uiState });
  chrome.runtime.sendMessage({ type: 'STATUS', status }).catch(()=>{});
}

function sendProgress(currentSite = '', countryCount = 0, totalCountries = 0){
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  uiState.progress = { completed: completedCount, total: totalCount, percentage };
  chrome.storage.local.set({ uiState });
  chrome.runtime.sendMessage({ 
    type: 'PROGRESS', 
    completed: completedCount, 
    total: totalCount,
    percentage: percentage
  }).catch(()=>{});
  
  if (isRunning) {
    let badgeText = `${completedCount}/${totalCount}`;
    if (currentSite && countryCount > 0) {
      badgeText = `${countryCount}/${totalCountries}`;
    }
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#007bff' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function triggerScrapeInActiveTab(siteObj, retryCount = 0){
  if (!activeTabId) {
    const [currentActive] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = currentActive?.id || null;
  }
  if (!activeTabId){
    sendLog('No active tab to run scrape. Open the SEMrush Positions tab and try again.');
    return;
  }
  
  const maxRetries = 3;
  sendLog(`Scraping in current tab for: ${siteObj.url || siteObj.keyword} (Keyword: ${siteObj.keyword}) (City: ${siteObj.city}) (attempt ${retryCount + 1}/${maxRetries + 1})`);
  
  // Add safety timeout - if no response in 5 minutes, move to next
  activeTimeout = setTimeout(() => {
    sendLog(`[SAFETY_TIMEOUT] No response for ${siteObj.keyword} after 5 minutes. Moving to next keyword.`);
    completedCount += 1;
    sendProgress();
    siteStatus[siteObj.keyword] = { status: 'timeout', countryCount: 0 };
    chrome.storage.local.set({ siteStatus });
    activeTimeout = null;
    setTimeout(() => startNext(), 2000);
  }, 5 * 60 * 1000); // 5 minutes
  
  try {
    await chrome.tabs.sendMessage(activeTabId, { 
      type: 'RUN_SCRAPE', 
      site: siteObj.url || siteObj.keyword,  // MODIFIED: Use url field for scraping
      keyword: siteObj.keyword,              // ADDED: Keep keyword for reference
      city: siteObj.city 
    });
    
    // Clear timeout on successful message send
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      });
      await sleep(1000);
      await chrome.tabs.sendMessage(activeTabId, { 
        type: 'RUN_SCRAPE', 
        site: siteObj.url || siteObj.keyword,  // MODIFIED: Use url field for scraping
        keyword: siteObj.keyword,              // ADDED: Keep keyword for reference
        city: siteObj.city 
      });
      
      // Clear timeout on successful retry
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
    } catch (err) {
      if (retryCount < maxRetries) {
        sendLog(`Retrying scrape for ${siteObj.keyword} in 2 seconds...`);
        await sleep(2000);
        return triggerScrapeInActiveTab(siteObj, retryCount + 1);
      } else {
        sendLog(`Failed to communicate with the SEMrush tab after ${maxRetries + 1} attempts. Make sure the correct page is open.`);
        // Clear timeout since we're handling the error
        if (activeTimeout) {
          clearTimeout(activeTimeout);
          activeTimeout = null;
        }
        // Still count as completed to avoid getting stuck
        completedCount += 1;
        sendProgress();
        // Mark as error
        siteStatus[siteObj.keyword] = { status: 'error', countryCount: 0 };
        chrome.storage.local.set({ siteStatus });
        setTimeout(() => startNext(), 2000);
      }
    }
  }
}

async function startNext(){
  sendLog(`[startNext] isRunning=${isRunning}, queue.length=${queue.length}`);
  if (!isRunning || stopRequested) { // MODIFY THIS LINE
    if (stopRequested) { // ADD THESE LINES
      sendLog('[startNext] Stop requested by user.');
      stopRequested = false;
    }
    return;
  }
  if (queue.length === 0){
    sendLog('[startNext] Queue empty, finishing run.');
    sendLog('All keywords processed. Preparing CSV...');
    setStatus('Completed');
    sendProgress();
    
    if (results.length > 0) {
      sendLog(`Scraping completed! Found ${results.length} keyword entries.`);
      sendLog('CSV will be downloaded automatically...');
      await exportCSV();
    } else {
      sendLog('No data was collected. Please check your keywords and try again.');
    }
    
    isRunning = false;
    sendProgress();
    return;
  }
  const nextSiteObj = queue.shift();
  sendLog(`[startNext] Processing: ${nextSiteObj.url || nextSiteObj.keyword} (Keyword: ${nextSiteObj.keyword}) (City: ${nextSiteObj.city})`);
  sendProgress(nextSiteObj.keyword, 0, 20); // Changed from 5 to 20 to show progress through all countries
  await triggerScrapeInActiveTab(nextSiteObj);
}async function exportCSV(){
  try {
    if (results.length === 0) {
      sendLog('No data to export. Run the scraper first to collect data.');
      return;
    }

    sendLog(`Exporting ${results.length} rows to CSV...`);
    
    // HEADER FORMAT: Country_name, City, Exact url, Keywords, Volume
    const header = ['Country_name','City','Exact url','Keywords','Volume'];
    const lines = [header.join(',')];
    
    // Group by site, then by country (keep encounter order) and include all countries that meet criteria
    const siteToCountries = {};
    const siteOrder = [];
    results.forEach(row => {
      if (row.country && row.city && row.site && row.keyword) {
        if (!siteToCountries[row.site]) {
          siteToCountries[row.site] = { countryOrder: [], countries: {}, city: row.city };
          siteOrder.push(row.site);
        }
        const siteEntry = siteToCountries[row.site];
        if (!siteEntry.countries[row.country]) {
          siteEntry.countries[row.country] = [];
          siteEntry.countryOrder.push(row.country);
        }
        siteEntry.countries[row.country].push({
          city: row.city,
          keyword: row.keyword,
          volume: row.volume || 'N/A'
        });
      }
    });

    // Emit rows: Country_name and City every row, URL on EVERY row
    siteOrder.forEach(site => {
      const entry = siteToCountries[site];
      const allCountries = entry.countryOrder; // Changed from slice(0, 5) to include all countries
      allCountries.forEach(countryName => {
        const rowsForCountry = entry.countries[countryName];
        rowsForCountry.forEach(r => {
          const safe = [
            countryName,                          // Country_name (every row)
            r.city,                               // City (every row)
            site,                                 // Exact url (EVERY ROW)
            r.keyword,                            // Keywords
            r.volume                              // Volume
          ].map(v => {
            const s = String(v ?? '').replace(/"/g,'""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          });
          lines.push(safe.join(','));
        });
      });
    });
    
    const csvContent = lines.join("\n");
    const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `semrush_export_${timestamp}.csv`;
    
    await chrome.downloads.download({ 
      url, 
      filename, 
      saveAs: false // Auto-download, no dialog
    });
    
    sendLog(`CSV exported successfully: ${filename}`);
    sendLog(`Total rows exported: ${results.length}`);
    
    // Clean up the object URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
  } catch (error) {
    sendLog(`Error exporting CSV: ${error.message}`);
    console.error('CSV export error:', error);
  }
}

async function exportSingleCSV(city, site, rows) {
  try {
    if (!rows || rows.length === 0) return;
    
    const cityFolder = city || 'Unknown';
    sendLog(`Creating folder for city: ${cityFolder}`);
    
    // HEADER FORMAT: Country_name, City, Exact url, Keywords, Volume
    const header = ['Country_name','City','Exact url','Keywords','Volume'];
    const lines = [header.join(',')];
    
    // Group by country to show Country_name only once per country block; City on every row; URL once
    const countries = {};
    const order = [];
    rows.forEach(r => {
      if (r.country && r.keyword) {
        if (!countries[r.country]) {
          countries[r.country] = [];
          order.push(r.country);
        }
        countries[r.country].push({ keyword: r.keyword, volume: r.volume || 'N/A' });
      }
    });

    order.forEach(countryName => { // Changed from slice(0, 5) to include all countries
      countries[countryName].forEach(kw => {
        const safe = [
          countryName,                           // Country_name (every row)
          city || 'Unknown',                     // City (every row)
          site || 'N/A',                         // Exact url (EVERY ROW)
          kw.keyword,                            // Keywords
          kw.volume                               // Volume
        ].map(v => {
          const s = String(v ?? '').replace(/"/g,'""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        });
        lines.push(safe.join(','));
      });
    });
    
    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Sanitize city name for folder creation - remove special chars but keep spaces initially
    let safeCity = (cityFolder || 'Unknown').replace(/[^a-zA-Z0-9_\s-]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!safeCity) safeCity = 'Unknown';
    
    let safeSite = (site || '').replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!safeSite) safeSite = 'site';
    
    // Log intended folder creation under Downloads/output
    sendLog(`Creating folder: output/${safeCity}/`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Folder structure: output/CityName/sitename_timestamp.csv
    const filename = `output/${safeCity}/${safeSite}_${timestamp}.csv`;
    
    sendLog(`Saving to folder: ${safeCity}/`);
    // Browser will create folder automatically in Downloads directory
    // Path will be: Downloads/CityName/sitename_timestamp.csv
    
    // Force auto-download without any user prompt
    await chrome.downloads.download({ 
      url, 
      filename, 
      saveAs: false,
      conflictAction: 'uniquify'
    });
    
    sendLog(`✓ Saved to: output/${safeCity}/${safeSite}_${timestamp}.csv`);
    
    // Clean up the object URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
  } catch (error) {
    sendLog(`Error exporting per-site CSV: ${error.message}`);
    console.error('Per-site CSV export error:', error);
  }
}

async function exportReport(){
  try {
    sendLog('Generating report...');

    // Get all input links from settings
    const { settings } = await chrome.storage.local.get('settings');
    const allSites = Array.isArray(settings?.urls) ? settings.urls : [];

    // Use siteStatus for processed links
    const statusMap = siteStatus || {};
    const header = ['Links', 'Status', 'Country'];
    const lines = [header.join(',')];

    for (const site of allSites) {
      let status = 'Not Started';
      let countryCount = 0;
      let totalCountries = 20; // Changed from 5 to 20 to reflect actual maximum countries processed
      if (statusMap[site]) {
        status = statusMap[site].status === 'complete' ? 'Complete' : 'Error';
        countryCount = statusMap[site].countryCount || 0;
      }
      const countryInfo = `${countryCount}/${totalCountries}`;
      const safe = [site, status, countryInfo].map(v => {
        const s = String(v ?? '').replace(/"/g,'""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });
      lines.push(safe.join(','));
    }

    const csvContent = lines.join("\n");
    const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `semrush_report_${timestamp}.csv`;

    await chrome.downloads.download({ 
      url, 
      filename, 
      saveAs: false
    });

    sendLog(`Report exported successfully: ${filename}`);
    sendLog(`Total sites in report: ${allSites.length}`);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

  } catch (error) {
    sendLog(`Error exporting report: ${error.message}`);
    console.error('Report export error:', error);
  }
}

async function exportGoogleCompetitorsCSV(competitors) {
  try {
    if (competitors.length === 0) {
      sendLog('No Google Competitors data to export.');
      return;
    }
    sendLog(`Exporting ${competitors.length} Google Competitors to CSV...`);
    const header = ['City', 'Competitor URL'];
    const lines = [header.join(',')];
    competitors.forEach(comp => {
      const safe = [comp.city || 'Unknown', comp.url || ''].map(v => {
        const s = String(v ?? '').replace(/"/g,'""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });
      lines.push(safe.join(','));
    });
    const csvContent = lines.join("\n");
    const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `google_competitors_${timestamp}.csv`;
    await chrome.downloads.download({ url, filename, saveAs: false });
    sendLog(`✓ Google Competitors CSV downloaded: ${filename}`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    sendLog(`Error exporting Google Competitors CSV: ${error.message}`);
  }
}

// Google Competitor Scraping Logic (MERGED)
async function performGoogleSearch(keyword) {
  const domains = new Set();
  const googleDomain = "google.com";
  const baseUrl = `https://www.${googleDomain}/search`;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: `${baseUrl}?q=${encodeURIComponent(keyword)}`, active: false });
    await waitForTabLoad(tab.id);
    await ensureGoogleContentScriptInjected(tab.id);
    // Get domains from the first page only (top 10)
    try {
      const results = await sendMessageWithRetry(tab.id, { action: "extractDomains" });
      if (results && results.domains) {
        results.domains.forEach(domain => domains.add(domain));
      }
    } catch (extractError) {}
    await chrome.tabs.remove(tab.id);
    return { success: true, domains: Array.from(domains).slice(0, 10) };
  } catch (error) {
    try { if(tab && tab.id) await chrome.tabs.remove(tab.id); } catch(e){}
    return { success: false, error: error.message };
  }
}
async function waitForTabLoad(tabId, maxRetries=30) {
  for (let i=0; i<maxRetries; i++) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") { await new Promise((r)=>setTimeout(r,1200)); return; }
      await new Promise((r)=>setTimeout(r,350));
    } catch { await new Promise((r)=>setTimeout(r,400)); }
  }
}
async function ensureGoogleContentScriptInjected(tabId, maxRetries=5) {
  for (let i=0; i<maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: "ping" }, { frameId: 0 });
      if (response && response.ready) return;
    } catch (error) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: false }, files: ["google_content.js"] });
        await new Promise((resolve) => setTimeout(resolve, 1400));
        const testResp = await chrome.tabs.sendMessage(tabId, { action: "ping" }, { frameId: 0 });
        if (testResp && testResp.ready) return;
      } catch (injectError) {}
    }
    await new Promise((r)=>setTimeout(r,800));
  }
  throw new Error("Failed to inject google content script");
}
async function sendMessageWithRetry(tabId, message, maxRetries=3) {
  for(let i=0; i<maxRetries; i++) {
    try { return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
    catch (e) { if(i===maxRetries-1) throw e; await new Promise((r)=>setTimeout(r, 1000)); }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_RUN'){
    (async () => {
      const { settings } = await chrome.storage.local.get('settings');
      let startRow = 1;
      if (settings && typeof settings.startRow === 'number' && settings.startRow > 1) {
        startRow = settings.startRow;
      }
      queue = (settings?.urls || [])
        .slice(startRow - 1)
        .map(item => ({
          keyword: item.keyword || item.url || item,
          url: item.url || item.keyword || item,  // ADDED: Include url field
          city: item.city || 'Unknown'
        }));
      totalCount = queue.length;
      completedCount = 0;
      isRunning = true;
      stopRequested = false; // ADD THIS LINE
      setStatus('Running');
      sendProgress();
      // Capture current active tab as the working SEMrush tab
      const [currentActive] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = currentActive?.id || null;
      startNext();
      // Keep URLs in uiState when starting run (don't overwrite if already there)
      if (!uiState.urls || uiState.urls.length === 0) {
        uiState.urls = settings?.urls || [];
      }
      uiState.progress = { completed: 0, total: totalCount, percentage: 0 };
      chrome.storage.local.set({ uiState });
    })();
    return true;
  }
  if (msg.type === 'STOP_RUN'){
    isRunning = false;
    stopRequested = true; // ADD THIS LINE
    setStatus('Stopped');
    // Notify content script to stop
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP_SCRAPING' }).catch(()=>{});
    }
  }
  if (msg.type === 'SCRAPE_RESULT'){
    (async () => {
      const site = msg.site;
      const city = msg.city || 'Unknown';
      const isPartial = msg.isPartial || false; // ADD THIS LINE
      const countryName = msg.countryName || 'Unknown'; // ADD THIS LINE
      
      // Don't clear siteResults for partial updates - MODIFY THIS SECTION
      if (!isPartial) {
        siteResults = [];
      }
      
      if (Array.isArray(msg.rows)) {
        msg.rows.forEach(r => {
          const rowWithSite = { site, city, ...r };
          results.push(rowWithSite);
          siteResults.push(rowWithSite);
        });
      }
      chrome.storage.local.set({ scrapedData: results });
      const sampleData = results.slice(-5);
      chrome.runtime.sendMessage({ 
        type: 'DATA_UPDATE', 
        count: results.length, 
        sample: sampleData 
      }).catch(() => {});

      // Export per-country CSV immediately
      if (siteResults.length > 0) {
        sendLog(`Downloading CSV for ${site} - ${countryName} (City: ${city})...`); // MODIFY THIS LINE
        await exportSingleCSV(city, site, siteResults);
        sendLog(`CSV download complete for ${site} - ${countryName}`); // MODIFY THIS LINE
        const countryCount = new Set(siteResults.map(r => r.country)).size;
        
        // Only update status if not partial (final update) - MODIFY THIS SECTION
        if (!isPartial) {
          if (siteResults.length > 0) {
            siteStatus[site] = { status: 'complete', countryCount };
          } else {
            siteStatus[site] = { status: 'error', countryCount: 0 };
          }
          chrome.storage.local.set({ siteStatus });
          chrome.runtime.sendMessage({ 
            type: 'SITE_STATUS', 
            site, 
            status: siteStatus[site].status, 
            countryCount: siteStatus[site].countryCount 
          }).catch(()=>{});
        }
      }

      // Only proceed to next if not partial - MODIFY THIS SECTION
      if (!isPartial) {
        completedCount += 1;
        sendProgress();
        sendLog(`[SCRAPE_RESULT] Completed for ${site}. Calling startNext in 1s...`);
        siteResults = [];
        setTimeout(() => startNext(), 1000);
      } else {
        // For partial updates, clear siteResults after export
        siteResults = [];
      }
    })();
    return true;
  }
  if (msg.type === 'SCRAPE_COMPLETE') {
    const site = msg.site;
    const city = msg.city || 'Unknown';
    
    // Clear any active timeout since we got completion
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
    
    sendLog(`[SCRAPE_COMPLETE] All countries processed for ${site}`);
    
    // Update final status
    const relevantResults = results.filter(r => r.site === site);
    const countryCount = new Set(relevantResults.map(r => r.country)).size;
    
    if (relevantResults.length > 0) {
      siteStatus[site] = { status: 'complete', countryCount };
    } else {
      siteStatus[site] = { status: 'error', countryCount: 0 };
    }
    chrome.storage.local.set({ siteStatus });
    chrome.runtime.sendMessage({ 
      type: 'SITE_STATUS', 
      site, 
      status: siteStatus[site].status, 
      countryCount: siteStatus[site].countryCount 
    }).catch(()=>{});
    
    completedCount += 1;
    sendProgress();
    sendLog(`[SCRAPE_COMPLETE] Completed ${completedCount}/${totalCount} keywords. Calling startNext in 1s...`);
    setTimeout(() => startNext(), 1000);
    
    return true;
  }
  if (msg.type === 'COUNTRY_PROGRESS') {
    sendProgress(msg.site, msg.countryCount, 20); // Changed from 5 to 20 to show progress through all countries
  }
  if (msg.type === 'SCRAPE_ERROR'){
    // Handle scraping errors gracefully
    const site = msg.site;
    const city = msg.city || 'Unknown';
    const error = msg.error;
    
    // Clear any active timeout since we got an error response
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
    
    sendLog(`ERROR for ${site} (City: ${city}): ${error}`);
    sendLog(`Skipping ${site} and moving to next keyword...`);

    // Still count as completed to avoid getting stuck
    completedCount += 1;
    sendProgress();

    // Mark as error and notify UI
    siteStatus[site] = { status: 'error', countryCount: 0 };
    chrome.storage.local.set({ siteStatus });
    chrome.runtime.sendMessage({ type: 'SITE_STATUS', site, status: 'error', countryCount: 0 }).catch(()=>{});

    // Wait a bit longer before next to give SEMrush time to recover
    sendLog(`[SCRAPE_ERROR] Error for ${site}. Completed ${completedCount}/${totalCount} keywords. Calling startNext in 3s...`);
    setTimeout(() => startNext(), 3000);
  }
  if (msg.type === 'DOWNLOAD_CSV'){
    exportCSV();
  }
  if (msg.type === 'DOWNLOAD_REPORT'){
    exportReport();
  }
  if (msg.type === 'CLEAR_FETCHED_URLS_ONLY') {
    (async () => {
      try {
        // Get current URLs and settings
        const { settings, uiState: currentUiState } = await chrome.storage.local.get(['settings', 'uiState']);
        const currentUrls = currentUiState?.urls || settings?.urls || [];
        
        // Load CSV URLs to preserve them
        const csvUrls = await loadCsvUrls();
        
        // Update UI state with only CSV URLs
        uiState.urls = csvUrls;
        uiState.progress = { completed: 0, total: csvUrls.length, percentage: 0 };
        uiState.status = 'Idle';
        totalCount = csvUrls.length;
        completedCount = 0;
        
        // Update settings with only CSV URLs
        const updatedSettings = { ...settings, urls: csvUrls };
        await chrome.storage.local.set({ settings: updatedSettings });
        await chrome.storage.local.set({ uiState });
        
        chrome.runtime.sendMessage({ type: 'PROGRESS', completed: 0, total: csvUrls.length, percentage: 0 }).catch(()=>{});
        chrome.action.setBadgeText({ text: '' });
        sendLog(`Cleared fetched URLs. Preserved ${csvUrls.length} CSV URLs.`);
        
        sendResponse({ success: true, csvUrlCount: csvUrls.length });
      } catch (error) {
        sendLog(`Error clearing fetched URLs: ${error.message}`);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  if (msg.type === 'CLEAR_SCRAPED_DATA') {
    results = [];
    siteStatus = {};
    chrome.storage.local.remove(['scrapedData', 'siteStatus']);
    chrome.runtime.sendMessage({ type: 'DATA_UPDATE', count: 0, sample: [] }).catch(()=>{});
    chrome.runtime.sendMessage({ type: 'SITE_STATUS_CLEAR' }).catch(()=>{});
    sendLog('Scraped data cleared.');
  }
  if (msg.type === 'FETCH_GOOGLE_COMPETITORS') {
    (async () => {
      const { keywords } = msg;
      const all = [];
      // ADDED: Get existing URLs to append to them
      const { settings, uiState: currentUiState } = await chrome.storage.local.get(['settings', 'uiState']);
      const existingUrls = currentUiState?.urls || settings?.urls || [];
      
      sendLog(`Starting Google Competitors fetch for ${keywords.length} keywords...`);
      for (let i = 0; i < keywords.length; i++) {
        const { city, keyword } = keywords[i];
        sendLog(`[${i + 1}/${keywords.length}] Fetching: ${keyword} (${city})`);
        const result = await performGoogleSearch(keyword);
        if (result && result.success && result.domains) {
          for (const url of result.domains) {
            all.push({ city, keyword, url }); // MODIFIED: Include keyword field
          }
        }
        await sleep(2000);
      }
      sendLog(`Fetch complete. Found ${all.length} competitors.`);
      
      // Combine and deduplicate URLs (based on keyword + city + url combination)
      const existingUrlsMap = new Map();
      existingUrls.forEach(item => {
        const key = `${item.city}_${item.keyword}_${item.url || ''}`;
        existingUrlsMap.set(key, item);
      });
      
      all.forEach(item => {
        const key = `${item.city}_${item.keyword}_${item.url || ''}`;
        if (!existingUrlsMap.has(key)) {
          existingUrlsMap.set(key, item);
        }
      });
      
      const allUrls = Array.from(existingUrlsMap.values());
      uiState.urls = allUrls;
      await chrome.storage.local.set({ uiState });
      
      // Also save to settings for consistency
      const updatedSettings = { ...settings, urls: allUrls };
      await chrome.storage.local.set({ settings: updatedSettings });
      
      uiState.progress.total = allUrls.length; // ADD THIS LINE
      totalCount = allUrls.length; // ADD THIS LINE
      console.log(`[FETCH_GOOGLE_COMPETITORS] Updated totalCount to ${totalCount}`); // ADD THIS LINE
      
      sendLog(`Total URLs loaded: ${allUrls.length} (${existingUrls.length} existing + ${all.length} new)`);
      await exportGoogleCompetitorsCSV(all); // AUTO-DOWNLOAD CSV
      sendResponse(allUrls); // Return all URLs instead of just new ones
    })();
    return true;
  }
  if (msg.type === 'GET_UI_STATE') {
    // ADD: Ensure URL count is accurate
    if (uiState.urls && Array.isArray(uiState.urls)) {
      uiState.progress.total = uiState.urls.length;
      console.log(`[GET_UI_STATE] Returning ${uiState.urls.length} URLs`);
    }
    sendResponse(uiState);
    return true;
  }
  if (msg.type === 'PARSE_INPUT_CSV') {
    (async () => {
      try {
        const { csvText } = msg;
        const lines = csvText.split('\n').filter(line => line.trim());
        const header = lines[0].split(',').map(h => h.trim());
        const urlIdx = header.findIndex(h => h.toLowerCase() === 'url' || h.toLowerCase() === 'urls');
        const competitorUrlIdx = header.findIndex(h => h.toLowerCase() === 'competitors urls' || h.toLowerCase() === 'competitor urls');
        
        if (urlIdx === -1) {
          sendResponse({ success: false, error: 'No "url" or "urls" column found in CSV' });
          return;
        }
        
        const urls = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
          if (parts.length >= 1) {
            const keyword = parts[urlIdx];
            const competitorUrl = competitorUrlIdx !== -1 && parts[competitorUrlIdx] ? parts[competitorUrlIdx] : '';
            let city = 'Unknown';
            
            // Extract city from keyword (handle various formats)
            if (keyword) {
              const words = keyword.toLowerCase().split(" ");
              
              // Handle format "prayer times in cityname"
              if (words.includes("prayer") && words.includes("times")) {
                const inIndex = words.indexOf("in");
                if (inIndex !== -1 && inIndex < words.length - 1) {
                  city = words.slice(inIndex + 1).join(" ");
                }
              }
              // Handle format "prayer time cityname"
              else if (words.includes("prayer") && words.includes("time")) {
                const timeIndex = words.indexOf("time");
                if (timeIndex !== -1 && timeIndex < words.length - 1) {
                  city = words.slice(timeIndex + 1).join(" ");
                }
              }
              // Handle format "fajr azan cityname" or similar
              else if (words.includes("azan") || words.includes("adhan")) {
                // Find the last word which is likely the city name
                if (words.length > 2) {
                  city = words[words.length - 1];
                }
              }
              // Default: use the last word as city if we can't determine the pattern
              else if (words.length > 1) {
                city = words[words.length - 1];
              }
              
              // Capitalize first letter of each word
              if (city !== "Unknown") {
                city = city.split(" ").map(word => 
                  word.charAt(0).toUpperCase() + word.slice(1)
                ).join(" ");
              }
            }
            
            if (keyword) urls.push({ city, keyword, url: competitorUrl || keyword }); // Use competitorUrl as url if available, otherwise use keyword
          }
        }
        sendLog(`Parsed ${urls.length} keywords/cities from CSV`);
        // Get existing URLs to append to them
        const { settings, uiState: currentUiState } = await chrome.storage.local.get(['settings', 'uiState']);
        const existingUrls = currentUiState?.urls || settings?.urls || [];
        
        // Combine and deduplicate URLs (based on keyword + city + url combination)
        const existingUrlsMap = new Map();
        existingUrls.forEach(item => {
          const key = `${item.city}_${item.keyword}_${item.url || ''}`;
          existingUrlsMap.set(key, item);
        });
        
        urls.forEach(item => {
          const key = `${item.city}_${item.keyword}_${item.url || ''}`;
          if (!existingUrlsMap.has(key)) {
            existingUrlsMap.set(key, item);
          }
        });
        
        const allUrls = Array.from(existingUrlsMap.values());
        const updatedSettings = { ...settings, urls: allUrls };
        await chrome.storage.local.set({ settings: updatedSettings });
        uiState.urls = allUrls;
        await chrome.storage.local.set({ uiState });
        
        sendLog(`Total URLs loaded: ${allUrls.length} (${existingUrls.length} existing + ${urls.length} new from CSV)`);
        
        // ADD THESE LINES BEFORE sendResponse:
        uiState.progress.total = allUrls.length;
        totalCount = allUrls.length;
        chrome.storage.local.set({ uiState });
        console.log(`[PARSE_INPUT_CSV] Updated totalCount to ${totalCount}`);
        
        sendResponse({ success: true, count: allUrls.length, urls: allUrls });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  if (msg.type === 'CHECK_STOP_STATUS') {
    sendResponse({ stopRequested: stopRequested });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) activeTabId = null;
});

