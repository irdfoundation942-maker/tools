// Content script for AI Studio automation
let isCollecting = false;
let cityList = [];
let currentIndex = 0;
let isProcessing = false;
let citiesInCurrentBatch = 0; // Tracks number of PROMPTS per chat session
let completedInputs = new Set(); // Track successfully completed inputs
let failedInputs = []; // Track inputs that failed to collect data
let isRetryingFailedInput = false; // Flag to indicate we're retrying a failed input
let inputsProcessedInThisTab = 0; // Tracks inputs processed in the current tab
const DEFAULT_BATCH_SIZE = 5; // Default: Process 5 prompts per chat session
let KEYWORD_BATCH_SIZE = 5; // Default: Number of keywords to process in a single prompt
let KEYWORD_BATCH_SIZE_LOCKED = false; // Flag to prevent overwriting during session
let dynamicBatchSize = DEFAULT_BATCH_SIZE; // Will be updated based on settings
let useDynamicBatch = false; // Flag to use repetition count as batch size
let autoCopyResponse = false; // Flag to auto-copy AI response

// Loop collection variables
let isLoopCollection = false;
let loopIteration = 0;
let incompleteCountries = [];
let originalCityList = [];

// Multi-tab mode variables
let profileIndex = 0;
let isMultiTabMode = false;
let isSerialMode = false; // Add flag to track serial mode
let assignedStartIndex = 0;
let assignedEndIndex = 0;

// ADD SYSTEM INSTRUCTION PROMPT AND FLAG
let SYSTEM_INSTRUCTION_PROMPT = "";

// Function to load system prompt from file
async function loadSystemPrompt() {
    try {
        const response = await fetch(chrome.runtime.getURL('system_prompt.txt'));
        if (!response.ok) {
            throw new Error(`Failed to load system prompt: ${response.status}`);
        }
        SYSTEM_INSTRUCTION_PROMPT = await response.text();
        console.log('System prompt loaded successfully from system_prompt.txt');
        return SYSTEM_INSTRUCTION_PROMPT;
    } catch (error) {
        console.error('Error loading system prompt:', error);
        // Fallback to a basic prompt if file cannot be loaded
        SYSTEM_INSTRUCTION_PROMPT = `You are a data processing assistant. For each given keyword, extract and format information into a markdown table with the following columns: keyword, label, language_id, country, and city.

**Instructions:**

1.  **keyword column:**
    *   Convert the keyword to all lowercase.
    *   Replace all spaces with hyphens.

2.  **label column:**
    *   Capitalize the first letter of each word.
    *   Prepositions (e.g., "in", "at", "for", "of", "on", "to", "with") should remain lowercase unless they are the first or last word of the label.
    *   Maintain the original word order and spacing from the input keyword.

3.  **country and city columns:**
    *   If a city is mentioned but the country is not, infer the country based on the city (e.g., "Dhaka" implies "Bangladesh").
    *   If only a country is mentioned (e.g., "salah time uk"), infer its capital city (e.g., "London" for "United Kingdom").
    *   If neither a city nor a country can be identified or inferred, leave both country and city cells blank.

4.  **language_id column:**
    *   Always use en.

**Output Format:**

The output must be a markdown table. The first row must be the header as shown below. Subsequent rows will contain the processed data for each keyword.

markdown
**keyword** | **label** | **language_id** | **country** | **city**
---|---|---|---|---
{processed_keyword_1} | {processed_label_1} | en | {country_1} | {city_1}
{processed_keyword_2} | {processed_label_2} | en | {country_2} | {city_2}

dont give extra text, give only exact table column output`;
        return SYSTEM_INSTRUCTION_PROMPT;
    }
}

// Initialize and restore state on load
(async function() {
    // Load system prompt from file
    await loadSystemPrompt();
    
    const state = await chrome.storage.local.get(['collectionState', 'completedInputs', 'keywordBatchSize']);
    if (state.collectionState) {
        // FIXED: Only restore state if NOT in multi-tab mode
        // Multi-tab mode tabs will be initialized via startCollection message
        const isMultiTabState = state.collectionState.isMultiTabMode || false;
        
        if (!isMultiTabState) {
            // Single-tab mode: safe to restore state
            isCollecting = state.collectionState.isCollecting || false;
            currentIndex = state.collectionState.currentIndex || 0;
            cityList = state.collectionState.cityList || [];
            isLoopCollection = state.collectionState.isLoopCollection || false;
            loopIteration = state.collectionState.loopIteration || 0;
            incompleteCountries = state.collectionState.incompleteCountries || [];
            originalCityList = state.collectionState.originalCityList || [];
            failedInputs = state.collectionState.failedInputs || [];
            isRetryingFailedInput = state.collectionState.isRetryingFailedInput || false;
            inputsProcessedInThisTab = state.collectionState.inputsProcessedInThisTab || 0;
            isSerialMode = state.collectionState.isSerialMode || false; // Restore serial mode flag
            
            isMultiTabMode = false;
            profileIndex = 0;
            assignedStartIndex = 0;
            assignedEndIndex = 0;
            
            if (isCollecting && originalCityList.length === 0 && cityList.length > 0) {
                originalCityList = [...cityList];
            }
            
            // Auto-resume collection for single-tab mode only
            if (isCollecting && cityList.length > 0) {
                console.log(`Single-tab mode: Resuming collection from index ${currentIndex}`);
                setTimeout(processNextCity, 2000);
            }
        } else {
            // Multi-tab mode: Don't restore state, wait for startCollection message
            console.log('Multi-tab mode detected in storage - waiting for initialization message');
        }
    }
    if (state.completedInputs) {
        completedInputs = new Set(state.completedInputs);
    }
    if (state.keywordBatchSize !== undefined) {
        KEYWORD_BATCH_SIZE = state.keywordBatchSize;
        KEYWORD_BATCH_SIZE_LOCKED = true;
        console.log(`Loaded keyword batch size: ${KEYWORD_BATCH_SIZE}`);
    }
})();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startCollection') {
        let startRow = 1;
        if (typeof request.startRow === 'number' && !isNaN(request.startRow)) {
            startRow = Math.max(1, request.startRow);
        }
        
        // Check if this is multi-tab mode
        if (request.isMultiTabMode) {
            // FIXED: Pass all config parameters including tabNumber, totalTabs, keywordsPerPrompt
            const config = {
                isMultiTabMode: true,
                profileIndex: request.profileIndex || 0,
                repetitionCount: request.repetitionCount || 1,
                keywordsPerPrompt: request.keywordsPerPrompt, // ADDED
                tabNumber: request.tabNumber || 1, // ADDED
                totalTabs: request.totalTabs || 1,  // ADDED
                isSerialMode: request.isSerialMode || false // ADDED
            };
            startCollection(request.startIndex, request.endIndex, config);
        } else {
            startCollection(startRow - 1); // 0-based index for single tab mode
        }
        sendResponse({success: true});
    } else if (request.action === 'stopCollection') {
        stopCollection();
        sendResponse({success: true});
    } else if (request.action === 'clearProgress') {
        clearProgressData();
        sendResponse({success: true});
    } else if (request.action === 'setRepetitionCount') {
        chrome.storage.local.set({ repetitionCount: request.count });
        console.log(`Repetition count set to: ${request.count}`);
        sendResponse({success: true});
    } else if (request.action === 'setUseDynamicBatch') {
        chrome.storage.local.set({ useDynamicBatch: request.enabled });
        console.log(`Dynamic batch (use repetition count): ${request.enabled}`);
        sendResponse({success: true});
    } else if (request.action === 'setAutoCopyResponse') {
        chrome.storage.local.set({ autoCopyResponse: request.enabled });
        autoCopyResponse = request.enabled;
        console.log(`Auto-copy AI response: ${request.enabled}`);
        sendResponse({success: true});
    } else if (request.action === 'setKeywordBatchSize') {
        KEYWORD_BATCH_SIZE = request.size;
        KEYWORD_BATCH_SIZE_LOCKED = true;
        chrome.storage.local.set({ keywordBatchSize: request.size });
        console.log(`Keyword batch size set to: ${request.size} (locked for session)`);
        sendResponse({success: true});
    } else if (request.action === 'preInitializeTab') {
        // Pre-initialization: Ensure System Instructions and DOM are loaded
        console.log('🔄 Tab pre-initialization triggered');
        (async () => {
            try {
                // Ensure batch size is loaded
                await ensureBatchSizeLoaded();
                
                // Check if system instructions are set
                const isEmpty = await isSystemInstructionsEmpty();
                console.log(`System instructions status: ${isEmpty ? 'empty' : 'populated'}`);
                
                sendResponse({success: true, systemInstructionsEmpty: isEmpty});
            } catch (err) {
                console.error('Pre-initialization error:', err);
                sendResponse({success: false, error: err.message});
            }
        })();
        return true; // Keep channel open for async response
    }
    return true;
});

