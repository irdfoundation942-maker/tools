const statusEl = document.getElementById('status');
const clearBtn = document.getElementById('clearBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressBar = document.getElementById('progressBar');
const downloadBtn = document.getElementById('downloadBtn');
const clearScrapedBtn = document.getElementById('clearScrapedBtn');
const fetchAndStartBtn = document.getElementById('fetchAndStartBtn');
const urlCount = document.getElementById('urlCount');
const completeCount = document.getElementById('completeCount');
const errorCount = document.getElementById('errorCount');
// const toggleStatusBtn = document.getElementById('toggleStatusBtn'); // Commented out since it doesn't exist
// const statusMenu = document.getElementById('statusMenu'); // Commented out since it doesn't exist
const storageCount = document.getElementById('storageCount');
const startRowInput = document.getElementById('startRowInput');
const fetchGoogleBtn = document.getElementById('fetchGoogleBtn');
let siteStatusMap = {};
let siteStatus = {}; // Add missing siteStatus variable

function appendLog(message) {
  // Since there's no log element in the HTML, we'll just log to console
  console.log(message);
}

function setStatus(status) {
  statusEl.textContent = status;
  chrome.storage.local.set({ status });
}

function updateExtractionStatus() {
  const tbody = document.getElementById('extractionStatusTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (Object.keys(siteStatus).length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" style="padding:8px; color:var(--muted); text-align:center;">No links processed yet</td>';
    tbody.appendChild(tr);
    return;
  }
  
  for (const [site, data] of Object.entries(siteStatus)) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #1f2937';
    
    // Status cell with color coding
    const statusCell = document.createElement('td');
    statusCell.textContent = data.status;
    statusCell.style.padding = '8px';
    statusCell.style.fontWeight = 'bold';
    statusCell.style.textTransform = 'lowercase';
    
    if (data.status === 'Complete') {
      statusCell.style.color = '#22c55e';
    } else if (data.status === 'Error') {
      statusCell.style.color = '#ef4444';
    } else if (data.status === 'Running') {
      statusCell.style.color = '#22d3ee';
    } else {
      statusCell.style.color = '#94a3b8';
    }
    
    // Link cell
    const linkCell = document.createElement('td');
    linkCell.textContent = site;
    linkCell.style.padding = '8px';
    linkCell.style.wordBreak = 'break-all';
    linkCell.style.maxWidth = '300px';
    
    // Country cell (e.g., "5/5" or "0/5")
    const countryCell = document.createElement('td');
    const totalCountries = data.totalCountries || 5;
    countryCell.textContent = `${data.countryCount || 0}/${totalCountries}`;
    countryCell.style.padding = '8px';
    countryCell.style.textAlign = 'center';
    
    tr.appendChild(statusCell);
    tr.appendChild(linkCell);
    tr.appendChild(countryCell);
    tbody.appendChild(tr);
  }
}

startBtn.addEventListener('click', async () => {
  setStatus('Running');
  let startRow = 1;
  if (startRowInput) {
    startRow = parseInt(startRowInput.value, 10) || 1;
    // Save startRow to settings
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, startRow } });
  }
  await chrome.runtime.sendMessage({ type: 'START_RUN' });
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_RUN' });
  setStatus('Stopped');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') appendLog(msg.message);
  if (msg.type === 'STATUS') setStatus(msg.status);
  if (msg.type === 'PROGRESS'){
    const { completed, total } = msg;
    const pct = total ? Math.min(100, Math.round((completed/total)*100)) : 0;
    progressBar.style.width = pct + '%';
    
    // Update download button state
    if (completed === total && total > 0) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download CSV';
    } else if (total === 0) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'No Data';
    }
  }
  if (msg.type === 'DATA_UPDATE'){
    updateDataPreview(msg.count, msg.sample);
  }
  if (msg.type === 'SITE_STATUS') {
    siteStatusMap[msg.site] = { status: msg.status, countryCount: msg.countryCount };
    renderSiteStatusList();
  }
  if (msg.type === 'SITE_STATUS_CLEAR') {
    siteStatusMap = {};
    renderSiteStatusList();
  }
});

