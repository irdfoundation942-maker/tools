let inputUrls = [];
let batchSize = 10;
let isPaused = false;
let extractedData = [];
let currentIndex = 0;

// === Persistence helpers === //
const STATE_KEY = 'popup_state';

function savePopupState() {
  chrome.storage.local.set({
    [STATE_KEY]: {
      inputUrls,
      currentIndex,
      extractedData,
      isPaused,
      batchSize
    }
  });
}

function loadPopupState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STATE_KEY], (result) => {
      resolve(result[STATE_KEY]);
    });
  });
}

async function restoreUIState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_UI_STATE' });
  if (response) {
    if (response.urls && response.urls.length > 0) {
      // Example: you may want to display somewhere, add as needed
      // document.getElementById('urlsList').value = response.urls.map(u => `${u.city},${u.keyword || u.url}`).join('\n');
      // Optionally, handle showing count or sample on fileInfo as well
    }
    if (response.progress) {
      // Example: update progress bar visually if desired
      // document.getElementById('progressText').textContent = `${response.progress.completed}/${response.progress.total}`;
      // updateProgress(response.progress.completed, response.progress.total);
    }
  }
}

// Update URLs loaded display
function updateUrlsLoadedDisplay() {
  // Get current UI state to show total URLs (CSV + fetched)
  chrome.runtime.sendMessage({ type: 'GET_UI_STATE' }, (response) => {
    if (response && response.urls) {
      const totalUrls = response.urls.length;
      
      // Load the input.csv.csv file to count CSV competitor URLs
  fetch(chrome.runtime.getURL("input.csv.csv"))
    .then(response => response.text())
    .then(csvText => {
      const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
          let csvUrlCount = 0;
          
      if (lines.length > 1) { // More than just header
        const header = lines[0].split(",");
        const competitorUrlIdx = header.findIndex((h) => 
          h.trim().toLowerCase() === "competitors urls" || h.trim().toLowerCase() === "competitor urls"
        );
        
        if (competitorUrlIdx !== -1) {
          // Count non-empty competitor URLs
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(",");
            if (parts[competitorUrlIdx] && parts[competitorUrlIdx].trim()) {
                  csvUrlCount++;
                }
              }
            }
          }
          
          const fetchedUrlCount = totalUrls - csvUrlCount;
        
          // Update the DOM element with combined URL count
        const urlsLoadedElement = document.getElementById('urlsLoadedDisplay');
        if (urlsLoadedElement) {
            if (fetchedUrlCount > 0) {
              urlsLoadedElement.textContent = `${totalUrls} URLs loaded (${csvUrlCount} CSV + ${fetchedUrlCount} fetched)`;
      } else {
              urlsLoadedElement.textContent = `${csvUrlCount} URLs loaded from CSV`;
        }
      }
    })
    .catch(error => {
      console.error("Error loading input.csv.csv:", error);
      const urlsLoadedElement = document.getElementById('urlsLoadedDisplay');
      if (urlsLoadedElement) {
            urlsLoadedElement.textContent = `${totalUrls} URLs loaded`;
          }
        });
    } else {
      // Fallback to CSV-only count
      fetch(chrome.runtime.getURL("input.csv.csv"))
        .then(response => response.text())
        .then(csvText => {
          const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
          let csvUrlCount = 0;
          
          if (lines.length > 1) { // More than just header
            const header = lines[0].split(",");
            const competitorUrlIdx = header.findIndex((h) => 
              h.trim().toLowerCase() === "competitors urls" || h.trim().toLowerCase() === "competitor urls"
            );
            
            if (competitorUrlIdx !== -1) {
              // Count non-empty competitor URLs
              for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(",");
                if (parts[competitorUrlIdx] && parts[competitorUrlIdx].trim()) {
                  csvUrlCount++;
                }
              }
            }
          }
          
          const urlsLoadedElement = document.getElementById('urlsLoadedDisplay');
          if (urlsLoadedElement) {
            urlsLoadedElement.textContent = `${csvUrlCount} URLs loaded from CSV`;
          }
        })
        .catch(error => {
          console.error("Error loading input.csv.csv:", error);
          const urlsLoadedElement = document.getElementById('urlsLoadedDisplay');
          if (urlsLoadedElement) {
            urlsLoadedElement.textContent = 'Error loading URLs';
          }
        });
      }
    });
}