async function startCollection(startIndex = 0, endIndex = null, config = {}) {
    // FIXED: In multi-tab mode, force-reset state for proper initialization
    if (config.isMultiTabMode) {
        console.log(`Multi-tab mode initialization - resetting state for tab ${config.tabNumber}`);
        isCollecting = false; // Force reset to allow proper initialization
        isProcessing = false;
        citiesInCurrentBatch = 0;
        isLoopCollection = false;
        loopIteration = 0;
        inputsProcessedInThisTab = 0;
    } else {
        // Single-tab mode: respect existing collection state
        if (isCollecting) return;
    }
    
    isCollecting = true;
    isProcessing = false;
    citiesInCurrentBatch = 0;
    isLoopCollection = false;
    loopIteration = 0;
    inputsProcessedInThisTab = 0;
    
    // ADD tracking variables for multi-tab mode
    let isFirstTaskInMultiTab = false;
    let tabNumber = 1;
    let totalTabs = 1;
    
    // Handle multi-tab mode configuration
    if (config.isMultiTabMode) {
        isMultiTabMode = true;
        isSerialMode = config.isSerialMode || false; // Add serial mode flag
        profileIndex = config.profileIndex || 0;
        assignedStartIndex = startIndex;
        assignedEndIndex = endIndex || 0;
        
        // FIXED: Use config values instead of defaults
        tabNumber = config.tabNumber || 1;
        totalTabs = config.totalTabs || 1;
        isFirstTaskInMultiTab = true;
        
        // Set KEYWORD_BATCH_SIZE from config if provided
        if (config.keywordsPerPrompt !== undefined && !KEYWORD_BATCH_SIZE_LOCKED) {
            KEYWORD_BATCH_SIZE = config.keywordsPerPrompt;
            KEYWORD_BATCH_SIZE_LOCKED = true;
            await chrome.storage.local.set({ keywordBatchSize: KEYWORD_BATCH_SIZE });
            console.log(`Multi-tab mode: Keywords per prompt set to ${KEYWORD_BATCH_SIZE}`);
        } else if (KEYWORD_BATCH_SIZE_LOCKED) {
            console.log(`Multi-tab mode: Using locked keyword batch size: ${KEYWORD_BATCH_SIZE}`);
        }
        
        console.log(`Tab ${tabNumber}/${totalTabs} - Profile ${profileIndex}, processing keywords ${assignedStartIndex + 1}-${assignedEndIndex}, batch size ${KEYWORD_BATCH_SIZE}`);
    } else {
        isMultiTabMode = false;
        assignedStartIndex = startIndex;
    }
    
    currentIndex = startIndex;
    
    try {
        // Get settings from storage
        const settings = await chrome.storage.local.get(['repetitionCount', 'useDynamicBatch', 'autoCopyResponse', 'keywordBatchSize']);
        const repetitionCount = config.repetitionCount || settings.repetitionCount || 1;
        useDynamicBatch = settings.useDynamicBatch || false;
        autoCopyResponse = settings.autoCopyResponse || false;
        
        // ADDED: Update KEYWORD_BATCH_SIZE from storage if not already set by config (for single-tab mode)
        if (!config.isMultiTabMode && settings.keywordBatchSize !== undefined && !KEYWORD_BATCH_SIZE_LOCKED) {
            KEYWORD_BATCH_SIZE = settings.keywordBatchSize;
            KEYWORD_BATCH_SIZE_LOCKED = true;
            console.log(`Single-tab mode: Keywords per prompt set to ${KEYWORD_BATCH_SIZE}`);
        } else if (KEYWORD_BATCH_SIZE_LOCKED) {
            console.log(`Single-tab mode: Using locked keyword batch size: ${KEYWORD_BATCH_SIZE}`);
        }
        
        // Set batch size based on checkbox
        if (useDynamicBatch) {
            dynamicBatchSize = repetitionCount;
            console.log(`Using dynamic batch size: ${dynamicBatchSize} (based on repetition count)`);
        } else {
            dynamicBatchSize = DEFAULT_BATCH_SIZE;
            console.log(`Using default batch size: ${dynamicBatchSize}`);
        }
        
        // Load CSV
        cityList = await loadCityList(repetitionCount);
        
        // In multi-tab mode, filter to assigned range
        if (isMultiTabMode && assignedEndIndex > 0) {
            const originalLength = cityList.length;
            cityList = cityList.slice(assignedStartIndex, assignedEndIndex);
            currentIndex = 0; // Reset to 0 since we sliced the array
            originalCityList = [...cityList];
            console.log(`Filtered to assigned range: ${cityList.length} keywords (from ${originalLength} total)`);
            
            // If no keywords in assigned range, use the full list instead
            if (cityList.length === 0) {
                console.log('No keywords in assigned range, using full list instead');
                cityList = originalCityList = await loadCityList(repetitionCount);
                currentIndex = assignedStartIndex;
            }
        } else {
            originalCityList = [...cityList];
        }
        
        if (cityList.length === 0) {
            await updateStatus('No keywords found in input file. Please check your input file and try again.');
            return;
        }
        
        // Store first task flag in a closure variable
        let firstTaskSubmitted = false;
        
        // Save initial state
        await saveCollectionState();
        await updateStatus(`Starting collection of ${cityList.length} cities (${repetitionCount}x repetition, ${KEYWORD_BATCH_SIZE} keywords per prompt)...`);
        
        // Enable Google Search grounding
        await enableGoogleSearchGrounding();
        
        // ADD helper function to notify first task submission
        // Notify background script when first task is submitted (for sequential tab creation)
        window.notifyFirstTaskSubmitted = async function() {
            if (isMultiTabMode && isFirstTaskInMultiTab && !firstTaskSubmitted) {
                firstTaskSubmitted = true;
                isFirstTaskInMultiTab = false;
                try {
                    await chrome.runtime.sendMessage({ 
                        action: 'firstTaskSubmitted',
                        tabNumber: tabNumber
                    });
                    console.log(`Tab ${tabNumber}: Notified background script of first task submission`);
                } catch (err) {
                    console.log('Could not notify first task submission:', err.message);
                }
            }
        };
        
        // Start processing cities
        await processNextCity();
    } catch (error) {
        console.error('Error starting collection:', error);
        await updateStatus('Error: ' + error.message);
        stopCollection();
    }
}

