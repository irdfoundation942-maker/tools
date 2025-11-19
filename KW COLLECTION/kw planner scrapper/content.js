// Content script for Google Ads Keyword Planner
console.log("Keyword Planner Scraper: Content script loaded");

// Helper function to parse search volume and get minimum value
function parseSearchVolume(volumeText) {
  if (!volumeText) return 0;

  // Remove spaces and convert to uppercase
  const cleanText = volumeText.replace(/\s/g, "").toUpperCase();

  // Extract the lower bound of the range
  // Examples: "1K-10K" -> 1000, "10K-100K" -> 10000, "100K-1M" -> 100000
  const match = cleanText.match(/^([\d.]+)([KM]?)/);
  if (!match) return 0;

  let value = parseFloat(match[1]);
  const unit = match[2];

  if (unit === "K") {
    value *= 1000;
  } else if (unit === "M") {
    value *= 1000000;
  }

  return value;
}

// Helper function to check if volume is in 1K-10K range
function isInTargetRange(volumeText) {
  const cleanText = volumeText.replace(/\s/g, "").toUpperCase();
  return cleanText === "1K-10K" || cleanText === "1K–10K";
}

// Helper function to check if current page has keywords below 1K (100-1K range)
function checkForBelowThresholdKeywords() {
  const keywordTable =
    document.querySelector(".ess-table-canvas") ||
    document.querySelector('div[role="grid"]') ||
    document.querySelector(".particle-table-canvas");

  if (!keywordTable) {
    return false;
  }

  // Get all volume elements on current page
  const volumeElements = keywordTable.querySelectorAll(".value-text");

  for (const volumeElement of volumeElements) {
    const volumeText = volumeElement.textContent.trim();
    const minVolume = parseSearchVolume(volumeText);

    // Check if we found any keyword with volume < 1000 (e.g., 100-1K)
    if (minVolume > 0 && minVolume < 1000) {
      console.log(`Found keyword below 1K threshold: ${volumeText}`);
      return true;
    }
  }

  return false;
}

// Function to scrape keyword data from the current page
function scrapeKeywordData(skipVolumeFilter = false, batchInputKeywords = null) {
  const keywordData = [];
  const providedKeywords = []; // Store provided keywords to link ideas to them

  // Debug: Log the page structure
  console.log("Page title:", document.title);
  console.log("Page URL:", window.location.href);

  // Look for the specific keyword results table
  let keywordTable = null;

  // Try to find the main results container - prioritize ess-table-canvas based on debug info
  keywordTable =
    document.querySelector(".ess-table-canvas") ||
    document.querySelector('div[role="grid"]') ||
    document.querySelector(".particle-table-canvas");

  if (!keywordTable) {
    console.error("Keyword table not found");
    return null;
  }

  console.log("Found keyword table");

  // Get the search keyword from the page - use batch input keywords if provided
  const searchKeyword = batchInputKeywords ? batchInputKeywords.join(", ") : getSearchKeyword();

  let currentSection = ""; // Track if we're in "Keywords you provided" or "Keyword ideas"
  let currentProvidedKeyword = ""; // Track which provided keyword we're processing ideas for

  // First, find all section headers to determine the current section
  const sectionHeaders = Array.from(
    keywordTable.querySelectorAll(".group-header")
  );

  // If no group headers found, try alternative approach
  if (sectionHeaders.length === 0) {
    console.log("No group headers found, trying alternative approach");

    // Look for all rows with role="row" that contain keyword data
    const allRows = Array.from(keywordTable.querySelectorAll('[role="row"]'));

    allRows.forEach((row, index) => {
      // Skip header rows
      if (row.classList.contains("particle-table-header")) {
        return;
      }

      // Try to extract keyword from the keyword-text element
      const keywordElement = row.querySelector(".keyword");
      let keyword = "";
      if (keywordElement) {
        keyword = keywordElement.textContent.trim();
      }

      // Extract search volume from the value-text element
      let searchVolume = "";
      const volumeElement = row.querySelector(".value-text");
      if (volumeElement) {
        searchVolume = volumeElement.textContent.trim();
      }

      // Only add if we have both keyword and search volume
      if (keyword && searchVolume) {
        let section = "ideas"; // Default to ideas

        // Check if this might be a provided keyword
        const ariaLabel = row
          .querySelector(".keyword-text")
          ?.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.includes("keyword you provided")) {
          section = "provided";
          providedKeywords.push(keyword);
          currentProvidedKeyword = keyword;
        }

        // Apply volume filter ONLY to 'ideas', NEVER to 'provided' keywords
        const minVolume = parseSearchVolume(searchVolume);
        const shouldInclude =
          section === "provided" || skipVolumeFilter || minVolume >= 1000;

        if (shouldInclude) {
          // For 'provided' section: searchKeyword = batch input keywords, keyword = actual found keyword
          // For 'ideas' section: searchKeyword = batch input keywords (not individual provided keyword)
          keywordData.push({
            searchKeyword: searchKeyword, // Always use batch input keywords
            keyword: keyword,
            searchVolume: searchVolume,
            section: section,
          });

          console.log(
            `Extracted keyword: ${keyword}, Volume: ${searchVolume}, Section: ${section}, Search Keyword: ${searchKeyword}`
          );
        }
      }
    });
  } else {
    // Process each section
    sectionHeaders.forEach((header) => {
      const headerText = header.textContent.trim();

      if (headerText.includes("Keywords you provided")) {
        currentSection = "provided";
        console.log("Found 'Keywords you provided' section");
      } else if (headerText.includes("Keyword ideas")) {
        currentSection = "ideas";
        console.log("Found 'Keyword ideas' section");
      }

      // Get all rows after this header until the next header
      let nextElement = header.nextElementSibling;
      while (nextElement && !nextElement.classList.contains("group-header")) {
        // Check if this is a keyword row
        if (
          nextElement.classList.contains("particle-table-row") &&
          nextElement.getAttribute("role") === "row"
        ) {
          // Extract keyword from the keyword-text element
          const keywordElement = nextElement.querySelector(".keyword");
          let keyword = "";
          if (keywordElement) {
            keyword = keywordElement.textContent.trim();
          }

          // Extract search volume from the value-text element
          let searchVolume = "";
          const volumeElement = nextElement.querySelector(".value-text");
          if (volumeElement) {
            searchVolume = volumeElement.textContent.trim();
          }

          // Only add if we have both keyword and search volume
          if (keyword && searchVolume) {
            // Store provided keywords for linking
            if (currentSection === "provided") {
              providedKeywords.push(keyword);
              currentProvidedKeyword = keyword;
            }

            // Apply volume filter ONLY to 'ideas', NEVER to 'provided' keywords
            const minVolume = parseSearchVolume(searchVolume);
            const shouldInclude =
              currentSection === "provided" ||
              skipVolumeFilter ||
              minVolume >= 1000;

            if (shouldInclude) {
              // For 'provided' section: searchKeyword = batch input keywords, keyword = actual found keyword
              // For 'ideas' section: searchKeyword = batch input keywords (not individual provided keyword)
              keywordData.push({
                searchKeyword: searchKeyword, // Always use batch input keywords
                keyword: keyword,
                searchVolume: searchVolume,
                section: currentSection, // 'provided' or 'ideas'
              });

              console.log(
                `Extracted keyword: ${keyword}, Volume: ${searchVolume}, Section: ${currentSection}, Search Keyword: ${searchKeyword}`
              );
            }
          }
        }

        nextElement = nextElement.nextElementSibling;
      }
    });
  }

  console.log("Total keywords extracted:", keywordData.length);

  // If we still don't have data, try a more aggressive approach
  if (keywordData.length === 0) {
    console.log("Trying more aggressive approach");

    // Look for any elements that contain both text and search volume patterns
    const allElements = document.querySelectorAll("*");

    for (let i = 0; i < Math.min(allElements.length, 2000); i++) {
      const el = allElements[i];
      const text = el.textContent.trim();

      // Skip if it's too long or too short
      if (text.length < 5 || text.length > 200) continue;

      // Skip if it looks like UI text
      if (
        text.includes("edit") ||
        text.includes("translate") ||
        text.includes("manage") ||
        text.includes("calendar_today") ||
        text.includes("location_on") ||
        text.includes("arrow_drop_down") ||
        text.includes("chevron_right") ||
        text.includes("GMT") ||
        text.includes("AM") ||
        text.includes("PM")
      ) {
        continue;
      }

      // Check if it matches the pattern of keyword + search volume
      const match = text.match(/^([^\d\n]+?)\s+([\d,\-\sKM]+)$/);
      if (match) {
        const keyword = match[1].trim();
        const searchVolume = match[2].trim();

        if (keyword && searchVolume) {
          const minVolume = parseSearchVolume(searchVolume);
          // For unknown section, apply volume filter (unless skipVolumeFilter)
          if (skipVolumeFilter || minVolume >= 1000) {
            keywordData.push({
              searchKeyword: searchKeyword,
              keyword: keyword,
              searchVolume: searchVolume,
              section: "unknown",
            });
          }
        }
      }
    }

    console.log("Aggressive approach extracted keywords:", keywordData.length);
  }

  return keywordData;
}