function renderSiteStatusList() {
  const tbody = document.getElementById('extractionStatusTableBody');
  if (!tbody) return;

  const entries = Object.entries(siteStatusMap);
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:8px; color:var(--muted); text-align:center;">No links processed yet</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(([site, data]) => {
    const status = data.status || 'N/A';
    const countryCount = data.countryCount || 0;
    const color = status === 'complete' ? '#22c55e' : '#ef4444';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    
    return `
      <tr style="border-bottom:1px solid #1f2937;">
        <td style="padding:8px; color:${color}; font-weight:bold;">${label}</td>
        <td style="padding:8px; word-break:break-all; max-width:300px;">${site}</td>
        <td style="padding:8px; text-align:center;">${countryCount}/5</td>
      </tr>
    `;
  }).join('');
}

function renderUrlList(urls) {
  // This function would render the URL list in the UI if needed
  // For now, we'll just update the URL count display
  updateUrlCountDisplay();
}

function updateScrapedCount(count) {
  // This function would update the scraped count display if needed
  // For now, we'll just update the storage count
  updateStorageCount();
}

function updateDataPreview(count, sample) {
  // Since there's no data preview element in the HTML, we'll just log to console
  console.log(`Data updated: ${count} records`);
  if (sample && sample.length > 0) {
    console.log('Sample data:', sample);
  }
}

// Function to load competitor URLs from input.csv.csv
async function loadCompetitorUrlsFromCsv() {
  try {
    const response = await fetch(chrome.runtime.getURL('input.csv.csv'));
    const csvText = await response.text();
    const lines = csvText.split('\n').filter(line => line.trim());
    const header = lines[0].split(',').map(h => h.trim());
    const urlIdx = header.findIndex(h => h.toLowerCase() === 'url' || h.toLowerCase() === 'urls');
    const competitorUrlIdx = header.findIndex(h => h.toLowerCase() === 'competitors urls' || h.toLowerCase() === 'competitor urls');
    
    if (urlIdx === -1) {
      console.log('No "url" or "urls" column found in input.csv file.');
      return;
    }
    
    // Extract URLs from CSV
    const urls = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === ',') continue; // Skip empty lines
      
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      const keyword = parts[urlIdx];
      const competitorUrl = competitorUrlIdx !== -1 && parts[competitorUrlIdx] ? parts[competitorUrlIdx] : '';
      
      if (keyword) {
        // Extract city from keyword (handle various formats)
        let city = "Unknown";
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
        
        // Use competitorUrl if available, otherwise use keyword
        const url = competitorUrl || keyword;
        urls.push({ city, keyword, url });
      }
    }
    
    if (urls.length > 0) {
      // Save to settings
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, urls } });
      
      // Also update uiState for proper display
      await chrome.storage.local.set({ 
        uiState: { 
          urls: urls, 
          progress: { completed: 0, total: urls.length, percentage: 0 }, 
          status: 'Idle' 
        } 
      });
      
      console.log(`Loaded ${urls.length} competitor URLs from input.csv.csv`);
      updateUrlCountDisplay();
    } else {
      // If no URLs found, clear the state
      await chrome.storage.local.set({ settings: { urls: [] } });
      await chrome.storage.local.set({ 
        uiState: { 
          urls: [], 
          progress: { completed: 0, total: 0, percentage: 0 }, 
          status: 'Idle' 
        } 
      });
      updateUrlCountDisplay();
    }
  } catch (error) {
    console.error('Error loading competitor URLs from input.csv.csv:', error);
  }
}