async function stopCollection() {
    console.log('🛑 Stopping collection immediately...');
    
    isCollecting = false;
    isProcessing = false;
    citiesInCurrentBatch = 0;
    isLoopCollection = false; 
    loopIteration = 0;
    
    // ADD notification to background script to stop multi-tab operations
    // Notify background script to stop multi-tab cycling
    if (isMultiTabMode) {
        try {
            await chrome.runtime.sendMessage({ 
                action: 'stopMultiTabCollection'
            });
        } catch (err) {
            console.log('Could not notify stop:', err.message);
        }
    }
    
    await saveCollectionState();
    await updateStatus('Collection stopped by user');
    
    console.log('🛑 Collection stopped - all flags cleared');
}

async function saveCollectionState() {
    try {
        // FIXED: In multi-tab mode, use tab-specific storage key to prevent conflicts
        const storageKey = isMultiTabMode ? 
            `collectionState_tab_${Date.now()}` : // Use timestamp as unique identifier per tab
            'collectionState';
        
        const stateData = {
            isCollecting: isCollecting,
            currentIndex: currentIndex,
            cityList: cityList,
            totalCities: originalCityList.length || cityList.length,
            currentCity: cityList[currentIndex] || null,
            isLoopCollection: isLoopCollection,
            loopIteration: loopIteration,
            incompleteCountries: incompleteCountries,
            originalCityList: originalCityList,
            failedInputs: failedInputs,
            isRetryingFailedInput: isRetryingFailedInput,
            inputsProcessedInThisTab: inputsProcessedInThisTab,
            isMultiTabMode: isMultiTabMode,
            isSerialMode: isSerialMode, // Add serial mode flag
            profileIndex: profileIndex,
            assignedStartIndex: assignedStartIndex,
            assignedEndIndex: assignedEndIndex
        };
        
        // Save to appropriate storage key
        await chrome.storage.local.set({
            [storageKey]: stateData,
            completedInputs: Array.from(completedInputs),
            currentKeywordIndex: currentIndex
        });
        
        // For single-tab mode, also maintain backward compatibility
        if (!isMultiTabMode) {
            await chrome.storage.local.set({
                collectionState: stateData
            });
        }
    } catch (error) {
        console.error('Error saving collection state:', error);
    }
}