// Function to get the search keyword from the page
function getSearchKeyword() {
  // Debug: Log what we're looking for
  console.log("Looking for search keyword...");

  // Try to find the search input field
  const searchInput = document.querySelector(
    'input[placeholder*="keyword"], input[aria-label*="keyword"], input[placeholder*="Keyword"]'
  );
  if (searchInput && searchInput.value) {
    console.log("Found search input:", searchInput.value);
    return searchInput.value.trim();
  }

  // Try to find the keyword in the page title or header
  const pageTitle = document.querySelector(
    "h1, .page-title, .keyword-search-term"
  );
  if (pageTitle) {
    const titleText = pageTitle.textContent.trim();
    if (titleText && titleText !== "Keyword Planner") {
      console.log("Found page title:", titleText);
      return titleText;
    }
  }

  // Try to extract from the first keyword in the "Keywords you provided" section
  const providedSection = Array.from(
    document.querySelectorAll(".particle-table-row.group-header")
  ).find((el) => el.textContent.includes("Keywords you provided"));

  if (providedSection) {
    const nextRow = providedSection.nextElementSibling;
    if (nextRow) {
      const firstKeyword = nextRow.querySelector(".keyword");
      if (firstKeyword) {
        console.log(
          "Found first keyword in provided section:",
          firstKeyword.textContent
        );
        return firstKeyword.textContent.trim();
      }
    }
  }

  // Try to find any element that looks like a search term
  const possibleSearchTerms = document.querySelectorAll(
    '[class*="search"], [class*="keyword"], [class*="query"]'
  );
  for (let i = 0; i < possibleSearchTerms.length; i++) {
    const el = possibleSearchTerms[i];
    const text = el.textContent.trim();
    if (
      text &&
      text.length > 2 &&
      text.length < 100 &&
      !text.includes("Menu") &&
      !text.includes("Help")
    ) {
      console.log("Found possible search term:", text);
      return text;
    }
  }

  // Try to extract from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const keywordParam =
    urlParams.get("keyword") || urlParams.get("query") || urlParams.get("term");
  if (keywordParam) {
    console.log("Found keyword in URL:", keywordParam);
    return keywordParam;
  }

  // Fallback to a default value
  console.log("Using default keyword");
  return "Unknown";
}