// On load update count
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateUrlsLoadedDisplay);
} else {
  updateUrlsLoadedDisplay();
}

// Also react to uiState changes (live update support)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiState) updateUrlsLoadedDisplay();
});

// After CLEAR and CSV upload, directly call updateUrlsLoadedDisplay()
// For example (where you handle clear):
// await chrome.runtime.sendMessage({ type: 'CLEAR_SCRAPED_DATA' });
// updateUrlsLoadedDisplay();
// Similarly after CSV uploads are parsed from the user

document.addEventListener("DOMContentLoaded", async () => {
  restoreUIState(); // ADD THIS LINE (in addition to loadPopupState for full compatibility)
  const state = await loadPopupState();
  if (state && Array.isArray(state.inputUrls) && state.inputUrls.length > 0) {
    // Restore state
    inputUrls = state.inputUrls;
    currentIndex = state.currentIndex || 0;
    extractedData = state.extractedData || [];
    isPaused = state.isPaused || false;
    batchSize = state.batchSize || 10;
    // Update UI
    const fileInfo = document.getElementById("fileInfo");
    fileInfo.textContent = `✅ ${inputUrls.length} URLs loaded from input.csv (restored)`;
    fileInfo.style.backgroundColor = "#d4edda";
    fileInfo.style.color = "#155724";
    fileInfo.style.borderColor = "#c3e6cb";
    if (currentIndex > 0) {
      updateProgress(currentIndex, inputUrls.length);
      document.getElementById("downloadBtn").style.display = extractedData.length > 0 ? "block" : "none";
    }
    if (isPaused) {
      document.getElementById("startBtn").disabled = false;
      document.getElementById("startBtn").textContent = "Resume";
      document.getElementById("pauseBtn").textContent = "Paused";
      document.getElementById("pauseBtn").style.display = "block";
    }
  } else {
    // Load from CSV as fallback
    loadInputCsv();
  }
  document.getElementById("startBtn").addEventListener("click", handleStart);
  document.getElementById("pauseBtn").addEventListener("click", handlePause);
  document.getElementById("downloadBtn").addEventListener("click", handleDownloadPartial);
  document.getElementById("clearBtn").addEventListener("click", handleClearUrls);
  document.getElementById('loadCSVBtn')?.addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target.result;
      const response = await chrome.runtime.sendMessage({ type: 'PARSE_INPUT_CSV', csvText });
      if (response && response.success) {
        // Update the UI with the loaded URLs
        inputUrls = response.urls;
        const fileInfo = document.getElementById("fileInfo");
        fileInfo.textContent = `✅ ${inputUrls.length} keywords loaded from CSV`;
        fileInfo.style.backgroundColor = "#d4edda";
        fileInfo.style.color = "#155724";
        fileInfo.style.borderColor = "#c3e6cb";
        
        // Update URLs loaded display
        updateUrlsLoadedDisplay();
        
        // Save state
        savePopupState();
        
        showStatus(`Successfully loaded ${inputUrls.length} keywords from CSV`, "success");
      } else {
        showStatus("Error loading CSV file", "error");
      }
    };
    reader.readAsText(file);
  });
});

async function loadInputCsv() {
  try {
    const response = await fetch(chrome.runtime.getURL("input.csv.csv"));
    const csvText = await response.text();
    inputUrls = parseCsvUrls(csvText);

    const fileInfo = document.getElementById("fileInfo");
    if (inputUrls.length > 0) {
      fileInfo.textContent = `✅ ${inputUrls.length} keywords loaded from input.csv.csv`;
      fileInfo.style.backgroundColor = "#d4edda";
      fileInfo.style.color = "#155724";
      fileInfo.style.borderColor = "#c3e6cb";
      
      // Update URLs loaded display
      updateUrlsLoadedDisplay();
      
      // Save state
      savePopupState();
    } else {
      fileInfo.textContent = "⚠️ No keywords found in input.csv.csv";
      fileInfo.style.backgroundColor = "#fff3cd";
      fileInfo.style.color = "#856404";
      fileInfo.style.borderColor = "#ffeeba";
    }
  } catch (error) {
    console.error("Error loading input.csv:", error);
    document.getElementById("fileInfo").textContent =
      "❌ Error loading input.csv.csv";
    document.getElementById("fileInfo").style.backgroundColor = "#f8d7da";
    document.getElementById("fileInfo").style.color = "#721c24";
    showStatus(
      "Error loading input.csv.csv. Make sure the file exists in the extension folder.",
      "error"
    );
  }
}