async function loadCityList(repetitionCount = 1) {
    try {
        // NEW: Try to load from uploaded file first
        const storage = await chrome.storage.local.get(['uploadedExcelFile', 'uploadedFileName']);
        
        if (storage.uploadedExcelFile) {
            console.log('Loading from uploaded file:', storage.uploadedFileName);
            
            // Decode base64 to array buffer
            const binaryString = atob(storage.uploadedExcelFile);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const workbook = XLSX.read(bytes, { type: 'array' });
            console.log('Uploaded Excel workbook loaded, sheets:', workbook.SheetNames);
            
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                throw new Error('No sheets found in uploaded Excel file');
            }
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            console.log('Using sheet:', firstSheetName);
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            console.log('Uploaded Excel data converted to JSON, rows:', jsonData.length);
            
            if (!jsonData || jsonData.length === 0) {
                throw new Error('No data found in uploaded Excel sheet');
            }
            
            // Extract keywords from first column
            const keywords = [];
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;
                
                const cellValue = row[0];
                if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
                    const keyword = String(cellValue).trim();
                    if (keyword && !keywords.includes(keyword)) {
                        keywords.push(keyword);
                    }
                }
            }
            
            console.log('Extracted keywords:', keywords.slice(0, 5), '... total:', keywords.length);
            
            if (keywords.length === 0) {
                throw new Error('No valid keywords found in uploaded Excel file');
            }
            
            // Apply repetition
            const cityList = [];
            keywords.forEach(keyword => {
                for (let i = 0; i < repetitionCount; i++) {
                    cityList.push(keyword);
                }
            });
            
            const inputCounts = {};
            keywords.forEach(keyword => {
                inputCounts[keyword] = repetitionCount;
            });
            chrome.storage.local.set({ inputCounts: inputCounts });
            
            console.log(`Loaded ${keywords.length} unique keywords from uploaded Excel, repeated ${repetitionCount}x = ${cityList.length} total`);
            return cityList;
        }
        
        // EXISTING: Fallback to bundled file if no uploaded file
        console.log('No uploaded file, trying bundled Excel file: input (1).xlsx');
        const response = await fetch(chrome.runtime.getURL('input (1).xlsx'));
        
        if (!response.ok) {
            throw new Error(`Failed to fetch bundled Excel file: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        console.log('Bundled Excel file loaded, size:', arrayBuffer.byteLength, 'bytes');
        
        if (arrayBuffer.byteLength === 0) {
            throw new Error('Bundled Excel file is empty');
        }
        
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        console.log('Bundled Excel workbook loaded, sheets:', workbook.SheetNames);
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('No sheets found in bundled Excel file');
        }
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        console.log('Using sheet:', firstSheetName);
        
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        console.log('Bundled Excel data converted to JSON, rows:', jsonData.length);
        
        if (!jsonData || jsonData.length === 0) {
            throw new Error('No data found in bundled Excel sheet');
        }
        
        const keywords = [];
        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;
            
            const cellValue = row[0];
            if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
                const keyword = String(cellValue).trim();
                if (keyword && !keywords.includes(keyword)) {
                    keywords.push(keyword);
                }
            }
        }
        
        console.log('Extracted keywords:', keywords.slice(0, 5), '... total:', keywords.length);
        
        if (keywords.length === 0) {
            throw new Error('No valid keywords found in bundled Excel file');
        }
        
        const cityList = [];
        keywords.forEach(keyword => {
            for (let i = 0; i < repetitionCount; i++) {
                cityList.push(keyword);
            }
        });
        
        const inputCounts = {};
        keywords.forEach(keyword => {
            inputCounts[keyword] = repetitionCount;
        });
        chrome.storage.local.set({ inputCounts: inputCounts });
        
        console.log(`Loaded ${keywords.length} unique keywords from bundled Excel, repeated ${repetitionCount}x = ${cityList.length} total`);
        return cityList;
        
    } catch (error) {
        console.error('Error loading city list:', error);
        
        // If Excel loading fails, try to create a default list to prevent "No cities found" error
        console.log('Creating default keyword list as fallback...');
        const defaultKeywords = ['default keyword'];
        const cityList = [];
        
        defaultKeywords.forEach(keyword => {
            for (let i = 0; i < repetitionCount; i++) {
                cityList.push(keyword);
            }
        });
        
        const inputCounts = {};
        defaultKeywords.forEach(keyword => {
            inputCounts[keyword] = repetitionCount;
        });
        chrome.storage.local.set({ inputCounts: inputCounts });
        
        console.log(`Created default list with ${defaultKeywords.length} keywords, repeated ${repetitionCount}x = ${cityList.length} total`);
        return cityList;
    }
}

function parseCSV(csvText, repetitionCount = 1) {
    // For multi-line inputs, treat the entire content as a single entry
    // Remove leading/trailing whitespace and check if it's a multi-line input
    const trimmedText = csvText.trim();
    
    // Check if this is a multi-line input (contains multiple meaningful lines)
    const lines = trimmedText.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    
    if (lines.length > 1) {
        // This is a multi-line input, treat the entire content as a single entry
        const cities = [];
        for (let i = 0; i < repetitionCount; i++) {
            cities.push(trimmedText);
        }
        
        const inputCounts = {};
        inputCounts[trimmedText] = repetitionCount;
        
        chrome.storage.local.set({ inputCounts: inputCounts });
        console.log(`Parsed multi-line input as single entry, repeated ${repetitionCount}x = ${cities.length} total`);
        return cities;
    } else {
        // Original logic for single-line inputs
        const uniqueCities = [];
        const inputCounts = {};
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
                const city = line.replace(/^["']|["']$/g, '').trim();
                if (city && !uniqueCities.includes(city)) {
                    uniqueCities.push(city);
                }
            }
        }
        
        const cities = [];
        uniqueCities.forEach(city => {
            for (let i = 0; i < repetitionCount; i++) {
                cities.push(city);
            }
            inputCounts[city] = repetitionCount;
        });
        
        chrome.storage.local.set({ inputCounts: inputCounts });
        console.log(`Parsed ${uniqueCities.length} unique cities, repeated ${repetitionCount}x = ${cities.length} total`);
        return cities;
    }
}

async function enableGoogleSearchGrounding() {
    try {
        let toggle = document.querySelector('button[role="switch"][aria-label="Grounding with Google Search"]');
        if (!toggle) {
            const container = document.querySelector('.search-as-a-tool-toggle, [data-test-id="searchAsAToolTooltip"]');
            if (container) toggle = container.querySelector('button[role="switch"]');
        }
        if (!toggle) {
            const headings = Array.from(document.querySelectorAll('h3.item-description-title, h3'));
            const heading = headings.find(h => (h.textContent || '').trim().toLowerCase().includes('grounding with google search'));
            if (heading) {
                const settingsItem = heading.closest('.settings-item') || heading.parentElement?.parentElement;
                if (settingsItem) toggle = settingsItem.querySelector('button[role="switch"]');
            }
        }
        if (toggle) {
            const ariaLabel = toggle.getAttribute('aria-label') || '';
            if (ariaLabel.toLowerCase().includes('thinking')) return;
            const isChecked = toggle.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
                toggle.click();
                await wait(600);
                if (!isCollecting) return;
                console.log('Grounding with Google Search enabled');
            } else {
                console.log('Grounding with Google Search already enabled');
            }
        } else {
            console.warn('Grounding with Google Search toggle not found');
        }
    } catch (error) {
        console.error('Error enabling Google Search grounding:', error);
    }
}

// Ensure batch size is always loaded from storage before processing
async function ensureBatchSizeLoaded() {
    if (!KEYWORD_BATCH_SIZE_LOCKED) {
        const settings = await chrome.storage.local.get(['keywordBatchSize']);
        if (settings.keywordBatchSize !== undefined) {
            KEYWORD_BATCH_SIZE = settings.keywordBatchSize;
            KEYWORD_BATCH_SIZE_LOCKED = true;
            console.log(`Reloaded keyword batch size from storage: ${KEYWORD_BATCH_SIZE}`);
        }
    }
}

async function processNextCity() {
    // INSTANT ABORT: Check if collection stopped at the very start
    if (!isCollecting) {
        console.log('🛑 processNextCity aborted - collection stopped');
        return;
    }
    
    // Ensure batch size is loaded from storage before processing
    await ensureBatchSizeLoaded();
    
    if (!isCollecting || isProcessing || currentIndex >= cityList.length) {
        if (currentIndex >= cityList.length && isCollecting) {
            console.log('Collection complete for this tab.');
            isCollecting = false;
            await updateStatus(`Collection complete for this tab! Processed ${originalCityList.length} keywords.`);
            
            // In serial mode, notify background script that this tab is done
            if (isSerialMode) {
                try {
                    await chrome.runtime.sendMessage({ 
                        action: 'tabProcessingComplete'
                    });
                    console.log('Notified background script that tab processing is complete');
                } catch (err) {
                    console.log('Could not notify tab completion:', err.message);
                }
            } else {
                // In parallel mode, send collection complete message
                chrome.runtime.sendMessage({
                    action: 'collectionComplete',
                    total: originalCityList.length,
                    loopIterations: 0
                });
            }
            
            await saveCollectionState();
        }
        return;
    }
    
    // Logic to start a new CHAT session (in the same tab) without page reload
    if (citiesInCurrentBatch >= dynamicBatchSize && currentIndex < cityList.length) {
        await updateStatus(`Starting new chat session after ${dynamicBatchSize} prompts (tab remains open)...`);
        await startNewChatSession();
        citiesInCurrentBatch = 0;
        // Wait for UI to be ready after starting new chat
        await wait(2000);
        if (!isCollecting) {
            isProcessing = false;
            return;
        }
    }
    
    if (citiesInCurrentBatch === 0) {
        const isEmpty = await isSystemInstructionsEmpty();
        if (isEmpty) {
            console.log('System instructions box is empty, setting up system instructions...');
            await setSystemInstructions();
            if (!isCollecting) {
                isProcessing = false;
                return;
            }
        }
    }

    isProcessing = true;
    const batchOfKeywords = cityList.slice(currentIndex, currentIndex + KEYWORD_BATCH_SIZE);
    if (batchOfKeywords.length === 0) {
        isProcessing = false;
        await processNextCity();
        return;
    }
    const promptText = batchOfKeywords.join('\n');
    const firstKeyword = batchOfKeywords[0];

    try {
        // Calculate actual row number for logging
        const actualRowNumber = isMultiTabMode 
            ? assignedStartIndex + currentIndex + 1 
            : currentIndex + 1;
            
        // Truncate the first keyword for display if it's too long
        const displayKeyword = firstKeyword.length > 50 ? firstKeyword.substring(0, 50) + "..." : firstKeyword;
        
        await updateStatus(`Processing batch of ${batchOfKeywords.length} starting with: "${displayKeyword}" (Row ${actualRowNumber})`);
        await updateProgress(currentIndex + batchOfKeywords.length, originalCityList.length, `Batch: ${displayKeyword}...`);

        await clearChatInput();
        if (!isCollecting) {
            isProcessing = false;
            return;
        }
        await typeInChatInput(promptText);
        if (!isCollecting) {
            isProcessing = false;
            return;
        }
        await wait(500);

        if (!isCollecting) {
            isProcessing = false;
            return;
        }

        const baselineTablesCount = document.querySelectorAll('div.table-container table, table').length;
        await clickRunButton();
        if (!isCollecting) {
            isProcessing = false;
            return;
        }

        // ADD notification for first task submission
        // Notify first task submission for multi-tab sequential creation
        if (typeof window.notifyFirstTaskSubmitted === 'function') {
            await window.notifyFirstTaskSubmitted();
        }
        if (!isCollecting) {
            isProcessing = false;
            return;
        }

        await updateStatus(`Waiting for AI response for batch: "${firstKeyword}"...`);
        await waitForResponseAndScrape(batchOfKeywords, baselineTablesCount);

        if (!isCollecting) {
            isProcessing = false;
            return;
        }

        citiesInCurrentBatch++;

        for (const keyword of batchOfKeywords) {
            await checkAndDownloadForDuplicateInput(keyword);
            if (!isCollecting) {
                isProcessing = false;
                return;
            }
        }

        currentIndex += batchOfKeywords.length;
        inputsProcessedInThisTab += batchOfKeywords.length;
        await saveCollectionState();
        
        // ADD notification to background script after task completion
        // Notify background script that task is complete (for tab cycling)
        if (isMultiTabMode) {
            try {
                await chrome.runtime.sendMessage({ 
                    action: 'taskCompleted'
                });
            } catch (err) {
                console.log('Could not notify task completion:', err.message);
            }
        }
        
        // Keep processing in the same tab - no tab switching needed
        // Tabs will continue processing their assigned keywords until completion

        if (failedInputs.length > 0 && !isRetryingFailedInput) {
            await updateStatus(`Completed batch. Retrying failed inputs...`);
            isProcessing = false;
            await wait(200);
            await retryFailedInputs();
        } else {
            await updateStatus(`Completed batch. Starting next...`);
            await wait(200);
            isProcessing = false;
            await processNextCity();
        }
    } catch (error) {
        console.error(`Error processing batch starting with ${firstKeyword}:`, error);
        await updateStatus(`Error on batch: ${error.message}. Will retry individually.`);
        
        for (const keyword of batchOfKeywords) {
            if (!failedInputs.includes(keyword)) {
                failedInputs.push(keyword);
            }
        }
        await saveCollectionState();
        
        isProcessing = false;
        citiesInCurrentBatch++;
        
        await wait(1000);
        await retryFailedInputs();
    }
}

async function retryFailedInputs() {
    // INSTANT ABORT: Check if collection stopped
    if (!isCollecting) {
        console.log('🛑 retryFailedInputs aborted - collection stopped');
        return;
    }
    
    if (failedInputs.length === 0 || isRetryingFailedInput) {
        await processNextCity();
        return;
    }
    
    const failedInput = failedInputs.shift();
    isRetryingFailedInput = true;
    await saveCollectionState();
    
    await updateStatus(`Starting new chat to retry failed input: ${failedInput}...`);

    await startNewChatSession();
    if (!isCollecting) {
        isRetryingFailedInput = false;
        return;
    }
    citiesInCurrentBatch = 0;

    try {
        await updateStatus(`Retrying: ${failedInput}...`);
        await clearChatInput();
        if (!isCollecting) {
            isRetryingFailedInput = false;
            return;
        }
        await typeInChatInput(failedInput);
        if (!isCollecting) {
            isRetryingFailedInput = false;
            return;
        }
        await wait(500);

        if (!isCollecting) {
            isRetryingFailedInput = false;
            return;
        }

        const baselineTablesCount = document.querySelectorAll('div.table-container table, table').length;
        await clickRunButton();
        if (!isCollecting) {
            isRetryingFailedInput = false;
            return;
        }

        await updateStatus(`Waiting for AI response for ${failedInput} (retry attempt)...`);
        await waitForResponseAndScrape(failedInput, baselineTablesCount);
        if (!isCollecting) {
            isRetryingFailedInput = false;
            return;
        }

        citiesInCurrentBatch++;
        await checkAndDownloadForDuplicateInput(failedInput);
        
        isRetryingFailedInput = false;
        await saveCollectionState();
        
        await updateStatus(`Successfully retried ${failedInput}. Checking for more failed inputs...`);
        await wait(200);
        await retryFailedInputs();
        
    } catch (error) {
        console.error(`Error retrying failed input ${failedInput}:`, error);
        if (!failedInputs.includes(failedInput)) {
            failedInputs.push(failedInput);
        }
        isRetryingFailedInput = false;
        await saveCollectionState();
        
        await updateStatus(`Retry failed for ${failedInput}. Will retry again...`);
        await wait(1000);
        await retryFailedInputs();
    }
}

async function clearChatInput() {
    if (!isCollecting) return; // INSTANT ABORT
    
    const textarea = document.querySelector('textarea.textarea, textarea[aria-label*="Type"], textarea[placeholder*="prompt"], ms-autosize-textarea textarea');
    if (textarea) {
        textarea.focus();
        await wait(100);
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(200);
        console.log('Chat input cleared');
    } else {
        console.warn('Textarea not found for clearing');
    }
}

async function typeInChatInput(text) {
    if (!isCollecting) return; // INSTANT ABORT
    
    const textarea = document.querySelector('textarea.textarea, textarea[aria-label*="Type"], textarea[placeholder*="prompt"], ms-autosize-textarea textarea');
    if (textarea) {
        textarea.focus();
        await wait(200);
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(100);
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
        textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
        await wait(500);
        // Truncate the text for console logging if it's too long
        const logText = text.length > 100 ? text.substring(0, 100) + "..." : text;
        console.log(`Typed "${logText}" into chat input (${text.length} characters total)`);
    } else {
        console.error('Textarea not found for typing');
        throw new Error('Chat input textarea not found');
    }
}

async function clickRunButton() {
    if (!isCollecting) return; // INSTANT ABORT
    
    let runButton = document.querySelector('button[aria-label="Run"]:not([disabled])');
    if (!runButton) {
        const buttons = Array.from(document.querySelectorAll('button.run-button, button[type="submit"]'));
        runButton = buttons.find(btn => !btn.disabled && btn.textContent.includes('Run'));
    }
    if (runButton && !runButton.disabled) {
        runButton.click();
        console.log('Run button clicked');
        await wait(1000);
        
        // ADDED: Check for skip button after submission
        await handleSkipButtonIfPresent();
    } else {
        console.error('Run button not found or disabled');
        throw new Error('Run button not found or disabled');
    }
}

async function handleSkipButtonIfPresent() {
    try {
        // Wait a moment for skip button to potentially appear
        await wait(800);
        if (!isCollecting) return;

        // Try multiple selectors to find skip button
        let skipButton = document.querySelector('button[data-test-id="skip-button"]');
        
        if (!skipButton) {
            skipButton = document.querySelector('button[aria-label*="Skip preference"]');
        }
        
        if (!skipButton) {
            const buttons = Array.from(document.querySelectorAll('button'));
            skipButton = buttons.find(btn => 
                btn.textContent?.trim().toLowerCase() === 'skip' && 
                !btn.disabled &&
                btn.offsetParent !== null // Check if visible
            );
        }
        
        if (skipButton && !skipButton.disabled && !skipButton.getAttribute('aria-disabled')) {
            console.log('Skip button detected, clicking...');
            skipButton.click();
            await wait(500);
            if (!isCollecting) return;
            console.log('✅ Skip button clicked successfully');
        }
    } catch (error) {
        // Skip button handling is optional, don't throw error
        console.log('Skip button check completed (no skip button found or error):', error.message);
    }
}

async function waitForResponseAndScrape(keywordInfo, baselineTablesCount = 0) {
    const isBatch = Array.isArray(keywordInfo);
    const logIdentifier = isBatch ? `batch starting with "${keywordInfo[0]}"` : `"${keywordInfo}"`;
    const inputForCopy = isBatch ? keywordInfo[0] : keywordInfo;

    let attempts = 0;
    const maxAttempts = 60;
    let lastLength = 0;
    let stableCount = 0;

    console.log(`Waiting for response for ${logIdentifier}...`);

    while (attempts < maxAttempts && isCollecting) { // ADD: && isCollecting check
        // INSTANT ABORT: Double-check at start of each loop iteration
        if (!isCollecting) {
            console.log('🛑 Response wait aborted - collection stopped');
            throw new Error('Collection stopped by user');
        }
        
        const tableSelector = '.model-prompt-container[data-turn-role="Model"] .table-container table';
        const runBtn = document.querySelector('button[aria-label="Run"]');
        const isRunDisabled = !!(runBtn && (runBtn.hasAttribute('disabled') || runBtn.getAttribute('aria-disabled') === 'true' || runBtn.classList.contains('disabled')));
        const isStopState = !!(runBtn && (runBtn.textContent?.trim().toLowerCase().includes('stop') || runBtn.classList.contains('stoppable')));

        let targetTable = null;
        const modelContainers = document.querySelectorAll('.model-prompt-container[data-turn-role="Model"]');
        if (modelContainers.length > 0) {
            const latestContainer = modelContainers[modelContainers.length - 1];
            targetTable = latestContainer.querySelector('.table-container table');
        }

        if (targetTable) {
            const dataRowCount = targetTable.querySelectorAll('tr:not(.table-header)').length;
            const tableTextLength = (targetTable.innerText || '').trim().length;

            if (dataRowCount >= 1 && tableTextLength >= 50) {
                const isStable = await waitForQuietDOM(targetTable, 1500);
                
                if (isStable && isRunDisabled && !isStopState) {
                    if (tableTextLength === lastLength) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastLength = tableTextLength;
                    }
                    
                    if (stableCount >= 2) {
                        const structured = parseResultTable(targetTable);
                        if (structured && structured.rows.length > 0) {
                            await saveStructuredCityData(logIdentifier, structured, targetTable.outerHTML);
                            console.log(`✅ Scraped ${structured.rows.length} rows for ${logIdentifier}`);
                            
                            if (autoCopyResponse) {
                                await autoCopyAIResponse(inputForCopy);
                            }
                            return;
                        }
                    }
                }
            }
        }
        
        if (attempts % 10 === 0 && attempts > 0) {
            console.log(`Still waiting for ${logIdentifier} response... (${attempts}s elapsed)`);
        }
        await wait(1000);
        if (!isCollecting) {
            console.log('🛑 Response wait aborted - collection stopped');
            throw new Error('Collection stopped by user');
        }
        attempts++;
    }

    console.warn(`⚠️ No response found for ${logIdentifier} after ${maxAttempts} seconds.`);
    throw new Error(`Timeout waiting for response for ${logIdentifier}`);
}

async function autoCopyAIResponse(city) {
    if (!isCollecting) return; // INSTANT ABORT
    
    try {
        console.log(`Auto-copying AI response for ${city}...`);
        const optionsButton = document.querySelector('ms-chat-turn-options button[aria-label="Open options"]');
        if (!optionsButton) {
            console.warn('Options button not found for auto-copy');
            return;
        }
        optionsButton.click();
        console.log('Clicked options button');
        await wait(500);
        
        const copyButton = Array.from(document.querySelectorAll('button[mat-menu-item]')).find(btn => btn.textContent.includes('Copy as text'));
        if (!copyButton) {
            console.warn('Copy as text button not found');
            return;
        }
        copyButton.click();
        console.log('Clicked copy as text button');
        await wait(300);
        
        const copiedText = await navigator.clipboard.readText();
        const result = await chrome.storage.local.get(['copiedResponses']);
        const copiedResponses = result.copiedResponses || [];
        copiedResponses.push({ city: city, text: copiedText, timestamp: new Date().toISOString() });
        await chrome.storage.local.set({ copiedResponses: copiedResponses });
        console.log(`✅ Auto-copied and saved response for ${city} (${copiedText.length} chars)`);
    } catch (error) {
        console.error('Error auto-copying AI response:', error);
    }
}

function parseResultTable(tableEl) {
    try {
        const headerRow = tableEl.querySelector('tr.table-header');
        if (!headerRow) {
            console.warn('No header row found in table');
            return null;
        }

        const headerCells = Array.from(headerRow.querySelectorAll('td'));
        const headers = headerCells.map(cell => {
            const span = cell.querySelector('ms-cmark-node span');
            return span ? span.textContent.trim() : cell.textContent.trim();
        });

        if (headers.length === 0) {
            console.warn('No headers found');
            return null;
        }

        const allRows = Array.from(tableEl.querySelectorAll('tr'));
        const headerIndex = allRows.indexOf(headerRow);
        const dataRows = allRows.slice(headerIndex + 1).filter(r => r.querySelectorAll('td').length > 0);
        
        if (dataRows.length === 0) {
            console.warn('No data rows found');
            return null;
        }

        const normalizeIdx = (name, fallbackIndex) => {
            const idx = headers.findIndex(h => h.toLowerCase().includes(name));
            return idx >= 0 ? idx : fallbackIndex;
        };

        const idxInputCountry = normalizeIdx('input', 0);
        const idxEnglishKW = normalizeIdx('english', 1);
        const idxLocalTone = normalizeIdx('local tone', 2);
        const idxMisspell = normalizeIdx('misspell', 3);
        const idxCityKW = normalizeIdx('city kw', 4);
        const idxPopularUrl = normalizeIdx('popular url', 5);

        const rows = dataRows.map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const getCellText = (cell) => {
                if (!cell) return '';
                const span = cell.querySelector('ms-cmark-node span');
                if (span) return span.textContent.trim();
                return cell.textContent.trim();
            };

            let urlText = '';
            const urlCell = cells[idxPopularUrl];
            if (urlCell) {
                const anchor = urlCell.querySelector('a[href]');
                if (anchor) {
                    const linkText = anchor.textContent.trim();
                    if (linkText && !linkText.startsWith('http')) {
                        urlText = anchor.href;
                    } else {
                        urlText = linkText;
                    }
                } else {
                    urlText = getCellText(urlCell);
                }
            }

            return {
                inputCountry: getCellText(cells[idxInputCountry]),
                englishKW: getCellText(cells[idxEnglishKW]),
                localTone: getCellText(cells[idxLocalTone]),
                misspell: getCellText(cells[idxMisspell]),
                cityKW: getCellText(cells[idxCityKW]),
                popularUrl: urlText
            };
        });

        console.log(`Parsed ${rows.length} rows from table`);
        return { headers, rows };
    } catch (e) {
        console.error('Failed to parse result table:', e);
        return null;
    }
}

async function saveStructuredCityData(city, structured, rawHtml) {
    try {
        const result = await chrome.storage.local.get(['cityData']);
        const cityData = result.cityData || [];
        const timestamp = new Date().toISOString();
        
        // Calculate actual row number based on tab assignment
        // In multi-tab mode: assignedStartIndex + currentIndex
        // In single-tab mode: just currentIndex
        const actualRowNumber = isMultiTabMode 
            ? assignedStartIndex + currentIndex + 1 // +1 because assignedStartIndex is 0-based
            : currentIndex + 1;
        
        if (structured && Array.isArray(structured.rows)) {
            structured.rows.forEach(row => {
                cityData.push({
                    rowNumber: actualRowNumber, // ADD: Store row number for sorting
                    inputCountry: row.inputCountry || '',
                    englishKW: row.englishKW || '',
                    localTone: row.localTone || '',
                    misspell: row.misspell || '',
                    cityKW: row.cityKW || '',
                    popularUrl: row.popularUrl || '',
                    timestamp: timestamp,
                    format: 'table-row'
                });
            });
        }
        
        await chrome.storage.local.set({ cityData: cityData });
        
        if (structured && structured.rows && structured.rows.length > 1) {
            console.log(`Successfully saved ${structured.rows.length} rows for ${city} at row ${actualRowNumber}`);
        }
        
        await checkStorageQuota();
        console.log(`Saved ${structured?.rows?.length || 0} structured rows for ${city} at row ${actualRowNumber}`);
    } catch (error) {
        console.error('Error saving structured city data:', error);
        if (error.message && error.message.includes('QUOTA')) {
            await handleQuotaExceeded();
        }
    }
}

async function checkStorageQuota() {
    try {
        const result = await chrome.storage.local.get(['cityData']);
        const cityData = result.cityData || [];
        const estimatedSize = JSON.stringify(cityData).length;
        const quotaLimit = 10 * 1024 * 1024;
        
        if (estimatedSize > quotaLimit * 0.8) {
            console.warn('Storage approaching limit. Triggering auto-download...');
            await autoDownloadAndClear(cityData);
        }
    } catch (error) {
        console.error('Error checking storage quota:', error);
    }
}

async function autoDownloadAndClear(cityData) {
    try {
        chrome.runtime.sendMessage({
            action: 'autoDownload',
            data: cityData,
            count: cityData.length
        });
        await wait(2000);
        const lastCity = cityData[cityData.length - 1]?.inputCountry || '';
        await chrome.storage.local.set({ 
            lastAutoDownload: {
                timestamp: new Date().toISOString(),
                count: cityData.length,
                lastCity: lastCity
            }
        });
        console.log(`Auto-downloaded ${cityData.length} rows and cleared storage`);
    } catch (error) {
        console.error('Error in auto-download:', error);
    }
}

async function checkAndDownloadForDuplicateInput(currentCity) {
    try {
        const result = await chrome.storage.local.get(['inputCounts', 'processedInputs', 'cityData']);
        const inputCounts = result.inputCounts || {};
        const processedInputs = result.processedInputs || {};
        const allCityData = result.cityData || [];
        
        processedInputs[currentCity] = (processedInputs[currentCity] || 0) + 1;
        await chrome.storage.local.set({ processedInputs: processedInputs });
        
        if (inputCounts[currentCity] > 1 && processedInputs[currentCity] === inputCounts[currentCity]) {
            console.log(`All ${inputCounts[currentCity]} occurrences of "${currentCity}" processed. Checking data quality...`);
            const inputData = allCityData.filter(item => item.inputCountry === currentCity || item.city === currentCity);
            const successfulRows = inputData.filter(item => item.format === 'table-row');
            
            if (successfulRows.length > 1) {
                console.log(`Input "${currentCity}" has ${successfulRows.length} successful rows. Marking as completed.`);
                completedInputs.add(currentCity);
                await chrome.storage.local.set({ completedInputs: Array.from(completedInputs) });
                
                if (inputData.length > 0) {
                    chrome.runtime.sendMessage({
                        action: 'autoDownloadForInput',
                        data: inputData,
                        inputName: currentCity,
                        count: inputData.length
                    });
                    console.log(`Auto-downloaded ${inputData.length} rows for input "${currentCity}" (data kept in storage)`);
                }
            } else {
                console.log(`Input "${currentCity}" has only ${successfulRows.length} successful rows. Will retry in loop.`);
            }
        }
    } catch (error) {
        console.error('Error checking for duplicate input:', error);
    }
}

async function updateStatus(message) {
    // Get current collection state
    const currentState = await chrome.storage.local.get('collectionState');
    const collectionState = currentState.collectionState || {};
    
    // Update collection state with status information
    await chrome.storage.local.set({ 
        lastStatus: message,
        collectionState: {
            ...collectionState,
            isCollecting: isCollecting,
            currentStatus: message
        }
    });
    
    chrome.runtime.sendMessage({ action: 'updateStatus', message: message });
}

async function updateProgress(current, total, currentCity) {
    // Get current collection state
    const currentState = await chrome.storage.local.get('collectionState');
    const collectionState = currentState.collectionState || {};
    
    // Update collection state with progress information
    await chrome.storage.local.set({
        collectionState: {
            ...collectionState,
            currentCity: currentCity,
            currentIndex: current,
            totalCities: total,
            isCollecting: isCollecting,
            isLoopCollection: isLoopCollection,
            loopIteration: loopIteration,
            cityList: cityList,
            originalCityList: originalCityList,
            incompleteCountries: incompleteCountries,
            failedInputs: failedInputs,
            isRetryingFailedInput: isRetryingFailedInput,
            inputsProcessedInThisTab: inputsProcessedInThisTab,
            isMultiTabMode: isMultiTabMode,
            isSerialMode: isSerialMode
        },
        progressData: {
            current: current,
            total: total,
            currentCity: currentCity,
            isLoopCollection: isLoopCollection,
            loopIteration: loopIteration
        }
    });
    
    chrome.runtime.sendMessage({
        action: 'updateProgress',
        current: current,
        total: total,
        currentCity: currentCity,
        isLoopCollection: isLoopCollection,
        loopIteration: loopIteration
    });
}

async function clearProgressData() {
    completedInputs.clear();
    await chrome.storage.local.set({
        collectionState: null,
        cityData: [],
        lastStatus: 'Progress cleared',
        lastAutoDownload: null,
        inputCounts: {},
        processedInputs: {},
        completedInputs: [],
        failedInputs: [],
        isRetryingFailedInput: false,
        repetitionCount: 1,
        useDynamicBatch: false,
        copiedResponses: [],
        currentKeywordIndex: 0
    });
    console.log('All collection and data progress cleared.');
    chrome.runtime.sendMessage({ action: 'progressCleared' });
}

function wait(ms) {
    return new Promise((resolve, reject) => {
        const checkInterval = 100; // Check every 100ms
        let elapsed = 0;
        
        const intervalId = setInterval(() => {
            elapsed += checkInterval;
            
            if (!isCollecting) {
                clearInterval(intervalId);
                reject(new Error('Collection stopped'));
            }
            
            if (elapsed >= ms) {
                clearInterval(intervalId);
                resolve();
            }
        }, checkInterval);
    });
}

function waitForQuietDOM(targetNode, quietMs = 1000) {
    return new Promise(resolve => {
        let timeoutId;
        const observer = new MutationObserver(() => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                observer.disconnect();
                resolve(true);
            }, quietMs);
        });
        try {
            observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
            timeoutId = setTimeout(() => {
                observer.disconnect();
                resolve(true);
            }, quietMs);
        } catch (e) {
            resolve(true);
        }
    });
}

async function isSystemInstructionsEmpty() {
    try {
        const systemButton = document.querySelector('button[data-test-system-instructions-card], button.system-instructions-card, button[aria-label="System instructions"]');
        if (!systemButton) {
            console.warn('System instructions button not found');
            return true;
        }
        systemButton.click();
        console.log('System instructions button clicked to check content');
        await wait(1000);
        
        const textarea = document.querySelector('textarea[aria-label="System instructions"], ms-system-instructions textarea');
        if (!textarea) {
            console.warn('System instructions textarea not found');
            return true;
        }
        
        const isEmpty = !textarea.value || textarea.value.trim().length === 0;
        console.log(`System instructions box is ${isEmpty ? 'empty' : 'not empty'}`);
        
        const closeButton = document.querySelector('button[data-test-close-button], button[mat-dialog-close], button[aria-label="Close panel"]');
        if (closeButton) {
            closeButton.click();
            await wait(500);
        } else {
            systemButton.click();
            await wait(500);
        }
        return isEmpty;
    } catch (error) {
        console.error('Error checking system instructions:', error);
        return true;
    }
}

async function setSystemInstructions() {
    try {
        updateStatus('Setting up system instructions...');
        
        // Load system prompt from file if not already loaded
        if (!SYSTEM_INSTRUCTION_PROMPT) {
            await loadSystemPrompt();
        }
        
        const systemButton = document.querySelector('button[data-test-system-instructions-card], button.system-instructions-card, button[aria-label="System instructions"]');
        if (!systemButton) {
            console.warn('System instructions button not found, skipping...');
            return;
        }
        systemButton.click();
        console.log('System instructions button clicked');
        await wait(1000);
        if (!isCollecting) {
            console.log('🛑 setSystemInstructions aborted - collection stopped');
            return;
        }

        const textarea = document.querySelector('textarea[aria-label="System instructions"], ms-system-instructions textarea');
        if (!textarea) {
            console.warn('System instructions textarea not found');
            return;
        }
        textarea.focus();
        textarea.value = SYSTEM_INSTRUCTION_PROMPT;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('System instructions set successfully');
        await wait(500);
        if (!isCollecting) {
            console.log('🛑 setSystemInstructions aborted after setting - collection stopped');
            return;
        }

        const closeButton = document.querySelector('button[data-test-close-button], button[mat-dialog-close], button[aria-label="Close panel"]');
        if (closeButton) {
            closeButton.click();
            await wait(500);
            console.log('System instructions panel closed with X button');
        } else {
            systemButton.click();
            await wait(500);
            console.log('System instructions panel closed by toggling system button');
        }
        await updateStatus('System instructions configured');
    } catch (error) {
        console.error('Error setting system instructions:', error);
        await updateStatus('Warning: Could not set system instructions');
    }
}

async function startNewChatSession() {
    // INSTANT ABORT: Check if collection stopped
    if (!isCollecting) {
        console.log('🛑 startNewChatSession aborted - collection stopped');
        return;
    }

    try {
        // For both single-tab and multi-tab mode, use the same approach
        // Click the new chat button to start a fresh session without closing/reloading the tab
        if (isMultiTabMode || true) {
            console.log(`Starting new chat session within the same tab...`);
        }
        
        // Common logic for both modes: Click new chat button
        const newChatButton = document.querySelector('a.nav-item[href*="/prompts/new_chat"], a[href*="/prompts/new_chat"]');
        if (!newChatButton) {
            console.warn('New chat button not found, continuing in same chat');
            return;
        }
        newChatButton.click();
        console.log('Clicked new chat button - tab remains open');
        await waitForUiReady(6000);
        if (!isCollecting) {
            console.log('🛑 startNewChatSession aborted after UI ready - collection stopped');
            return;
        }
        console.log('New chat UI ready in the same tab');

        // Reload batch size from storage after new chat session
        await ensureBatchSizeLoaded();

        // Re-enable Google Search grounding
        await enableGoogleSearchGrounding();
        if (!isCollecting) {
            console.log('🛑 startNewChatSession aborted after grounding - collection stopped');
            return;
        }
        
        // Re-set system instructions if empty
        const isEmpty = await isSystemInstructionsEmpty();
        if (isEmpty) {
            console.log('System instructions box is empty, setting up system instructions...');
            await setSystemInstructions();
        }
    } catch (error) {
        console.error('Error starting new chat session:', error);
    }
}

async function waitForUiReady(timeoutMs = 6000) {
    const start = Date.now();
    const readyNow = () => {
        const textarea = document.querySelector('textarea.textarea, textarea[aria-label*="Type"], textarea[placeholder*="prompt"], ms-autosize-textarea textarea');
        const runButton = document.querySelector('button[aria-label="Run"]');
        return !!(textarea && runButton);
    };
    if (readyNow()) return;
    return new Promise(resolve => {
        const observer = new MutationObserver(() => {
            if (readyNow()) {
                observer.disconnect();
                resolve();
            }
        });
        try {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) {
            resolve();
        }
        const ticker = setInterval(() => {
            if (readyNow() || Date.now() - start > timeoutMs) {
                clearInterval(ticker);
                observer.disconnect();
                resolve();
            }
        }, 100);
    });
}