(async function init(){
  // Load competitor URLs from input.csv.csv on startup
  await loadCompetitorUrlsFromCsv();

  const { settings, scrapedData, log, status, siteStatus } = await chrome.storage.local.get(['settings', 'scrapedData', 'log', 'status', 'siteStatus']);
  if (settings){
    // semrushBase.value = settings.semrushBase || semrushBase.value; // Commented out since semrushBase doesn't exist
    renderUrlList(settings.urls || []);
    if (typeof settings.startRow === 'number' && startRowInput) {
      startRowInput.value = settings.startRow;
    }
  }
  if (log) {
    // logEl.textContent = log; // Commented out since logEl doesn't exist
    console.log(log);
  }
  if (status) statusEl.textContent = status;
  if (siteStatus) {
    siteStatusMap = siteStatus;
    renderSiteStatusList();
  }
  const scrapedCountVal = Array.isArray(scrapedData) ? scrapedData.length : 0;
  updateScrapedCount(scrapedCountVal);
  // Set download button state based on scraped data
  if (scrapedCountVal > 0) {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Download CSV';
  } else {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'No Data';
  }
})();

async function updateUrlCountDisplay(){
  let numUrls = 0;
  // Prefer the UI state from the background if present for global sync
  try {
    const resp = await chrome.runtime.sendMessage({type:'GET_UI_STATE'});
    if (resp && Array.isArray(resp.urls)) numUrls = resp.urls.length;
  } catch(e){
    const {settings} = await chrome.storage.local.get('settings');
    if(settings && Array.isArray(settings.urls)) numUrls = settings.urls.length;
  }
  if(urlCount) urlCount.textContent = `${numUrls} URLs loaded`;
}

// On load - automatically load URLs from CSV and update display
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', async () => {
    await loadCompetitorUrlsFromCsv();
    updateUrlCountDisplay();
  });
}else{
  loadCompetitorUrlsFromCsv().then(() => {
    updateUrlCountDisplay();
  });
}
// Always re-update when settings are changed elsewhere (multi-tab support)
chrome.storage.onChanged.addListener((changes, area)=>{
  if(area === 'local' && (changes.uiState || changes.settings)) updateUrlCountDisplay();
});

clearBtn?.addEventListener('click', async () => {
  // Clear both settings and uiState to ensure complete reset
  await chrome.storage.local.set({ settings: { urls: [] } });
  await chrome.storage.local.set({ uiState: { urls: [], progress: { completed: 0, total: 0, percentage: 0 }, status: 'Idle' } });
  
  // Also send message to background to clear its state
  chrome.runtime.sendMessage({ type: 'CLEAR_URLS_PROGRESS' });
  
  updateUrlCountDisplay();
  progressBar.style.width = '0%';
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'No Data';
  statusEl.textContent = '';
});

downloadBtn?.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'DOWNLOAD_CSV' });
  } catch (error) {}
});

clearScrapedBtn?.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SCRAPED_DATA' });
    updateUrlCountDisplay();
    progressBar.style.width = '0%';
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'No Data';
    statusEl.textContent = '';
    siteStatusMap = {};
    renderSiteStatusList();
  } catch (e) {}
});

