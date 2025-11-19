document.addEventListener('DOMContentLoaded', async function() {
    const runBtn = document.getElementById('runBtn');
    const stopBtn = document.getElementById('stopBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const clearBtn = document.getElementById('clearBtn');
    const status = document.getElementById('status');
    const progressBar = document.getElementById('progressBar');
    const currentCity = document.getElementById('currentCity');
    const progress = document.getElementById('progress');
    const storageCount = document.getElementById('storageCount');
    const repetitionInput = document.getElementById('repetitionCount');
    const useDynamicBatchCheckbox = document.getElementById('useDynamicBatch');
    const autoCopyResponseCheckbox = document.getElementById('autoCopyResponse');
    const keywordBatchInput = document.getElementById('keywordBatchSize');
    const numberOfTabsInput = document.getElementById('numberOfTabs');
    const excelFileInput = document.getElementById('excelFileInput');
    const fileStatus = document.getElementById('fileStatus');
    
    let isRunning = false;
    
    // Initialize stop button as disabled
    if (stopBtn) {
        stopBtn.disabled = true;
    }
    
    // File upload handler
    if (excelFileInput) {
        excelFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                fileStatus.textContent = 'Reading file...';
                const arrayBuffer = await file.arrayBuffer();
                
                // Store file data in Chrome storage
                const base64Data = btoa(
                    new Uint8Array(arrayBuffer)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );
                
                await chrome.storage.local.set({
                    uploadedExcelFile: base64Data,
                    uploadedFileName: file.name,
                    uploadedFileTimestamp: new Date().toISOString()
                });
                
                fileStatus.textContent = `✓ ${file.name} uploaded`;
                fileStatus.style.color = 'green';
                
                console.log('Excel file uploaded and stored');
            } catch (error) {
                fileStatus.textContent = `✗ Error: ${error.message}`;
                fileStatus.style.color = 'red';
                console.error('File upload error:', error);
            }
        });
    }
    
    // Load saved repetition count, dynamic batch setting and keyword batch size
    chrome.storage.local.get(['repetitionCount', 'useDynamicBatch', 'autoCopyResponse', 'keywordBatchSize', 'numberOfTabs', 'startRow', 'uploadedFileName', 'uploadedFileTimestamp'], (result) => {
        if (repetitionInput) {
            repetitionInput.value = result.repetitionCount || 1;
        }
        if (useDynamicBatchCheckbox) {
            useDynamicBatchCheckbox.checked = result.useDynamicBatch || false;
        }
        if (autoCopyResponseCheckbox) {
            autoCopyResponseCheckbox.checked = result.autoCopyResponse || false;
        }
        if (keywordBatchInput) {
            keywordBatchInput.value = result.keywordBatchSize || 5;
        }
        if (numberOfTabsInput) {
            numberOfTabsInput.value = result.numberOfTabs || 1;
        }
        if (startRowInput) {
            startRowInput.value = result.startRow || 1;
        }
        
        // Display uploaded file information if available
        if (result.uploadedFileName && fileStatus) {
            fileStatus.textContent = `✓ ${result.uploadedFileName} uploaded`;
            fileStatus.style.color = 'green';
            
            // Add timestamp if available
            if (result.uploadedFileTimestamp) {
                const uploadDate = new Date(result.uploadedFileTimestamp);
                const formattedDate = uploadDate.toLocaleDateString() + ' ' + uploadDate.toLocaleTimeString();
                fileStatus.title = `Uploaded on: ${formattedDate}`;
            }
        }
    });
    
    // Save repetition count when changed
    if (repetitionInput) {
        repetitionInput.addEventListener('change', async (e) => {
            const count = parseInt(e.target.value) || 1;
            const validCount = Math.max(1, Math.min(10, count)); // Clamp between 1-10
            repetitionInput.value = validCount; // Update UI to show clamped value
            
            // Save to storage
            await chrome.storage.local.set({ repetitionCount: validCount });
            
            // Send to content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.sendMessage(tab.id, {
                    action: 'setRepetitionCount',
                    count: validCount
                });
                console.log(`Repetition count updated to: ${validCount}`);
            } catch (error) {
                console.error('Error setting repetition count:', error);
            }
        });
    }
    
    // Save dynamic batch setting when changed
    if (useDynamicBatchCheckbox) {
        useDynamicBatchCheckbox.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            
            // Save to storage
            await chrome.storage.local.set({ useDynamicBatch: enabled });
            
            // Send to content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.sendMessage(tab.id, {
                    action: 'setUseDynamicBatch',
                    enabled: enabled
                });
                console.log(`Dynamic batch setting updated to: ${enabled}`);
            } catch (error) {
                console.error('Error setting dynamic batch:', error);
            }
        });
    }
    
    // Save auto-copy response setting when changed
    if (autoCopyResponseCheckbox) {
        autoCopyResponseCheckbox.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            
            // Save to storage
            await chrome.storage.local.set({ autoCopyResponse: enabled });
            
            // Send to content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.sendMessage(tab.id, {
                    action: 'setAutoCopyResponse',
                    enabled: enabled
                });
                console.log(`Auto-copy response setting updated to: ${enabled}`);
            } catch (error) {
                console.error('Error setting auto-copy response:', error);
            }
        });
    }

    // Save keyword batch size when changed
    if (keywordBatchInput) {
        keywordBatchInput.addEventListener('change', async (e) => {
            let size = parseInt(e.target.value, 10) || 5;
            size = Math.max(1, Math.min(10000, size)); // Clamp between 1 and 10000
            keywordBatchInput.value = size;

            // Save to storage
            await chrome.storage.local.set({ keywordBatchSize: size });

            // Send to content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.sendMessage(tab.id, { action: 'setKeywordBatchSize', size: size });
                console.log(`Keyword batch size updated to: ${size}`);
            } catch (error) {
                console.error('Error setting keyword batch size:', error);
            }
        });
    }
    
    // Save number of tabs when changed
    if (numberOfTabsInput) {
        numberOfTabsInput.addEventListener('change', async (e) => {
            const count = parseInt(e.target.value) || 1;
            const validCount = Math.max(1, Math.min(10, count));
            numberOfTabsInput.value = validCount;
            
            await chrome.storage.local.set({ numberOfTabs: validCount });
            console.log(`Number of tabs updated to: ${validCount}`);
        });
    }
    
    // Save start row when changed
    const startRowInput = document.getElementById('startRowInput');
    if (startRowInput) {
        startRowInput.addEventListener('change', async (e) => {
            const startRow = parseInt(e.target.value) || 1;
            const validStartRow = Math.max(1, startRow); // Ensure it's at least 1
            startRowInput.value = validStartRow;
            
            await chrome.storage.local.set({ startRow: validStartRow });
            console.log(`Start row updated to: ${validStartRow}`);
        });
    }
    
    // Restore progress data from storage
    const result = await chrome.storage.local.get(['progressData', 'currentStatus']);
    
    if (result.progressData) {
        const { current, total, currentCity, isLoopCollection, loopIteration } = result.progressData;
        // Update your UI elements here with the restored data
        if (total > 0) {
            const percentage = (current / total) * 100;
            progressBar.style.width = percentage + '%';
            
            // Update city display with loop information
            let cityDisplay = currentCity || '-';
            if (isLoopCollection) {
                cityDisplay = `Loop ${loopIteration}: ${cityDisplay}`;
            }
            currentCity.textContent = cityDisplay;
            
            progress.textContent = `${current}/${total}`;
        }
    }
    
    if (result.currentStatus) {
        // Update status display
        status.textContent = result.currentStatus;
    }
    
    // Check if we're on the correct page
    chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
        const currentTab = tabs[0];
        if (!currentTab.url.includes('aistudio.google.com')) {
            status.textContent = 'Please navigate to AI Studio first';
            runBtn.disabled = true;
            stopBtn.disabled = true;
        } else {
            // Restore state from storage
            await restoreState();
        }
    });
    
    // Function to restore UI state
    async function restoreState() {
        try {
            const state = await chrome.storage.local.get(['collectionState', 'cityData', 'isRunning', 'multiTabState']);
            const collectionState = state.collectionState;
            const cityData = state.cityData || [];
            const wasRunning = state.isRunning || false;
            const multiTabState = state.multiTabState;
            
            // Update storage count
            updateStorageCount(cityData.length);
            
            // Check if we're in multi-tab mode
            if (multiTabState && multiTabState.isActive) {
                // Multi-tab mode is active
                isRunning = true;
                runBtn.style.display = 'block';
                runBtn.disabled = true;
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                
                // Restore multi-tab progress
                const current = multiTabState.currentProgress || 0;
                const total = multiTabState.totalKeywords || 0;
                
                if (total > 0) {
                    const percentage = (current / total) * 100;
                    progressBar.style.width = percentage + '%';
                    currentCity.textContent = `Multi-tab processing: Tab ${multiTabState.currentProcessingTab + 1}/${multiTabState.totalTabs}`;
                    progress.textContent = `${current}/${total}`;
                    status.textContent = `Processing in ${multiTabState.totalTabs} tabs...`;
                }
            } else if (collectionState && collectionState.isCollecting) {
                // Single-tab collection is running, restore running UI
                isRunning = true;
                runBtn.style.display = 'block';
                runBtn.disabled = true;
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                
                // Restore progress
                const current = collectionState.currentIndex || 0;
                const total = collectionState.totalCities || 0;
                const city = collectionState.currentCity || '-';
                const isLoopCollection = collectionState.isLoopCollection || false;
                const loopIteration = collectionState.loopIteration || 0;
                
                const actualTotal = collectionState.totalCities || cityList.length || total;
                if (actualTotal > 0) {
                    const percentage = (current / actualTotal) * 100;
                    progressBar.style.width = percentage + '%';
                    
                    // Update city display with loop information
                    let cityDisplay = city;
                    if (isLoopCollection) {
                        cityDisplay = `Loop ${loopIteration}: ${city}`;
                    }
                    currentCity.textContent = cityDisplay;
                    
                    progress.textContent = `${current}/${actualTotal}`;
                    
                    let statusMessage = `Processing: ${city}`;
                    if (isLoopCollection) {
                        statusMessage = `Loop ${loopIteration} - ${statusMessage}`;
                    }
                    status.textContent = statusMessage;
                }
            } else if (wasRunning) {
                // General running state without specific collection state
                isRunning = true;
                runBtn.style.display = 'block';
                runBtn.disabled = true;
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                status.textContent = 'Processing...';
            } else if (cityData.length > 0) {
                status.textContent = `Ready - ${cityData.length} cities already collected`;
                stopBtn.disabled = true;
            } else {
                status.textContent = 'Ready to start';
                stopBtn.disabled = true;
            }
        } catch (error) {
            console.error('Error restoring state:', error);
        }
    }
    
    // Run button click handler
    runBtn.addEventListener('click', async function() {
        const startRowInput = document.getElementById('startRowInput');
        let startRow = 1;
        if (startRowInput && startRowInput.value) {
            startRow = parseInt(startRowInput.value, 10) || 1;
        }
        startCollection(startRow);
    });
    
    // Stop button click handler
    stopBtn.addEventListener('click', function() {
        stopCollection();
    });
    
    // Download button click handler
    downloadBtn.addEventListener('click', function() {
        downloadResults();
    });
    
    // Clear button click handler
    clearBtn.addEventListener('click', async function() {
        try {
            // Send message to content script to clear progress
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { action: 'clearProgress' });
            
            // Clear UI
            await chrome.storage.local.set({ 
                cityData: [],
                collectionState: null 
            });
            updateStorageCount(0);
            progressBar.style.width = '0%';
            currentCity.textContent = '-';
            progress.textContent = '0/0';
            status.textContent = 'Storage cleared';
        } catch (e) {
            console.error('Error clearing storage:', e);
            status.textContent = 'Error clearing storage';
        }
    });
    
    async function startCollection(startRow) {
        try {
            // Save running state to storage
            await chrome.storage.local.set({ isRunning: true });
            
            // Get settings
            const settings = await chrome.storage.local.get(['numberOfTabs', 'repetitionCount', 'keywordBatchSize']);
            const numberOfTabs = settings.numberOfTabs || 1;
            const repetitionCount = settings.repetitionCount || 1;
            const keywordsPerPrompt = settings.keywordBatchSize || 5; // ADDED: Get keywordsPerPrompt from storage
            
            // Try to load from Excel file first
            let uniqueCities = [];
            try {
                console.log('Popup: Attempting to load Excel file: input (1).xlsx');
                const response = await fetch(chrome.runtime.getURL('input (1).xlsx'));
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch Excel file: ${response.status} ${response.statusText}`);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                console.log('Popup: Excel file loaded, size:', arrayBuffer.byteLength, 'bytes');
                
                if (arrayBuffer.byteLength === 0) {
                    throw new Error('Excel file is empty');
                }
                
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                console.log('Popup: Excel workbook loaded, sheets:', workbook.SheetNames);
                
                if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                    throw new Error('No sheets found in Excel file');
                }
                
                // Get first worksheet
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                console.log('Popup: Using sheet:', firstSheetName);
                
                // Convert to JSON
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                console.log('Popup: Excel data converted to JSON, rows:', jsonData.length);
                
                if (!jsonData || jsonData.length === 0) {
                    throw new Error('No data found in Excel sheet');
                }
                
                // Extract keywords from first column
                for (let i = 0; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0) continue;
                    
                    const cellValue = row[0]; // First column
                    if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
                        const keyword = String(cellValue).trim();
                        if (keyword && !uniqueCities.includes(keyword)) {
                            uniqueCities.push(keyword);
                        }
                    }
                }
                
                console.log('Popup: Extracted keywords:', uniqueCities.slice(0, 5), '... total:', uniqueCities.length);
                
                if (uniqueCities.length === 0) {
                    throw new Error('No valid keywords found in Excel file');
                }
                
                console.log(`Loaded ${uniqueCities.length} unique keywords from Excel file`);
            } catch (excelError) {
                console.warn('Popup: Failed to load Excel file, falling back to CSV:', excelError);
                
                // Fallback to CSV if Excel loading fails
                try {
                    const response = await fetch(chrome.runtime.getURL('input.csv'));
                    if (!response.ok) {
                        throw new Error(`Failed to fetch CSV file: ${response.status} ${response.statusText}`);
                    }
                    const csvText = await response.text();
                    const lines = csvText.split('\n');
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line && !line.startsWith('#')) {
                            const city = line.replace(/^["']|["']$/g, '').trim();
                            if (city && !uniqueCities.includes(city)) {
                                uniqueCities.push(city);
                            }
                        }
                    }
                    
                    console.log(`Loaded ${uniqueCities.length} unique keywords from CSV file`);
                } catch (csvError) {
                    console.warn('Popup: Failed to load CSV file:', csvError);
                    
                    // If both Excel and CSV fail, create a default list
                    console.log('Popup: Creating default keyword list as fallback...');
                    uniqueCities = ['default keyword'];
                    console.log(`Created default list with ${uniqueCities.length} keywords`);
                }
            }
            
            const totalKeywords = uniqueCities.length * repetitionCount;
            
            if (totalKeywords === 0) {
                status.textContent = 'No keywords found in input file';
                // Clear running state if no keywords found
                await chrome.storage.local.set({ isRunning: false });
                return;
            }
            
            // If single tab, use old flow
            if (numberOfTabs === 1) {
                isRunning = true;
                runBtn.style.display = 'block';
                runBtn.disabled = true;
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                status.textContent = 'Starting collection...';
                
                const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
                if (!tab.url.includes('aistudio.google.com')) {
                    throw new Error('Please navigate to AI Studio first');
                }
                
                const response = await chrome.tabs.sendMessage(tab.id, {
                    action: 'startCollection',
                    startRow: startRow
                });
                
                if (response && response.success) {
                    status.textContent = 'Collection started - processing keywords...';
                } else {
                    throw new Error(response?.error || 'Failed to start collection');
                }
            } else {
                // Multi-tab parallel processing
                isRunning = true;
                runBtn.style.display = 'block';
                runBtn.disabled = true;
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                status.textContent = `Pre-initializing ${numberOfTabs} tabs...`;
                
                // Wait a moment for UI update
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Get current tab URL to extract profile
                const [currentTab] = await chrome.tabs.query({active: true, currentWindow: true});
                
                // Send to background script to orchestrate multi-tab processing
                chrome.runtime.sendMessage({
                    action: 'initiateMultiTabCollection',
                    numberOfTabs: numberOfTabs,
                    totalKeywords: totalKeywords,
                    repetitionCount: repetitionCount,
                    keywordsPerPrompt: keywordsPerPrompt, // ADDED: Pass keywordsPerPrompt to background
                    startRow: startRow,
                    currentProfileUrl: currentTab.url
                });
            }
        } catch (error) {
            console.error('Error starting collection:', error);
            status.textContent = 'Error: ' + error.message;
            isRunning = false;
            runBtn.style.display = 'block';
            runBtn.disabled = false;
            stopBtn.style.display = 'block';
            stopBtn.disabled = true;
            
            // Clear running state on error
            await chrome.storage.local.set({ isRunning: false });
        }
    }
    
    function stopCollection() {
        console.log('🛑 Stop button clicked - sending stop signal');
        
        isRunning = false;
        runBtn.style.display = 'block';
        runBtn.disabled = false;
        stopBtn.style.display = 'block';
        stopBtn.disabled = true;
        status.textContent = 'Stopping collection...';
        
        // Clear running state from storage
        chrome.storage.local.set({ isRunning: false });
        
        // Send IMMEDIATE stop message to ALL tabs (not just active)
        chrome.tabs.query({url: 'https://aistudio.google.com/*'}, function(tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'stopCollection'
                }).catch(err => {
                    console.log(`Could not send stop to tab ${tab.id}:`, err);
                });
            });
        });
        
        // Also clear collection state immediately
        chrome.storage.local.set({ 
            collectionState: null 
        }).then(() => {
            status.textContent = 'Collection stopped';
            console.log('🛑 Stop signal sent to all tabs and state cleared');
        });
    }
    
    async function downloadResults() {
        try {
            // Get data from storage
            const result = await chrome.storage.local.get(['cityData']);
            const cityData = result.cityData || [];
            
            if (cityData.length === 0) {
                status.textContent = 'No data to download';
                return;
            }
            
            // Convert to CSV
            const csv = convertToCSV(cityData);
            
            // Download file
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai_studio_city_data_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            status.textContent = `Downloaded ${cityData.length} records`;
        } catch (error) {
            console.error('Error downloading results:', error);
            status.textContent = 'Error downloading results';
        }
    }
    
    // Optimized convertToCSV for large datasets
    function convertToCSV(data) {
        if (data.length === 0) return '';
        
        // ADDED: Sort data by rowNumber before converting to CSV
        const sortedData = [...data].sort((a, b) => {
            const rowA = a.rowNumber || 0;
            const rowB = b.rowNumber || 0;
            return rowA - rowB;
        });
        
        const hasStructured = sortedData.some(r => r.format === 'table-row' || r.format === 'table' || (r.englishKW || r.localTone || r.misspell || r.cityKW || r.popularUrl));
        let headers;
        if (hasStructured) {
            headers = ['Row_Number', 'Input_Country', 'English KW', 'local tone', 'misspell', 'city kw', 'popular url', 'Timestamp']; // ADDED: Row_Number column
        } else {
            headers = ['Row_Number', 'City', 'Response', 'Timestamp']; // ADDED: Row_Number column
        }
        
        const csvRows = [headers.join(',')];
        const escape = (val) => {
            const str = String(val ?? '').replace(/"/g, '""');
            return `"${str.replace(/\r?\n/g, ' ')}"`;
        };
        
        const chunkSize = 1000;
        for (let i = 0; i < sortedData.length; i += chunkSize) {
            const chunk = sortedData.slice(i, i + chunkSize);
            chunk.forEach(row => {
                if (hasStructured) {
                    const values = [
                        escape(row.rowNumber || ''), // ADDED: Row number as first column
                        escape(row.inputCountry || row.city || ''),
                        escape(row.englishKW || ''),
                        escape(row.localTone || ''),
                        escape(row.misspell || ''),
                        escape(row.cityKW || ''),
                        escape(row.popularUrl || ''),
                        escape(row.timestamp || '')
                    ];
                    csvRows.push(values.join(','));
                } else {
                    const values = [
                        escape(row.rowNumber || ''), // ADDED: Row number as first column
                        escape(row.city),
                        escape(row.response || ''),
                        escape(row.timestamp || '')
                    ];
                    csvRows.push(values.join(','));
                }
            });
        }
        return csvRows.join('\n');
    }
    
    // Listen for updates from content script
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'updateStatus') {
            status.textContent = request.message;
        } else if (request.action === 'updateProgress') {
            const percentage = (request.current / request.total) * 100;
            progressBar.style.width = percentage + '%';
            
            // Update current city display with loop information
            let cityDisplay = request.currentCity || '-';
            if (request.isLoopCollection) {
                cityDisplay = `Loop ${request.loopIteration}: ${cityDisplay}`;
            }
            currentCity.textContent = cityDisplay;
            
            progress.textContent = `${request.current}/${request.total}`;
        } else if (request.action === 'collectionComplete') {
            isRunning = false;
            runBtn.style.display = 'block';
            runBtn.disabled = false;
            stopBtn.style.display = 'block';
            stopBtn.disabled = true;
            
            // Clear running state from storage
            chrome.storage.local.set({ isRunning: false });
            
            let completeMessage = `Collection complete! Processed ${request.total} cities`;
            if (request.loopIterations && request.loopIterations > 0) {
                completeMessage += ` (${request.loopIterations} loop iterations)`;
            }
            status.textContent = completeMessage;
            
            // Clear collection state
            chrome.storage.local.set({ collectionState: null });
        } else if (request.action === 'autoDownload') {
            // Auto-download triggered by storage quota
            if (request.data && request.data.length > 0) {
                const csv = convertToCSV(request.data);
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                a.download = `ai_studio_auto_backup_${timestamp}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                status.textContent = `Auto-downloaded ${request.count} rows (storage quota management)`;
            }
        } else if (request.action === 'autoDownloadForInput') {
            // Auto-download triggered by duplicate input completion
            if (request.data && request.data.length > 0) {
                const csv = convertToCSV(request.data);
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                // Use the input name as the filename
                a.download = `${request.inputName}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                status.textContent = `Auto-downloaded ${request.count} rows for input "${request.inputName}"`;
            }
        }
    });
    
    // Listen to storage changes to keep count updated live
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.cityData) {
            const newVal = changes.cityData.newValue || [];
            updateStorageCount(newVal.length);
        }
    });
    
    // Load initial data count
    chrome.storage.local.get(['cityData'], function(result) {
        const cityData = result.cityData || [];
        if (cityData.length > 0) {
            status.textContent = `Ready - ${cityData.length} cities already collected`;
        }
        updateStorageCount(cityData.length);
    });

    function updateStorageCount(n) {
        if (storageCount) storageCount.textContent = `Stored rows: ${n}`;
    }
});
