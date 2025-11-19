let keywords = [];
let currentProcess = 0;
let totalProcess = 0;

document.addEventListener("DOMContentLoaded", function () {
  // Get element references
  const keywordsLoadedBtn = document.getElementById("keywordsLoadedBtn");
  const scrapedResultsBtn = document.getElementById("scrapedResultsBtn");
  const processStatusBtn = document.getElementById("processStatusBtn");
  const startRowInput = document.getElementById("startRow");
  const endRowInput = document.getElementById("endRow");
  const keywordsPerSearchInput = document.getElementById("keywordsPerSearch");
  const extractProvidedCheckbox = document.getElementById(
    "extractProvidedKeywords"
  );
  const extractIdeasCheckbox = document.getElementById("extractKeywordIdeas");

  // Restore all saved UI states first
  restoreUIState();

  // Automatically load keywords from bundled CSV file
  loadBundledCSV();

  // Check and display stored data count (will be called again after CSV loads)
  // This ensures the count shows immediately if popup reopens

  async function loadBundledCSV() {
    try {
      const csvUrl = chrome.runtime.getURL("Input KW planner - Sheet1.csv");
      const response = await fetch(csvUrl);
      const csvText = await response.text();
      keywords = parseCSV(csvText);
      totalProcess = keywords.length;
      // After loading keywords, restore the current process state and status message
      chrome.storage.local.get(
        ["currentProcess", "statusMessage", "isAutomationRunning"],
        function (result) {
          currentProcess = result.currentProcess || 0;
          const savedStatus =
            result.statusMessage ||
            `Ready to process ${keywords.length} keywords`;
          updateStatus(savedStatus);
          updateStoredDataCount();
          
          // Restore button states based on automation status
          const isRunning = result.isAutomationRunning || false;
          setButtonStates(!isRunning, isRunning);
        }
      );
    } catch (error) {
      console.error("Error loading CSV:", error);
      updateStatusButtons(0, 0, 0, 0);
      updateStatus("Error loading keywords from CSV");
    }
  }

  function restoreUIState() {
    // Restore all input fields and checkboxes from storage
    chrome.storage.local.get(
      [
        "startRow",
        "endRow",
        "keywordsPerSearch",
        "extractProvidedKeywords",
        "extractKeywordIdeas"
      ],
      function (result) {
        if (result.startRow !== undefined && startRowInput) {
          startRowInput.value = result.startRow;
        }
        if (result.endRow !== undefined && endRowInput) {
          endRowInput.value = result.endRow;
        }
        if (result.keywordsPerSearch !== undefined && keywordsPerSearchInput) {
          keywordsPerSearchInput.value = result.keywordsPerSearch;
        } else if (keywordsPerSearchInput && !keywordsPerSearchInput.value) {
          keywordsPerSearchInput.value = 1; // Default value
        }
        if (result.extractProvidedKeywords !== undefined && extractProvidedCheckbox) {
          extractProvidedCheckbox.checked = result.extractProvidedKeywords;
        }
        if (result.extractKeywordIdeas !== undefined && extractIdeasCheckbox) {
          extractIdeasCheckbox.checked = result.extractKeywordIdeas;
        }
      }
    );
  }

  function saveUIState() {
    // Save all input fields and checkboxes to storage
    chrome.storage.local.set({
      startRow: startRowInput.value,
      endRow: endRowInput.value,
      keywordsPerSearch: keywordsPerSearchInput.value,
      extractProvidedKeywords: extractProvidedCheckbox.checked,
      extractKeywordIdeas: extractIdeasCheckbox.checked
    });
  }

  function parseCSV(csv) {
    const lines = csv.split("\n");
    const keywords = [];
    for (let i = 1; i < lines.length; i++) {
      // Skip header
      const line = lines[i].trim();
      if (line) {
        keywords.push(line);
      }
    }
    return keywords;
  }

  function updateStatusButtons(
    keywordsCount,
    scrapedCount,
    currentProc,
    totalProc
  ) {
    const keywordsLoadedBtn = document.getElementById("keywordsLoadedBtn");
    const scrapedResultsBtn = document.getElementById("scrapedResultsBtn");
    const processStatusBtn = document.getElementById("processStatusBtn");

    if (keywordsLoadedBtn) {
      keywordsLoadedBtn.textContent = keywordsCount || "0";
    }
    if (scrapedResultsBtn) {
      scrapedResultsBtn.textContent = scrapedCount || "0";
    }
    if (processStatusBtn) {
      processStatusBtn.textContent = `${currentProc}/${totalProc}`;
    }
  }

  function updateStoredDataCount() {
    chrome.storage.local.get(["automationResults"], function (result) {
      const storedData = result.automationResults || [];
      const count = storedData.length;

      updateStatusButtons(keywords.length, count, currentProcess, totalProcess);
    });
  }

  document.getElementById("startBtn").addEventListener("click", function () {
    if (keywords.length === 0) {
      updateStatus("Please upload a CSV file first");
      return;
    }

    // Save UI state before starting
    saveUIState();

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const batchSize = parseInt(keywordsPerSearchInput.value) || 1;
      const startRow =
        startRowInput && startRowInput.value
          ? parseInt(startRowInput.value)
          : 0;
      const endRow =
        endRowInput && endRowInput.value ? parseInt(endRowInput.value) : null;
      const extractProvided =
        extractProvidedCheckbox && extractProvidedCheckbox.checked;
      const extractIdeas = extractIdeasCheckbox && extractIdeasCheckbox.checked;

      if (!extractProvided && !extractIdeas) {
        alert(
          "Please select at least one extraction option (Provided Keywords or Keyword Ideas)"
        );
        return;
      }

      if (endRow !== null && startRow >= endRow) {
        alert("End row must be greater than start row");
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "startAutomation",
          keywords: keywords,
          batchSize: batchSize,
          startRow: startRow,
          endRow: endRow,
          extractProvided: extractProvided,
          extractIdeas: extractIdeas,
        },
        function (response) {
          if (response && response.success) {
            updateStatus("Automation started...");
            setButtonStates(false, true); // Start disabled, Stop enabled
            // Mark automation as running
            chrome.storage.local.set({ isAutomationRunning: true });
          }
        }
      );
    });
  });

  document.getElementById("stopBtn").addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "stopAutomation" },
        function (response) {
          if (response && response.stopped) {
            console.log("Automation stopped");
            setButtonStates(true, false); // Start enabled, Stop disabled
            updateStatus("Automation stopped by user");
            // Mark automation as stopped
            chrome.storage.local.set({ isAutomationRunning: false });
          }
        }
      );
    });
  });

  document.getElementById("downloadBtn").addEventListener("click", function () {
    chrome.storage.local.get(["automationResults"], function (result) {
      if (result.automationResults && result.automationResults.length > 0) {
        downloadCSV(result.automationResults);
      } else {
        updateStatus("No results to download");
      }
    });
  });

  document.getElementById("clearBtn").addEventListener("click", function () {
    if (confirm("Are you sure you want to clear all stored scraped data?")) {
      chrome.storage.local.remove(
        [
          "automationResults",
          "scrapedKeywords",
          "currentProcess",
          "statusMessage",
          "isAutomationRunning",
        ],
        function () {
          currentProcess = 0;
          updateStatusButtons(keywords.length, 0, 0, totalProcess);
          updateStatus("✓ Stored data cleared successfully");
          setButtonStates(true, false); // Reset buttons to initial state
          setTimeout(() => {
            updateStatus(`Ready to process ${keywords.length} keywords`);
          }, 2000);
        }
      );
    }
  });

  // Add event listeners to save UI state when inputs change
  if (startRowInput) {
    startRowInput.addEventListener("change", saveUIState);
  }
  if (endRowInput) {
    endRowInput.addEventListener("change", saveUIState);
  }
  if (keywordsPerSearchInput) {
    keywordsPerSearchInput.addEventListener("change", saveUIState);
  }
  if (extractProvidedCheckbox) {
    extractProvidedCheckbox.addEventListener("change", saveUIState);
  }
  if (extractIdeasCheckbox) {
    extractIdeasCheckbox.addEventListener("change", saveUIState);
  }

  function downloadCSV(data) {
    // Check which sections should be exported
    const exportProvided =
      extractProvidedCheckbox && extractProvidedCheckbox.checked;
    const exportIdeas = extractIdeasCheckbox && extractIdeasCheckbox.checked;

    // Simple export if only one section is selected
    if (exportProvided && !exportIdeas) {
      // Only export "Keywords you provided" section
      let csv = "Search Keyword,provided,Search Volume\n";

      // Group data by search keyword (batch input)
      const groupedData = {};
      const searchKeywordOrder = [];

      data.forEach((row) => {
        if (row.section === "provided") {
          const searchKey = row.searchKeyword;
          
          if (!groupedData[searchKey]) {
            groupedData[searchKey] = [];
            searchKeywordOrder.push(searchKey);
          }
          
          groupedData[searchKey].push({
            keyword: row.keyword,
            searchVolume: row.searchVolume,
          });
        }
      });

      // Generate CSV with split search keywords
      searchKeywordOrder.forEach((searchKey) => {
        const keywords = groupedData[searchKey];
        
        // Split the search keyword by comma to get individual input keywords
        const inputKeywords = searchKey.split(',').map(k => k.trim());
        
        // Calculate how many rows we need (max of input keywords or provided)
        const maxRows = Math.max(inputKeywords.length, keywords.length);
        
        for (let i = 0; i < maxRows; i++) {
          const searchKeywordCol = inputKeywords[i] || "";
          const providedKeyword = keywords[i] ? keywords[i].keyword : "";
          const providedVolume = keywords[i] ? keywords[i].searchVolume : "";
          
          csv += `"${searchKeywordCol}","${providedKeyword}","${providedVolume}"\n`;
        }
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "provided_keywords_results.csv";
      a.click();
      return;
    }

    if (exportIdeas && !exportProvided) {
      // Only export "Keyword Ideas" section
      let csv = "Search Keyword,Keyword,Search Volume\n";

      // Group data by search keyword (batch input)
      const groupedData = {};
      const searchKeywordOrder = [];

      data.forEach((row) => {
        if (row.section === "ideas") {
          const searchKey = row.searchKeyword;
          
          if (!groupedData[searchKey]) {
            groupedData[searchKey] = [];
            searchKeywordOrder.push(searchKey);
          }
          
          groupedData[searchKey].push({
            keyword: row.keyword,
            searchVolume: row.searchVolume,
          });
        }
      });

      // Generate CSV with split search keywords
      searchKeywordOrder.forEach((searchKey) => {
        const keywords = groupedData[searchKey];
        
        // Split the search keyword by comma to get individual input keywords
        const inputKeywords = searchKey.split(',').map(k => k.trim());
        
        // Calculate how many rows we need (max of input keywords or ideas)
        const maxRows = Math.max(inputKeywords.length, keywords.length);
        
        for (let i = 0; i < maxRows; i++) {
          const searchKeywordCol = inputKeywords[i] || "";
          const ideaKeyword = keywords[i] ? keywords[i].keyword : "";
          const ideaVolume = keywords[i] ? keywords[i].searchVolume : "";
          
          csv += `"${searchKeywordCol}","${ideaKeyword}","${ideaVolume}"\n`;
        }
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "keyword_ideas_results.csv";
      a.click();
      return;
    }

    // CSV format: Group by Search Keyword (batch input)
    // Columns A-C: Search Keyword (each in separate row), Provided keywords, and search volume
    // Columns D-E: Keyword ideas for that batch
    // Group data by search keyword (batch input keywords)
    const groupedData = {};
    const searchKeywordOrder = []; // Maintain order of search keywords

    // First pass: collect all provided keywords for each search keyword batch
    data.forEach((row) => {
      const searchKey = row.searchKeyword;
      
      if (!groupedData[searchKey]) {
        groupedData[searchKey] = {
          searchKeyword: searchKey,
          provided: [],
          ideas: [],
        };
        searchKeywordOrder.push(searchKey);
      }
      
      if (row.section === "provided") {
        groupedData[searchKey].provided.push({
          keyword: row.keyword,
          searchVolume: row.searchVolume,
        });
      } else if (row.section === "ideas") {
        groupedData[searchKey].ideas.push({
          keyword: row.keyword,
          searchVolume: row.searchVolume,
        });
      }
    });

    // Generate CSV with grouped layout
    let csv = "Search Keyword,provided,Search Volume,Keyword,Search Volume\n";

    // Process each search keyword batch in order
    searchKeywordOrder.forEach((searchKey) => {
      const group = groupedData[searchKey];
      
      // Split the search keyword by comma to get individual input keywords
      const inputKeywords = group.searchKeyword.split(',').map(k => k.trim());
      
      // Calculate how many rows we need (max of input keywords, provided, or ideas)
      const maxRows = Math.max(inputKeywords.length, group.provided.length, group.ideas.length);
      
      for (let i = 0; i < maxRows; i++) {
        const searchKeywordCol = inputKeywords[i] || "";
        const providedKeyword = group.provided[i] ? group.provided[i].keyword : "";
        const providedVolume = group.provided[i] ? group.provided[i].searchVolume : "";
        const ideaKeyword = group.ideas[i] ? group.ideas[i].keyword : "";
        const ideaVolume = group.ideas[i] ? group.ideas[i].searchVolume : "";
        
        csv += `"${searchKeywordCol}","${providedKeyword}","${providedVolume}","${ideaKeyword}","${ideaVolume}"\n`;
      }
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keyword_results.csv";
    a.click();
  }

  function updateStatus(message) {
    document.getElementById("status").textContent = message;
    // Save status message to storage for persistence
    chrome.storage.local.set({ statusMessage: message });
  }

  function setButtonStates(startEnabled, stopEnabled) {
    const startButton = document.getElementById("startBtn");
    const stopButtonEl = document.getElementById("stopBtn");

    if (startButton) {
      startButton.disabled = !startEnabled;
      console.log(`Start button ${startEnabled ? "enabled" : "disabled"}`);
    }
    if (stopButtonEl) {
      stopButtonEl.disabled = !stopEnabled;
      console.log(`Stop button ${stopEnabled ? "enabled" : "disabled"}`);
    }
  }

  // Store countdown interval globally to clear if needed
  let countdownInterval = null;

  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    // Handle continuous countdown updates
    if (request.action === "updateCountdown") {
      const countdownSection = document.getElementById("countdownSection");
      const countdownTimer = document.getElementById("countdownTimer");
      
      if (countdownSection && countdownTimer) {
        countdownSection.style.display = "flex";
        countdownTimer.textContent = `${request.seconds}s`;
      }
      
      // Also show in status for redundancy
      updateStatus(`⏱️ ${request.message} ${request.seconds}s`);
    }
    
    // Handle countdown with automatic interval
    else if (request.action === "startCountdown") {
      // Clear any existing countdown
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
      
      let remainingSeconds = request.seconds;
      
      // Show initial countdown immediately
      updateStatus(`⏱️ ${request.message} ${remainingSeconds}s...`);
      
      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds > 0) {
          updateStatus(`⏱️ ${request.message} ${remainingSeconds}s...`);
        } else {
          clearInterval(countdownInterval);
          countdownInterval = null;
          updateStatus("⬇️ Downloading results and opening new page...");
        }
      }, 1000);
    }
    
    // NEW CODE: Handle auto-download trigger
    else if (request.action === "triggerAutoDownload") {
      chrome.storage.local.get(["automationResults"], function (result) {
        if (result.automationResults && result.automationResults.length > 0) {
          downloadCSV(result.automationResults);
          updateStatus(`Auto-downloaded ${result.automationResults.length} keywords`);
          
          // DO NOT clear the data - keep accumulating
          updateStoredDataCount();
        }
      });
    }
    
    // EXISTING CODE CONTINUES BELOW
    else if (request.action === "batchComplete") {
      currentProcess = request.currentBatch;
      // Save current process to storage
      chrome.storage.local.set({ currentProcess: currentProcess });
      updateStoredDataCount();
      setButtonStates(false, true); // Keep Start disabled, Stop enabled during automation
    } else if (request.action === "automationProgress") {
      currentProcess = request.current;
      // Save current process to storage
      chrome.storage.local.set({ currentProcess: currentProcess });
      updateStatus(
        `Processing ${request.current}/${request.total}: ${request.keyword}`
      );
      // Always show current stored count
      chrome.storage.local.get(["automationResults"], function (result) {
        const storedData = result.automationResults || [];
        updateStatusButtons(
          keywords.length,
          storedData.length,
          request.current,
          request.total
        );
      });
      setButtonStates(false, true); // Keep Start disabled, Stop enabled during automation
    } else if (
      request.action === "automationComplete" ||
      request.action === "automationStopped"
    ) {
      // Hide countdown section
      const countdownSection = document.getElementById("countdownSection");
      if (countdownSection) {
        countdownSection.style.display = "none";
      }
      
      // Reset current process when automation completes
      currentProcess = 0;
      chrome.storage.local.set({ currentProcess: 0, isAutomationRunning: false });
      updateStatus(`Complete! Scraped ${request.data.length} total keywords`);
      setButtonStates(true, false); // Start enabled, Stop disabled when complete
      updateStoredDataCount(); // Update the stored count when automation completes

      // Auto-download if signal is present
      if (request.autoDownload && request.data && request.data.length > 0) {
        setTimeout(() => {
          downloadCSV(request.data);
          updateStatus(`Downloaded ${request.data.length} keywords to CSV`);
        }, 500);
      }
    } else if (request.action === "scrapingComplete") {
      updateStoredDataCount();

      // Auto-download if signal is present
      if (request.autoDownload && request.data && request.data.length > 0) {
        setTimeout(() => {
          downloadCSV(request.data);
          updateStatus(`Downloaded ${request.data.length} keywords to CSV`);
        }, 500);
      }
    }
  });
});