function parseCsvUrls(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];

  const header = lines[0].split(",");
  const urlIdx = header.findIndex((h) => h.trim().toLowerCase() === "url" || h.trim().toLowerCase() === "urls");
  const competitorUrlIdx = header.findIndex((h) => h.trim().toLowerCase() === "competitors urls" || h.trim().toLowerCase() === "competitor urls");

  if (urlIdx === -1) {
    console.error('No "url" or "urls" column found in CSV');
    return [];
  }

  // Extract city and keyword from each line
  return lines
    .slice(1)
    .map((line) => {
      const parts = line.split(",");
      const keyword = parts[urlIdx] ? parts[urlIdx].trim() : "";
      const competitorUrl = competitorUrlIdx !== -1 && parts[competitorUrlIdx] ? parts[competitorUrlIdx].trim() : "";
      
      // Extract city from keyword (handle various formats)
      let city = "Unknown";
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
      
      return {
        keyword: keyword,
        city: city,
        url: competitorUrl || keyword // Use competitor URL if available, otherwise use keyword
      };
    })
    .filter((item) => item.keyword && item.keyword.length > 0);
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = type;
  status.style.display = "block";
}

function updateProgress(current, total) {
  const percentage = Math.round((current / total) * 100);
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const progressContainer = document.getElementById("progressContainer");

  progressContainer.style.display = "block";
  progressBar.style.width = percentage + "%";
  progressBar.textContent = percentage + "%";
  progressText.textContent = `Processing ${current} of ${total} URLs (${percentage}%)`;
  savePopupState();
}

function hideProgress() {
  document.getElementById("progressContainer").style.display = "none";
}