// Function to check and ensure correct location setting
async function ensureCorrectLocation() {
  // Find the location button
  const locationButton = document.querySelector(".location-button .value");

  if (!locationButton) {
    console.log("Location button not found");
    return false;
  }

  const locationText = locationButton.textContent.trim();
  console.log(`Current location: ${locationText}`);

  // If already "All locations", no need to change
  if (locationText === "All locations") {
    console.log("Location already set to 'All locations'");
    return true;
  }

  // Need to change location - click the location button
  console.log("Need to change location to 'All locations'");
  const locationButtonContainer = document.querySelector(".location-button");
  locationButtonContainer.click();

  // Wait for dialog to open
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Find and click the "Remove all" button (cancel icon in header)
  const removeAllButton =
    document.querySelector('i[aria-label*="Remove all targeted locations"]') ||
    document.querySelector(
      'material-icon i[aria-label="Remove all targeted locations"]'
    ) ||
    document.querySelector('th.remove material-icon[icon="cancel"]');

  if (removeAllButton) {
    console.log("Clicking remove all locations button");
    removeAllButton.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Click the Save button
  const saveButton = document.querySelector(
    "material-yes-no-buttons .btn-yes.highlighted"
  );

  if (saveButton) {
    console.log("Clicking save button");
    saveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  }

  console.error("Save button not found");
  return false;
}

// Function to check and ensure correct network setting
async function ensureCorrectNetwork() {
  // Find the network button value
  const networkButtonValue = document.querySelector(".network-button .value");

  if (!networkButtonValue) {
    console.log("Network button not found");
    return false;
  }

  const networkText = networkButtonValue.textContent.trim();
  console.log(`Current network: ${networkText}`);

  // If already "Google and search partners", no need to change
  if (networkText === "Google and search partners") {
    console.log("Network already set to 'Google and search partners'");
    return true;
  }

  // Need to change network - click the network button
  console.log("Need to change network to 'Google and search partners'");
  const networkButton = document
    .querySelector(".network-button")
    .closest('[role="button"]');

  if (!networkButton) {
    console.log("Network button container not found");
    return false;
  }

  networkButton.click();

  // Wait for dropdown to open
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Find and click the "Google and search partners" option
  const googleAndPartnersOption = Array.from(
    document.querySelectorAll("material-select-dropdown-item")
  ).find((item) => item.textContent.trim() === "Google and search partners");

  if (googleAndPartnersOption) {
    console.log("Clicking 'Google and search partners' option");
    googleAndPartnersOption.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  }

  console.error("'Google and search partners' option not found");
  return false;
}

// Function to click keyword header (by relevance)
async function ensureKeywordSorting() {
  // Find the "Keyword (by relevance)" column header
  const keywordHeader = document.querySelector(
    '.particle-table-header-cell[essfield="text"]'
  );

  if (!keywordHeader) {
    console.log("Keyword header not found");
    return false;
  }

  console.log("Clicking Keyword (by relevance) header");
  keywordHeader.click();

  // Wait for sort to complete
  await new Promise((resolve) => setTimeout(resolve, 800));

  return true;
}

// Function to click search volume header
async function ensureSearchVolumeSorting() {
  // Find the "Avg. monthly searches" column header
  const searchVolumeHeader = document.querySelector(
    '.particle-table-header-cell[essfield="search_volume"]'
  );

  if (!searchVolumeHeader) {
    console.log("Search volume header not found");
    return false;
  }

  // Check if it's already sorted descending
  const isSortedDesc = searchVolumeHeader.classList.contains("sort-desc");

  if (!isSortedDesc) {
    console.log("Clicking to sort by Avg. monthly searches (descending)");
    searchVolumeHeader.click();

    // Wait for sort to complete
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Check if we need to click again (if it sorted ascending first)
    const headerAfterClick = document.querySelector(
      '.particle-table-header-cell[essfield="search_volume"]'
    );
    if (headerAfterClick && !headerAfterClick.classList.contains("sort-desc")) {
      console.log("Clicking again to reverse sort order");
      headerAfterClick.click();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  return true;
}

// Function to ensure rows are set to 500
async function ensureRowsSet500() {
  // First, scroll to the bottom of the page to make the row selection button visible
  const scrollContainer =
    document.querySelector(".awsm-nav-bar-and-content") ||
    document.querySelector('div[class*="awsm-nav-bar-and-content"]') ||
    document.querySelector(".awsm-sub-container > div:last-child");

  if (scrollContainer) {
    console.log("Scrolling to bottom to access row selection button...");
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Find the row selection button - try multiple selectors
  let rowSelectionButton = Array.from(
    document.querySelectorAll("dropdown-button .button")
  ).find((btn) => {
    const buttonText = btn.querySelector(".button-text");
    return buttonText && buttonText.textContent.trim().match(/^\d+$/);
  });

  // Alternative selector if first one doesn't work
  if (!rowSelectionButton) {
    rowSelectionButton = Array.from(
      document.querySelectorAll('dropdown-button[class*="_nghost"] .button')
    ).find((btn) => {
      return (
        btn.textContent.includes("10") ||
        btn.textContent.includes("30") ||
        btn.textContent.includes("50") ||
        btn.textContent.includes("100") ||
        btn.textContent.includes("200") ||
        btn.textContent.includes("500")
      );
    });
  }

  if (!rowSelectionButton) {
    console.log("Row selection button not found");
    return false;
  }

  const currentRows = rowSelectionButton
    .querySelector(".button-text")
    ?.textContent.trim();
  console.log(`Current rows setting: ${currentRows}`);

  // If already set to 500, no need to change
  if (currentRows === "500") {
    console.log("Rows already set to 500");
    // Scroll back to top
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return true;
  }

  // Need to change to 500 - click the button to open dropdown
  console.log("Setting rows to 500...");
  rowSelectionButton.click();

  // Wait for dropdown to open
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Find and click the "500" option
  const option500 = Array.from(
    document.querySelectorAll("material-select-dropdown-item")
  ).find((item) => {
    const label = item.querySelector(".label");
    return label && label.textContent.trim() === "500";
  });

  if (option500) {
    console.log("Clicking 500 rows option");
    option500.click();
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Scroll back to top after setting rows
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return true;
  }

  console.error("500 rows option not found");
  return false;
}

// Function to check if we're on the home page and navigate to search
async function handleHomePage(useDefaultKeyword = true) {
  const currentUrl = window.location.href;
  
  // Check if we're on the overview page - need to navigate to Keyword Planner first
  if (currentUrl.includes('/overview')) {
    console.log("Detected overview page, navigating to Keyword Planner first...");
    const navigated = await navigateFromOverviewToKeywordPlanner();
    if (!navigated) {
      console.error("Failed to navigate from overview to Keyword Planner");
      return false;
    }
    // After navigation, wait for page to load and continue with normal flow
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Now we should be on the home page, continue with normal flow below
  }
  
  // Check if we're on the ideas/new page (after clicking Discover new keywords)
  if (currentUrl.includes('/ideas/new')) {
    console.log("Already on keyword ideas page, waiting for page to be ready...");
    
    // Wait for the search input to be available
    for (let attempts = 0; attempts < 30; attempts++) {
      const searchInput = document.querySelector('.search-input[role="textbox"][aria-label="Search input"]');
      if (searchInput) {
        console.log("Ideas page ready, search box found");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log("Ideas page loaded, ready to continue");
    return true;
  }
  
  if (!currentUrl.includes('/home') && !window.location.href.includes('/home')) {
    console.log("Not on home page, skipping home page handler");
    return true; // Already on the right page
  }
  
  console.log("Detected home page, looking for 'Discover new keywords' button");
  
  // Find the "Discover new keywords" button
  // Try multiple selectors to find the button
  let discoverButton = null;
  
  // Wait for the button to be available
  for (let attempts = 0; attempts < 20; attempts++) {
    // Try to find by text content
    discoverButton = Array.from(document.querySelectorAll('material-button, button, [role="button"]')).find(btn => 
      btn.textContent.toLowerCase().includes('discover new keywords')
    );
    
    // Alternative: try to find by specific class or structure
    if (!discoverButton) {
      discoverButton = document.querySelector('material-card material-button[aria-label*="Discover"]');
    }
    
    if (!discoverButton) {
      discoverButton = document.querySelector('[class*="card"] material-button, [class*="card"] button');
    }
    
    if (discoverButton) {
      console.log("Found 'Discover new keywords' button");
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  if (!discoverButton) {
    console.error("Could not find 'Discover new keywords' button");
    return false;
  }
  
  // Click the button
  console.log("Clicking 'Discover new keywords' button");
  discoverButton.click();
  
  // Wait for the page to navigate/load to the ideas/new page
  await new Promise(resolve => setTimeout(resolve, 400)); // Reduced from 600ms
  
  // Wait for the search box to appear on the ideas page
  for (let attempts = 0; attempts < 30; attempts++) {
    const searchInput = document.querySelector('.search-input[role="textbox"][aria-label="Search input"]');
    if (searchInput) {
      console.log("Search box appeared on ideas page");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // Reduced from 150ms
  }
  
  // IMPORTANT: Wait for network, location, and other controls to be available
  console.log("Waiting for page controls to be fully loaded...");
  let controlsReady = false;
  for (let attempts = 0; attempts < 30; attempts++) {
    const networkButton = document.querySelector(".network-button .value");
    const locationButton = document.querySelector(".location-button .value");
    
    if (networkButton && locationButton) {
      console.log("Page controls are ready");
      controlsReady = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 150)); // Reduced from 200ms
  }
  
  if (!controlsReady) {
    console.log("Warning: Page controls may not be fully loaded, but continuing...");
  }
  
  // Additional wait to ensure page is stable
  await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 300ms
  
  // If we should use default keyword to initialize the page
  if (useDefaultKeyword) {
    console.log("Inputting default keyword 'dhaka' to activate page...");
    await inputKeywordToSearchBox(["dhaka"]);
    await new Promise(resolve => setTimeout(resolve, 400)); // Reduced from 800ms
    
    // Click Get results to fully initialize the page
    try {
      await clickGetResultsButton();
      console.log("Clicked Get results with default keyword");
      await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1500ms
      
      // Wait for results to load
      await waitForResults();
      console.log("Default search completed, page fully initialized");
    } catch (error) {
      console.log("Could not complete default search, but continuing...");
    }
  }
  
  console.log("Ideas page fully loaded and ready");
  
  return true;
}

// Function to input multiple keywords into search box
async function inputKeywordToSearchBox(keywords) {
  // keywords can be a string (single keyword) or array (multiple keywords)
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords];

  // Step 1: Find and remove existing chips/keywords
  const removeButtons = document.querySelectorAll(
    '.delete-button[aria-label="Delete"]'
  );

  if (removeButtons.length > 0) {
    console.log(`Removing ${removeButtons.length} existing keyword(s)...`);
    for (const btn of removeButtons) {
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // Step 2: Find the input field
  const searchInput = document.querySelector(
    '.search-input[role="textbox"][aria-label="Search input"]'
  );

  if (!searchInput) {
    console.error("Search input not found");
    return false;
  }

  // Step 3: Input all keywords together separated by commas
  searchInput.value = "";
  searchInput.focus();
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Create comma-separated keyword string
  const keywordString = keywordArray.join(", ");

  // Simulate character-by-character typing of the entire comma-separated string
  for (let i = 0; i < keywordString.length; i++) {
    searchInput.value += keywordString[i];

    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    searchInput.dispatchEvent(inputEvent);

    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  console.log(
    `Inputted ${keywordArray.length} keyword(s) as comma-separated string: ${keywordString}`
  );

  // Final cleanup
  const changeEvent = new Event("change", { bubbles: true, cancelable: true });
  const blurEvent = new Event("blur", { bubbles: true, cancelable: true });

  searchInput.dispatchEvent(changeEvent);
  searchInput.dispatchEvent(blurEvent);

  console.log(
    `Inputted ${keywordArray.length} keyword(s): ${keywordArray.join(", ")}`
  );

  await new Promise((resolve) => setTimeout(resolve, 400));

  return true;
}

// Function to click "Get results" button
function clickGetResultsButton() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 40; // Increased attempts

    const checkForButton = setInterval(() => {
      // Try multiple selectors for the button
      const getResultsButton =
        document.querySelector(
          'material-button.submit-button[aria-disabled="false"]'
        ) ||
        document.querySelector('.submit-button[aria-disabled="false"]') ||
        Array.from(document.querySelectorAll("material-button")).find(
          (btn) =>
            btn.textContent.trim().toLowerCase().includes("get results") &&
            btn.getAttribute("aria-disabled") === "false"
        );

      if (getResultsButton) {
        clearInterval(checkForButton);

        console.log("Found enabled 'Get results' button");

        // Click the button
        getResultsButton.click();
        console.log("Clicked 'Get results' button");

        resolve(true);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkForButton);
        console.error(
          "Get results button not found or disabled after all attempts"
        );
        reject(false);
      }

      attempts++;
    }, 400); // Check every 400ms
  });
}

// Function to wait for results to load
function waitForResults() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 50; // Wait up to 25 seconds
    let previousRowCount = 0;
    let stableCount = 0;

    const checkForResults = setInterval(() => {
      const keywordTable =
        document.querySelector(".ess-table-canvas") ||
        document.querySelector('div[role="grid"]') ||
        document.querySelector(".particle-table-canvas");

      if (!keywordTable) {
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(checkForResults);
          console.log("Timeout waiting for results - table not found");
          resolve(false);
        }
        return;
      }

      const currentRowCount =
        keywordTable.querySelectorAll('[role="row"]').length;
      const hasRows = currentRowCount > 1;

      // Check if row count is stable (not changing)
      if (currentRowCount === previousRowCount && hasRows) {
        stableCount++;
        if (stableCount >= 3) {
          // Wait for 3 consecutive stable checks
          clearInterval(checkForResults);
          console.log("Results loaded and stable");
          resolve(true);
        }
      } else {
        stableCount = 0;
        previousRowCount = currentRowCount;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkForResults);
        console.log("Timeout waiting for results");
        resolve(hasRows);
      }

      attempts++;
    }, 500);
  });
}

// Function to scroll container and load all results
async function scrollAndLoadAllResults() {
  // Find the scrollable container
  const scrollContainer =
    document.querySelector(".awsm-nav-bar-and-content") ||
    document.querySelector('div[class*="awsm-nav-bar-and-content"]') ||
    document.querySelector(".awsm-sub-container > div:last-child");

  if (!scrollContainer) {
    console.log("Scroll container not found");
    return false;
  }

  console.log("Found scroll container, starting fast scroll...");

  let previousHeight = 0;
  let currentHeight = scrollContainer.scrollHeight;
  let stableCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 100;

  while (stableCount < 3 && scrollAttempts < maxScrollAttempts) {
    // Scroll to bottom quickly
    scrollContainer.scrollTop = scrollContainer.scrollHeight;

    // Short wait for content to load
    await new Promise((resolve) => setTimeout(resolve, 200));

    currentHeight = scrollContainer.scrollHeight;

    // Check if height changed (new content loaded)
    if (currentHeight === previousHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      previousHeight = currentHeight;
    }

    scrollAttempts++;
  }

  console.log(
    `Scrolling complete after ${scrollAttempts} attempts. Final height: ${currentHeight}`
  );

  // Wait a bit for final rendering
  await new Promise((resolve) => setTimeout(resolve, 500));

  return true;
}

// Helper function to navigate from overview page to keyword planner
async function navigateFromOverviewToKeywordPlanner() {
  console.log("Detected overview page, navigating to Keyword Planner...");
  
  // Step 1: Click the "Tools" sidebar button
  const toolsButton = document.querySelector('sidebar-panel[id="navigation.tools"] a[title="Tools"]');
  if (toolsButton) {
    console.log("Clicking Tools button...");
    toolsButton.click();
    await new Promise(resolve => setTimeout(resolve, 800));
  } else {
    console.error("Tools button not found");
    return false;
  }
  
  // Step 2: Check if Planning section is already expanded
  const planningPanel = document.querySelector('sidebar-panel[id="navigation.tools.planning"]');
  if (!planningPanel) {
    console.error("Planning panel not found");
    return false;
  }
  
  // Check if Planning section is already expanded by looking at aria-expanded attribute
  const planningButton = planningPanel.querySelector('a[title="Planning"]');
  if (!planningButton) {
    console.error("Planning button not found");
    return false;
  }
  
  const isExpanded = planningButton.getAttribute('aria-expanded') === 'true';
  
  console.log(`Planning section expanded state: ${isExpanded} (aria-expanded: ${planningButton.getAttribute('aria-expanded')})`);
  
  if (isExpanded) {
    console.log("Planning section already expanded (arrow up), skipping Planning button click");
  } else {
    console.log("Planning section collapsed (arrow down), clicking Planning button to expand...");
    planningButton.click();
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  // Step 3: Click the "Keyword Planner" sidebar button
  const kwPlannerButton = document.querySelector('sidebar-panel[id="navigation.tools.planning.keywordPlanner"] a[title="Keyword Planner"]');
  if (kwPlannerButton) {
    console.log("Clicking Keyword Planner button...");
    kwPlannerButton.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } else {
    console.error("Keyword Planner button not found");
    return false;
  }
}

// Main automation function
let automationRunning = false;
let allAutomationData = [];
let stopRequested = false;
let extractProvidedMode = true;
let extractIdeasMode = true;

// Resume automation from a specific batch index
async function resumeAutomationFromBatch(
  keywords,
  batchSize,
  startRow,
  endRow,
  extractProvided,
  extractIdeas,
  startBatchIndex
) {
  console.log(`Resuming automation from batch ${startBatchIndex + 1}`);
  
  automationRunning = true;
  stopRequested = false;
  extractProvidedMode = extractProvided;
  extractIdeasMode = extractIdeas;
  
  // Get accumulated data from storage
  chrome.storage.local.get(['automationResults'], function(result) {
    allAutomationData = result.automationResults || [];
  });
  
  const effectiveEndRow = endRow !== null ? Math.min(endRow, keywords.length) : keywords.length;
  const filteredKeywords = keywords;
  
  // Start NEW cycle timer from this point
  let cycleStartTime = Date.now();
  const CYCLE_DURATION = 600000; // 600 seconds (10 minutes) in milliseconds
  
  // Function to send countdown updates
  let countdownUpdateInterval = null;
  function startCountdownUpdates() {
    // Clear any existing interval
    if (countdownUpdateInterval) {
      clearInterval(countdownUpdateInterval);
    }
    
    // Send updates every 5 seconds
    countdownUpdateInterval = setInterval(() => {
      const elapsed = Date.now() - cycleStartTime;
      const remaining = Math.max(0, CYCLE_DURATION - elapsed);
      const remainingSeconds = Math.ceil(remaining / 1000);
      
      if (remainingSeconds > 0 && automationRunning) {
        chrome.runtime.sendMessage({
          action: "updateCountdown",
          seconds: remainingSeconds,
          message: "Next auto-download in"
        });
      } else {
        clearInterval(countdownUpdateInterval);
        countdownUpdateInterval = null;
      }
    }, 1000); // Update every 1 second for smoother countdown
  }
  
  // Navigate from home page with default keyword to initialize
  console.log("Waiting for home page to fully load before navigation...");
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to be stable
  
  const homeHandled = await handleHomePage(true); // true = use default keyword
  if (!homeHandled) {
    console.error("Failed to handle home page navigation");
    automationRunning = false;
    chrome.runtime.sendMessage({ action: "automationStopped" });
    return;
  }
  
  // Setup configurations with delays between each setting
  console.log("Setting up network, location and rows after navigation...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await ensureCorrectNetwork();
  await new Promise(resolve => setTimeout(resolve, 300));
  await ensureCorrectLocation();
  await new Promise(resolve => setTimeout(resolve, 300));
  await ensureRowsSet500();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Input first batch of remaining keywords
  const firstBatchSize = Math.min(batchSize, filteredKeywords.length - (startBatchIndex * batchSize));
  const firstBatchKeywords = filteredKeywords.slice(startBatchIndex * batchSize, startBatchIndex * batchSize + firstBatchSize);
  
  await inputKeywordToSearchBox(firstBatchKeywords);
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Process remaining batches starting from startBatchIndex
  const totalBatches = Math.ceil(filteredKeywords.length / batchSize);
  
  for (let batchIndex = startBatchIndex; batchIndex < totalBatches; batchIndex++) {
    if (!automationRunning || stopRequested) {
      console.log("Automation stopped by user");
      automationRunning = false;
      chrome.runtime.sendMessage({ action: "automationStopped" });
      return;
    }
    
    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, filteredKeywords.length);
    const batchKeywords = filteredKeywords.slice(startIdx, endIdx);
    
    console.log(`Processing batch ${batchIndex + 1}/${totalBatches}: ${batchKeywords.join(", ")}`);
    
    // Notify popup
    chrome.runtime.sendMessage({
      action: "automationProgress",
      current: startRow + endIdx,
      total: effectiveEndRow,
      keyword: batchKeywords.join(", "),
      processedCount: allAutomationData.length,
    });
    
    // Re-check settings for batches after first
    if (batchIndex > startBatchIndex) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await ensureCorrectNetwork();
      await ensureCorrectLocation();
      await ensureRowsSet500();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const inputSuccess = await inputKeywordToSearchBox(batchKeywords);
      if (!inputSuccess) {
        console.error(`Failed to input batch: ${batchKeywords.join(", ")}`);
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    if (stopRequested) break;
    
    // Click Get results
    try {
      await clickGetResultsButton();
    } catch (error) {
      console.error(`Failed to click Get results for batch: ${batchKeywords.join(", ")}`);
      continue;
    }
    
    if (stopRequested) break;
    
    // Wait and scrape
    await waitForResults();
    const data = await scrapeAllPages(batchKeywords);
    
    if (data && data.length > 0) {
      let filteredData = data;
      if (!extractProvidedMode || !extractIdeasMode) {
        filteredData = data.filter((kw) => {
          if (extractProvidedMode && kw.section === "provided") return true;
          if (extractIdeasMode && kw.section === "ideas") return true;
          return false;
        });
      }
      
      allAutomationData = allAutomationData.concat(filteredData);
      
      // Store immediately
      chrome.storage.local.get(["automationResults"], function (result) {
        const existingData = result.automationResults || [];
        const mergedData = existingData.concat(filteredData);
        
        chrome.storage.local.set({ automationResults: mergedData }, function () {
          chrome.runtime.sendMessage({
            action: "batchComplete",
            batchData: filteredData,
            totalStored: mergedData.length,
            currentBatch: batchIndex + 1,
            totalBatches: totalBatches,
          });
          
          // Start sending periodic countdown updates after first batch completes
          if (batchIndex === startBatchIndex) {
            startCountdownUpdates();
          }
        });
      });
    }
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // Check if 60 seconds have elapsed since cycle start
    const elapsedTime = Date.now() - cycleStartTime;
    const shouldResetCycle = elapsedTime >= CYCLE_DURATION && batchIndex < totalBatches - 1;
    
    if (shouldResetCycle) {
      console.log(`Cycle time reached (${Math.floor(elapsedTime / 1000)}s). Downloading and resetting...`);
      
      const remainingTime = Math.max(0, CYCLE_DURATION - elapsedTime);
      const remainingSeconds = Math.ceil(remainingTime / 1000);
      
      // Show countdown
      chrome.runtime.sendMessage({
        action: "startCountdown",
        seconds: remainingSeconds,
        message: "Auto-download and new page in"
      });
      
      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      }
      
      chrome.runtime.sendMessage({
        action: "triggerAutoDownload"
      });
      
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      console.log("Closing current tab and opening new home page...");
      chrome.runtime.sendMessage({
        action: "closeAndReopenTab",
        continueAutomation: true,
        nextBatchIndex: batchIndex + 1,
        automationConfig: {
          keywords: filteredKeywords,
          batchSize: batchSize,
          startRow: startRow,
          effectiveEndRow: effectiveEndRow,
          extractProvided: extractProvidedMode,
          extractIdeas: extractIdeasMode
        }
      });
      
      return;
    }
  }
  
  // Complete
  automationRunning = false;
  chrome.storage.local.get(["automationResults"], function (result) {
    const finalData = result.automationResults || [];
    chrome.runtime.sendMessage({
      action: "automationComplete",
      total: effectiveEndRow - startRow,
      data: finalData,
      autoDownload: true,
    });
  });
}

async function runAutomation(
  keywords,
  batchSize = 1,
  startRow = 0,
  endRow = null,
  extractProvided = true,
  extractIdeas = true
) {
  automationRunning = true;
  stopRequested = false;
  allAutomationData = [];
  extractProvidedMode = extractProvided;
  extractIdeasMode = extractIdeas;

  // Apply row range filter
  const effectiveEndRow =
    endRow !== null ? Math.min(endRow, keywords.length) : keywords.length;
  const filteredKeywords = keywords.slice(startRow, effectiveEndRow);

  console.log(
    `Processing keywords from row ${startRow + 1} to ${effectiveEndRow} (${
      filteredKeywords.length
    } keywords)`
  );
  console.log(
    `Extract mode: Provided=${extractProvided}, Ideas=${extractIdeas}`
  );

  // Ensure batch size is within limits
  batchSize = Math.min(Math.max(1, batchSize), 10);

  // Start timer for 1-minute cycles
  let cycleStartTime = Date.now();
  const CYCLE_DURATION = 600000; // 600 seconds (10 minutes) in milliseconds
  
  // Function to send countdown updates
  let countdownUpdateInterval = null;
  function startCountdownUpdates() {
    // Clear any existing interval
    if (countdownUpdateInterval) {
      clearInterval(countdownUpdateInterval);
    }
    
    // Send updates every 5 seconds
    countdownUpdateInterval = setInterval(() => {
      const elapsed = Date.now() - cycleStartTime;
      const remaining = Math.max(0, CYCLE_DURATION - elapsed);
      const remainingSeconds = Math.ceil(remaining / 1000);
      
      if (remainingSeconds > 0 && automationRunning) {
        chrome.runtime.sendMessage({
          action: "updateCountdown",
          seconds: remainingSeconds,
          message: "Next auto-download in"
        });
      } else {
        clearInterval(countdownUpdateInterval);
        countdownUpdateInterval = null;
      }
    }, 1000); // Update every 1 second for smoother countdown
  }

  // First, check if we're on the home page and navigate if needed
  console.log("Checking if on home page...");
  
  // Navigate to ideas page WITH default keyword to initialize
  const homeHandled = await handleHomePage(true); // true = use default keyword
  if (!homeHandled) {
    console.error("Failed to handle home page navigation");
    automationRunning = false;
    chrome.runtime.sendMessage({ action: "automationStopped" });
    return allAutomationData;
  }
  
  // Ensure correct network, location and rows BEFORE inputting any keywords
  console.log("Setting up network, location and rows...");
  
  // Add longer delay before setup to ensure page is ready after navigation
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await ensureCorrectNetwork();
  await new Promise(resolve => setTimeout(resolve, 300));
  await ensureCorrectLocation();
  await new Promise(resolve => setTimeout(resolve, 300));
  await ensureRowsSet500();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Additional wait after all settings are configured
  await new Promise(resolve => setTimeout(resolve, 800));
  
  console.log("Setup complete, now inputting first batch of keywords...");
  
  // NOW input the first batch of keywords AFTER all settings are configured
  const firstBatchSize = Math.min(batchSize, filteredKeywords.length);
  const firstBatchKeywords = filteredKeywords.slice(0, firstBatchSize);
  
  const firstInputSuccess = await inputKeywordToSearchBox(firstBatchKeywords);
  if (!firstInputSuccess) {
    console.error(`Failed to input first batch: ${firstBatchKeywords.join(", ")}`);
    automationRunning = false;
    chrome.runtime.sendMessage({ action: "automationStopped" });
    return allAutomationData;
  }
  
  await new Promise(resolve => setTimeout(resolve, 800));
  
  console.log("First batch inputted, starting automation...");

  // Process keywords in batches
  const totalBatches = Math.ceil(filteredKeywords.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    if (!automationRunning || stopRequested) {
      console.log("Automation stopped by user");
      automationRunning = false;
      chrome.runtime.sendMessage({ action: "automationStopped" });
      return allAutomationData;
    }

    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, filteredKeywords.length);
    const batchKeywords = filteredKeywords.slice(startIdx, endIdx);

    console.log(
      `Processing batch ${batchIndex + 1}/${totalBatches}: ${batchKeywords.join(
        ", "
      )}`
    );

    // Notify popup of progress
    chrome.runtime.sendMessage({
      action: "automationProgress",
      current: startRow + endIdx,
      total: effectiveEndRow,
      keyword: batchKeywords.join(", "),
      processedCount: allAutomationData.length,
    });

    // ALWAYS ensure settings before EVERY batch
    if (batchIndex > 0) {
      console.log(`Re-checking settings for batch ${batchIndex + 1}...`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await ensureCorrectNetwork();
      await ensureCorrectLocation();
      await ensureRowsSet500();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const inputSuccess = await inputKeywordToSearchBox(batchKeywords);
      if (!inputSuccess) {
        console.error(`Failed to input batch: ${batchKeywords.join(", ")}`);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    } else {
      console.log("First batch already inputted after setup, skipping input step");
    }

    if (stopRequested) {
      console.log("Stop requested - exiting automation");
      automationRunning = false;
      chrome.runtime.sendMessage({ action: "automationStopped" });
      return allAutomationData;
    }

    // Step 2: Click "Get results" button
    try {
      await clickGetResultsButton();
    } catch (error) {
      console.error(
        `Failed to click Get results for batch: ${batchKeywords.join(", ")}`
      );
      continue;
    }

    if (stopRequested) {
      console.log("Stop requested - exiting automation");
      automationRunning = false;
      chrome.runtime.sendMessage({ action: "automationStopped" });
      return allAutomationData;
    }

    // Step 3: Wait for results to load
    await waitForResults();

    // Step 4: Scrape data by scrolling to load all, then scraping (1K+ filtering)
    const data = await scrapeAllPages(batchKeywords); // Pass batch keywords to scraping function
    if (data && data.length > 0) {
      // Filter data based on extraction options
      let filteredData = data;
      if (!extractProvidedMode || !extractIdeasMode) {
        filteredData = data.filter((kw) => {
          if (extractProvidedMode && kw.section === "provided") return true;
          if (extractIdeasMode && kw.section === "ideas") return true;
          return false;
        });
        console.log(
          `Filtered to ${filteredData.length} keywords (Provided: ${extractProvidedMode}, Ideas: ${extractIdeasMode}) from ${data.length} total`
        );
      }

      allAutomationData = allAutomationData.concat(filteredData);
      console.log(
        `Scraped ${
          filteredData.length
        } keywords for batch: ${batchKeywords.join(", ")}`
      );

      // IMMEDIATELY store to chrome storage after each batch
      chrome.storage.local.get(["automationResults"], function (result) {
        const existingData = result.automationResults || [];
        const mergedData = existingData.concat(filteredData);

        chrome.storage.local.set(
          { automationResults: mergedData },
          function () {
            // Notify popup with updated count immediately
            chrome.runtime.sendMessage({
              action: "batchComplete",
              batchData: filteredData,
              totalStored: mergedData.length,
              currentBatch: batchIndex + 1,
              totalBatches: totalBatches,
            });
            
            // Start sending periodic countdown updates after first batch completes
            if (batchIndex === 0) {
              startCountdownUpdates();
            }
          }
        );
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // Check if 60 seconds have elapsed since cycle start
    const elapsedTime = Date.now() - cycleStartTime;
    const shouldResetCycle = elapsedTime >= CYCLE_DURATION && batchIndex < totalBatches - 1;
    
    if (shouldResetCycle) {
      console.log(`Cycle time reached (${Math.floor(elapsedTime / 1000)}s). Downloading and resetting...`);
      
      // Calculate remaining time to reach exactly 60 seconds
      const remainingTime = Math.max(0, CYCLE_DURATION - elapsedTime);
      const remainingSeconds = Math.ceil(remainingTime / 1000);
      
      // Show countdown
      chrome.runtime.sendMessage({
        action: "startCountdown",
        seconds: remainingSeconds,
        message: "Auto-download and new page in"
      });
      
      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      }
      
      // Trigger download of current results
      chrome.runtime.sendMessage({
        action: "triggerAutoDownload"
      });
      
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for download
      
      // Close current tab and open new home page tab
      console.log("Closing current tab and opening new home page...");
      chrome.runtime.sendMessage({
        action: "closeAndReopenTab",
        continueAutomation: true,
        nextBatchIndex: batchIndex + 1,
        automationConfig: {
          keywords: filteredKeywords,
          batchSize: batchSize,
          startRow: startRow,
          effectiveEndRow: effectiveEndRow,
          extractProvided: extractProvidedMode,
          extractIdeas: extractIdeasMode
        }
      });
      
      // Exit current automation - it will resume in the new tab
      return allAutomationData;
    }
  }

  // Automation complete
  automationRunning = false;
  console.log(
    `Automation complete. Total keywords scraped: ${allAutomationData.length}`
  );

  // Data already stored incrementally, just get final count
  chrome.storage.local.get(["automationResults"], function (result) {
    const finalData = result.automationResults || [];

    console.log(
      `Automation complete. Total stored data: ${finalData.length} items`
    );

    chrome.runtime.sendMessage({
      action: "automationComplete",
      total: effectiveEndRow - startRow,
      data: finalData,
      autoDownload: true,
    });
  });

  return allAutomationData;
}

// Function to observe page changes and auto-scrape when new data loads
function setupPageObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length) {
        // Check if new keyword data has been loaded
        const keywordTable =
          document.querySelector('div[role="grid"]') ||
          document.querySelector(".ess-table-canvas") ||
          document.querySelector(".particle-table-canvas");

        if (keywordTable) {
          // Notify the popup that new data is available
          chrome.runtime.sendMessage({
            action: "dataAvailable",
            hasData: true,
          });
        }
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Function to scrape in two phases: provided keywords first, then ideas
async function scrapeAllPages(batchInputKeywords = null) {
  const allKeywordData = [];

  // PHASE 1: Click Keyword header and scrape PROVIDED keywords (all volumes)
  console.log("Phase 1: Scraping provided keywords (all volumes)...");
  await ensureKeywordSorting();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Scroll and load all results
  await scrollAndLoadAllResults();

  // Scrape provided keywords WITHOUT volume filter
  const providedKeywords = scrapeKeywordData(true, batchInputKeywords); // true = skip volume filter, pass batch keywords

  if (providedKeywords && providedKeywords.length > 0) {
    // Filter to only include 'provided' section
    const onlyProvided = providedKeywords.filter(
      (kw) => kw.section === "provided"
    );
    console.log(
      `Phase 1: Collected ${onlyProvided.length} provided keywords (all volumes)`
    );
    allKeywordData.push(...onlyProvided);
  }

  // PHASE 2: Click Search Volume header and scrape KEYWORD IDEAS (>= 1K only)
  console.log("Phase 2: Scraping keyword ideas (>= 1K volume only)...");
  await ensureSearchVolumeSorting();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Scroll and load all results again
  await scrollAndLoadAllResults();

  // Scrape keyword ideas WITH volume filter (>= 1K)
  // Note: Provided keywords are also collected here but already filtered by section
  const allKeywordsPhase2 = scrapeKeywordData(false, batchInputKeywords); // false = apply >= 1K filter to ideas only, pass batch keywords

  if (allKeywordsPhase2 && allKeywordsPhase2.length > 0) {
    // Only collect keyword ideas (provided keywords already collected in Phase 1)
    const onlyIdeas = allKeywordsPhase2.filter((kw) => kw.section === "ideas");
    console.log(`Phase 2: Collected ${onlyIdeas.length} keyword ideas (>= 1K)`);
    allKeywordData.push(...onlyIdeas);
  }

  const providedCount = allKeywordData.filter(
    (kw) => kw.section === "provided"
  ).length;
  const ideasCount = allKeywordData.filter(
    (kw) => kw.section === "ideas"
  ).length;
  console.log(
    `Total scraped: ${allKeywordData.length} keywords (${providedCount} provided, ${ideasCount} ideas)`
  );

  return allKeywordData;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeData") {
    if (request.scrapeAllPages) {
      scrapeAllPages().then((data) => {
        chrome.storage.local.get(["automationResults"], function (result) {
          const existingData = result.automationResults || [];
          const mergedData = existingData.concat(data);

          chrome.storage.local.set(
            { automationResults: mergedData },
            function () {
              chrome.runtime.sendMessage({
                action: "scrapingComplete",
                data: mergedData,
                autoDownload: true, // Signal to trigger auto-download
              });
            }
          );
        });

        sendResponse({ data: data });
      });
      return true;
    } else {
      const data = scrapeKeywordData();
      sendResponse({ data: data });
    }
  } else if (request.action === "debugPage") {
    // Collect debugging information about the page
    const debugInfo = {
      title: document.title,
      url: window.location.href,
      hasGrid: !!document.querySelector('div[role="grid"]'),
      hasTable: !!document.querySelector("table"),
      hasEssTable: !!document.querySelector(".ess-table-canvas"),
      hasParticleTable: !!document.querySelector(".particle-table-canvas"),
      totalDivs: document.querySelectorAll("div").length,
      possibleTables: document.querySelectorAll(
        '[class*="table"], [class*="grid"]'
      ).length,
      pageTextSample: document.body.textContent.substring(0, 500),
      // Additional debug info
      hasGroupHeaders: !!document.querySelector(".group-header"),
      groupHeaderCount: document.querySelectorAll(".group-header").length,
      hasKeywordElements: !!document.querySelector(".keyword"),
      keywordElementCount: document.querySelectorAll(".keyword").length,
      hasValueTextElements: !!document.querySelector(".value-text"),
      valueTextElementCount: document.querySelectorAll(".value-text").length,
      hasParticleTableRow: !!document.querySelector(".particle-table-row"),
      particleTableRowCount: document.querySelectorAll(".particle-table-row")
        .length,
      hasRoleRow: !!document.querySelector('[role="row"]'),
      roleRowCount: document.querySelectorAll('[role="row"]').length,
      // Sample elements for inspection
      sampleKeywordElements: Array.from(document.querySelectorAll(".keyword"))
        .slice(0, 3)
        .map((el) => el.textContent),
      sampleValueTextElements: Array.from(
        document.querySelectorAll(".value-text")
      )
        .slice(0, 3)
        .map((el) => el.textContent),
      sampleGroupHeaders: Array.from(document.querySelectorAll(".group-header"))
        .slice(0, 3)
        .map((el) => el.textContent),
    };
    sendResponse({ debugInfo: debugInfo });
  } else if (request.action === "startAutomation") {
    runAutomation(
      request.keywords,
      request.batchSize || 1,
      typeof request.startRow === "number" ? request.startRow : 0,
      request.endRow !== undefined ? request.endRow : null,
      request.extractProvided !== undefined ? request.extractProvided : true,
      request.extractIdeas !== undefined ? request.extractIdeas : true
    ).then((data) => {
      sendResponse({ success: true, data: data });
    });
    return true;
  } else if (request.action === "stopAutomation") {
    stopRequested = true;
    automationRunning = false;
    console.log("Stop requested - stopping automation immediately");
    sendResponse({ success: true, stopped: true });
  } else if (request.action === "getAutomationResults") {
    chrome.storage.local.get(["automationResults"], function (result) {
      sendResponse({ data: result.automationResults || [] });
    });
    return true;
  }
});

// Check if we're on the home page when the content script loads
if (window.location.href.includes('/home')) {
  console.log("Loaded on home page - extension ready to navigate to search");
  
  // Check if we need to resume automation
  chrome.storage.local.get(['resumeAutomation', 'nextBatchIndex', 'automationConfig'], function(result) {
    if (result.resumeAutomation && result.automationConfig) {
      console.log(`Resuming automation from batch ${result.nextBatchIndex + 1}`);
      
      // Clear resume flag
      chrome.storage.local.remove(['resumeAutomation']);
      
      // Wait for page to be ready, then resume
      setTimeout(async () => {
        const config = result.automationConfig;
        const startBatchIndex = result.nextBatchIndex;
        
        console.log("Page ready, resuming automation...");
        
        // Resume automation from the next batch
        await resumeAutomationFromBatch(
          config.keywords,
          config.batchSize,
          config.startRow,
          config.effectiveEndRow,
          config.extractProvided,
          config.extractIdeas,
          startBatchIndex
        );
      }, 3000);
    }
  });
} else if (window.location.href.includes('/overview')) {
  console.log("Loaded on overview page - will navigate to Keyword Planner");
  
  // Check if we need to resume automation
  chrome.storage.local.get(['resumeAutomation', 'nextBatchIndex', 'automationConfig'], function(result) {
    if (result.resumeAutomation && result.automationConfig) {
      console.log("Need to navigate to Keyword Planner first, then resume automation");
      
      // Clear resume flag
      chrome.storage.local.remove(['resumeAutomation']);
      
      // Wait for page to be ready, navigate to keyword planner, then resume
      setTimeout(async () => {
        const config = result.automationConfig;
        const startBatchIndex = result.nextBatchIndex;
        
        // Navigate to keyword planner
        const navigated = await navigateFromOverviewToKeywordPlanner();
        
        if (navigated) {
          console.log("Successfully navigated to Keyword Planner, waiting for page to load...");
          
          // Wait for keyword planner page to load
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          console.log("Page ready, resuming automation...");
          
          // Resume automation from the next batch
          await resumeAutomationFromBatch(
            config.keywords,
            config.batchSize,
            config.startRow,
            config.effectiveEndRow,
            config.extractProvided,
            config.extractIdeas,
            startBatchIndex
          );
        } else {
          console.error("Failed to navigate to Keyword Planner");
          // Notify user of failure
          chrome.runtime.sendMessage({
            action: "automationStopped",
            data: []
          });
        }
      }, 3000);
    }
  });
}

// Initialize the page observer
setupPageObserver();

// Notify the popup that the content script is loaded
chrome.runtime.sendMessage({
  action: "contentScriptLoaded",
});