fetchAndStartBtn?.addEventListener('click', async () => {
  try {
    // Read keywords from input.csv
    const response = await fetch(chrome.runtime.getURL('input.csv'));
    const csvText = await response.text();
    const lines = csvText.split('\n').filter(line => line.trim());
    const header = lines[0].split(',').map(h => h.trim());
    const urlIdx = header.findIndex(h => h.toLowerCase() === 'url' || h.toLowerCase() === 'urls');
    
    if (urlIdx === -1) {
      console.log('No "url" or "urls" column found in input.csv file.');
      return;
    }
    
    // Skip header and extract keywords
    const keywords = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === ',') continue; // Skip empty lines
      
      // Extract keyword from first column (before comma)
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      const keyword = parts[urlIdx];
      
      // Skip if keyword is empty or just a comma
      if (keyword && keyword !== 'url') {
        // Extract city from keyword (handle various formats)
        let city = "Unknown";
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
        
        keywords.push({ city, keyword });
      }
    }
    
    if (!keywords.length) {
      console.log('No keywords found in input.csv.csv file.');
      return;
    }
    
    fetchAndStartBtn.disabled = true;
    fetchAndStartBtn.textContent = 'Fetching...';
    
    chrome.runtime.sendMessage({ type: 'FETCH_GOOGLE_COMPETITORS', keywords }, (urlList) => {
      fetchAndStartBtn.disabled = false;
      fetchAndStartBtn.textContent = 'Fetch and Start';
      if (!urlList || !urlList.length) {
        console.log('No URLs were fetched from Google.');
        return;
      }
      chrome.storage.local.set({ settings: { urls: urlList.map(x => ({ city: x.city, url: x.url })) } }, async () => {
        console.log(`Fetched and loaded ${urlList.length} competitor URLs. Starting SEMrush scraping...`);
        updateUrlCountDisplay();
        
        // Automatically start the SEMrush scraping after fetching
        let startRow = 1;
        if (startRowInput) {
          startRow = parseInt(startRowInput.value, 10) || 1;
          // Save startRow to settings
          const { settings } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({ settings: { ...settings, startRow } });
        }
        
        // Start the scraping process
        await chrome.runtime.sendMessage({ type: 'START_RUN' });
      });
    });
  } catch (error) {
    console.error('Error reading input.csv:', error);
    console.log('Error reading input.csv file. Please make sure it exists in the extension directory.');
    fetchAndStartBtn.disabled = false;
    fetchAndStartBtn.textContent = 'Fetch and Start';
  }
});

fetchGoogleBtn?.addEventListener('click', async () => {
  try {
    // Read keywords from input.csv
    const response = await fetch(chrome.runtime.getURL('input.csv'));
    const csvText = await response.text();
    const lines = csvText.split('\n').filter(line => line.trim());
    const header = lines[0].split(',').map(h => h.trim());
    const urlIdx = header.findIndex(h => h.toLowerCase() === 'url' || h.toLowerCase() === 'urls');
    
    if (urlIdx === -1) {
      console.log('No "url" or "urls" column found in input.csv file.');
      return;
    }
    
    // Skip header and extract keywords
    const keywords = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === ',') continue; // Skip empty lines
      
      // Extract keyword from first column (before comma)
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      const keyword = parts[urlIdx];
      
      // Skip if keyword is empty or just a comma
      if (keyword && keyword !== 'url') {
        // Extract city from keyword (handle various formats)
        let city = "Unknown";
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
        
        keywords.push({ city, keyword });
      }
    }
    
    if (!keywords.length) {
      console.log('No keywords found in input.csv.csv file.');
      return;
    }
    
    fetchGoogleBtn.disabled = true;
    fetchGoogleBtn.textContent = 'Fetching...';
    
    chrome.runtime.sendMessage({ type: 'FETCH_GOOGLE_COMPETITORS', keywords }, (urlList) => {
      fetchGoogleBtn.disabled = false;
      fetchGoogleBtn.textContent = 'Fetch Google Competitors';
      if (!urlList || !urlList.length) {
        console.log('No URLs were fetched from Google.');
        return;
      }
      chrome.storage.local.set({ settings: { urls: urlList.map(x => ({ city: x.city, url: x.url })) } }, () => {
        console.log(`Fetched and loaded ${urlList.length} competitor URLs.`);
        updateUrlCountDisplay();
      });
    });
  } catch (error) {
    console.error('Error reading input.csv:', error);
    console.log('Error reading input.csv file. Please make sure it exists in the extension directory.');
  }
});

function updateStorageCount() {
  chrome.storage.local.get('scrapedData', (data) => {
    const count = Array.isArray(data.scrapedData) ? data.scrapedData.length : 0;
    if (storageCount) storageCount.textContent = `Store data: ${count}`;
  });
}

// Call on load
updateStorageCount();

// Optionally, call after clearing or updating scraped data
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DATA_UPDATE' || msg.type === 'CLEAR_SCRAPED_DATA') {
    updateStorageCount();
  }
});