async function handleStart() {
  if (!inputUrls.length) {
    showStatus("No keywords loaded. Please check input.csv file.", "error");
    return;
  }

  // If resuming, keep existing data
  if (!isPaused) {
    extractedData = [];
    currentIndex = 0;
  }

  isPaused = false;
  savePopupState();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("startBtn").textContent = "Processing...";
  document.getElementById("pauseBtn").style.display = "block";
  document.getElementById("pauseBtn").textContent = "Pause";
  showStatus("Extraction in progress...", "info");

  let batchNum = Math.floor(currentIndex / batchSize);

  for (let i = currentIndex; i < inputUrls.length; i++) {
    // Check if paused
    if (isPaused) {
      showStatus(
        `⏸️ Paused at ${i} of ${inputUrls.length} keywords. ${extractedData.length} keywords extracted.`,
        "info"
      );
      document.getElementById("startBtn").disabled = false;
      document.getElementById("startBtn").textContent = "Resume";
      document.getElementById("pauseBtn").textContent = "Paused";
      document.getElementById("downloadBtn").style.display = "block";
      currentIndex = i;
      savePopupState();
      return;
    }

    const keywordData = inputUrls[i];
    updateProgress(i + 1, inputUrls.length);

    const competitors = await getCompetitorsForUrl(keywordData.keyword);
    extractedData.push({ 
      keyword: keywordData.keyword, 
      city: keywordData.city,
      competitors: competitors 
    });
    savePopupState();

    // Download batch when we complete a batch of 10
    if ((i + 1) % batchSize === 0 || i === inputUrls.length - 1) {
      const batchStart = Math.floor(i / batchSize) * batchSize;
      const batchResults = extractedData.slice(batchStart, i + 1);
      batchNum++;
      downloadBatchCsv(batchResults, batchNum);
      showStatus(`✅ Batch ${batchNum} completed and downloaded!`, "success");
    }

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Completed
  updateProgress(inputUrls.length, inputUrls.length);
  showStatus(
    `🎉 All ${Math.ceil(
      inputUrls.length / batchSize
    )} batches processed successfully!`,
    "success"
  );
  document.getElementById("startBtn").disabled = false;
  document.getElementById("startBtn").textContent = "Start Extraction";
  document.getElementById("pauseBtn").style.display = "none";
  document.getElementById("downloadBtn").style.display = "none";
  extractedData = [];
  currentIndex = 0;
  savePopupState();
}

function handleClearUrls() {
  // Clear only fetched URLs, preserve CSV URLs
  chrome.runtime.sendMessage({ type: 'CLEAR_FETCHED_URLS_ONLY' }, (response) => {
    if (response && response.success) {
      // Reload the CSV URLs to restore them
      loadInputCsv();
      
      // Clear local state
  extractedData = [];
  currentIndex = 0;
  isPaused = false;
  savePopupState();
  
  // Update UI
  const fileInfo = document.getElementById("fileInfo");
      fileInfo.textContent = "CSV URLs preserved. Fetched URLs cleared.";
      fileInfo.style.backgroundColor = "#d4edda";
      fileInfo.style.color = "#155724";
      fileInfo.style.borderColor = "#c3e6cb";
  
  // Update URLs loaded display
  updateUrlsLoadedDisplay();
  
  // Hide progress and download button
  hideProgress();
  document.getElementById("downloadBtn").style.display = "none";
  
  // Reset start button
  document.getElementById("startBtn").disabled = false;
  document.getElementById("startBtn").textContent = "Start Extraction";
  document.getElementById("pauseBtn").style.display = "none";
  
      // Clear scraped data but preserve CSV URLs
  chrome.runtime.sendMessage({ type: 'CLEAR_SCRAPED_DATA' });
  
      showStatus("Fetched URLs cleared, CSV URLs preserved", "success");
    } else {
      showStatus("Error clearing URLs", "error");
    }
  });
}

function handlePause() {
  isPaused = true;
  savePopupState();
  document.getElementById("pauseBtn").disabled = true;
}

function handleDownloadPartial() {
  if (extractedData.length === 0) {
    showStatus("No data to download yet.", "error");
    return;
  }

  let csv = "keyword,city,competitors urls\n";

  extractedData.forEach((row) => {
    if (row.competitors.length > 0) {
      csv += `${row.keyword},${row.city},${row.competitors[0]}\n`;
      for (let i = 1; i < row.competitors.length; i++) {
        csv += `,,${row.competitors[i]}\n`;
      }
    } else {
      csv += `${row.keyword},${row.city},\n`;
    }
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  // Generate date-time format: YYYY-MM-DD-HH-MM-SS
  const now = new Date();
  const dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}-${String(
    now.getHours()
  ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(
    now.getSeconds()
  ).padStart(2, "0")}`;

  chrome.downloads.download(
    {
      url: url,
      filename: `Competitor URLS/Urls-${dateTime}.csv`,
      saveAs: false,
      conflictAction: "uniquify",
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download error:", chrome.runtime.lastError);
        showStatus(
          "Download failed: " + chrome.runtime.lastError.message,
          "error"
        );
      } else {
        showStatus(
          `📥 Downloaded ${extractedData.length} extracted keywords to Downloads/Competitor URLS folder!`,
          "success"
        );
      }
    }
  );
}

function downloadBatchCsv(results, batchNum) {
  let csv = "keyword,city,competitors urls\n";

  results.forEach((row) => {
    if (row.competitors.length > 0) {
      csv += `${row.keyword},${row.city},${row.competitors[0]}\n`;
      for (let i = 1; i < row.competitors.length; i++) {
        csv += `,,${row.competitors[i]}\n`;
      }
    } else {
      csv += `${row.keyword},${row.city},\n`;
    }
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  // Generate date-time format: YYYY-MM-DD-HH-MM-SS
  const now = new Date();
  const dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}-${String(
    now.getHours()
  ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(
    now.getSeconds()
  ).padStart(2, "0")}`;

  chrome.downloads.download(
    {
      url: url,
      filename: `Competitor URLS/Urls-${dateTime}.csv`,
      saveAs: false,
      conflictAction: "uniquify",
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download error:", chrome.runtime.lastError);
      }
    }
  );
}

async function getCompetitorsForUrl(url) {
  // Send message to background.js to perform search and extract competitors
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "getCompetitors", url },
      (response) => {
        if (
          response &&
          response.success &&
          Array.isArray(response.competitors)
        ) {
          resolve(response.competitors.slice(0, 10));
        } else {
          resolve([]);
        }
      }
    );
  });
}
