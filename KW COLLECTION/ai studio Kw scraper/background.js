// Background script for AI Studio City Collector

// Multi-tab serial processing state
let multiTabState = {
    isActive: false,
    tabIds: [],
    currentTabIndex: 0,
    totalTabs: 0,
    tabsCreated: 0,
    tabAssignments: {}, // {tabId: {startIndex, endIndex, profileIndex, etc.}}
    currentProcessingTab: 0, // Track which tab is currently processing
    serialMode: true // Flag to indicate serial processing mode
};

// Initialize and restore state on startup
(async function() {
    try {
        // Restore multi-tab state from storage
        const state = await chrome.storage.local.get(['multiTabState', 'isRunning']);
        if (state.multiTabState) {
            multiTabState = state.multiTabState;
            console.log('Restored multi-tab state:', multiTabState);
        }
        
        // If we were running but no active multi-tab state, check if we need to restore
        if (state.isRunning && !multiTabState.isActive) {
            console.log('Extension was running but no active multi-tab state, checking for collection state...');
            const collectionState = await chrome.storage.local.get('collectionState');
            if (collectionState.collectionState && collectionState.collectionState.isCollecting) {
                console.log('Collection was in progress, restoring state...');
            }
        }
    } catch (error) {
        console.error('Error restoring background state:', error);
    }
})();

chrome.runtime.onInstalled.addListener(async () => {
    console.log('AI Studio City Collector extension installed');
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStatus' || 
        request.action === 'updateProgress' || 
        request.action === 'collectionComplete') {
        chrome.runtime.sendMessage(request);
    } else if (request.action === 'createNewChatTab') {
        console.log('Received request to create a new chat tab (tab will remain open).');
        sendResponse({success: true});
    } else if (request.action === 'initiateMultiTabCollection') {
        initiateMultiTabCollection(request);
        sendResponse({success: true});
    } else if (request.action === 'firstTaskSubmitted') {
        // In serial mode, we don't create the next tab until the current tab is done
        console.log(`Tab ${sender.tab.id} submitted first task`);
        sendResponse({success: true});
    } else if (request.action === 'tabProcessingComplete') {
        // Tab has completed all its assigned keywords, move to next tab
        console.log(`Tab ${sender.tab.id} completed all its assigned keywords`);
        if (multiTabState.isActive && multiTabState.serialMode) {
            moveToNextTab();
        }
        sendResponse({success: true});
    } else if (request.action === 'taskCompleted') {
        // In serial mode, we don't cycle tabs on each task completion
        // We only move to the next tab when all tasks in current tab are complete
        console.log(`Tab ${sender.tab.id} completed a task`);
        sendResponse({success: true});
    } else if (request.action === 'stopMultiTabCollection') {
        // Stop all multi-tab operations
        console.log('Stopping multi-tab collection');
        multiTabState.isActive = false;
        chrome.storage.local.set({ multiTabState: null, isRunning: false });
        sendResponse({success: true});
    }
    return true;
});

// Handle tab updates to check if we're on AI Studio
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (tab.url.includes('aistudio.google.com')) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            }).catch(err => {
                console.log('Content script injection skipped:', err.message);
            });
            
            const state = await chrome.storage.local.get(['collectionState']);
            if (state.collectionState && state.collectionState.isCollecting) {
                console.log('Collection in progress, resuming if needed');
            }
        }
    }
});

async function initiateMultiTabCollection(config) {
    const { numberOfTabs, totalKeywords, repetitionCount, startRow, currentProfileUrl, keywordsPerPrompt } = config;
    
    console.log(`Initiating serial multi-tab collection: ${numberOfTabs} tabs, ${totalKeywords} keywords, ${keywordsPerPrompt} keywords per prompt`);
    
    // Validate inputs
    if (!numberOfTabs || numberOfTabs < 1) {
        console.error('Invalid number of tabs:', numberOfTabs);
        return;
    }
    
    if (!totalKeywords || totalKeywords < 1) {
        console.error('Invalid total keywords:', totalKeywords);
        return;
    }
    
    // Reset multi-tab state
    multiTabState = {
        isActive: true,
        tabIds: [],
        currentTabIndex: 0,
        totalTabs: numberOfTabs,
        tabsCreated: 0,
        tabAssignments: {},
        currentProcessingTab: 0,
        serialMode: true,
        totalKeywords: totalKeywords,
        currentProgress: 0,
        startTime: new Date().toISOString()
    };
    
    // Save multi-tab state to storage
    await chrome.storage.local.set({ multiTabState: multiTabState });
    
    // Calculate how many keywords per tab for serial distribution
    const keywordsPerTab = Math.ceil(totalKeywords / numberOfTabs);
    
    // Extract profile index from current URL
    let baseProfileIndex = 0;
    if (currentProfileUrl) {
        const match = currentProfileUrl.match(/\/u\/(\d+)\//);
        if (match) {
            baseProfileIndex = parseInt(match[1]);
        }
    }
    
    // Get the currently active tab (this will be Tab 1)
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!currentTab || !currentTab.url.includes('aistudio.google.com')) {
        console.error('Current tab is not AI Studio. Cannot start multi-tab collection.');
        return;
    }
    
    // Assign Tab 1 (current tab) its keyword range - serial distribution
    const tab1StartIndex = startRow - 1;
    const tab1EndIndex = Math.min(tab1StartIndex + keywordsPerTab, totalKeywords);
    
    // Ensure we have valid indices
    if (tab1StartIndex < 0 || tab1EndIndex <= 0 || tab1StartIndex >= totalKeywords) {
        console.error('Invalid start/end indices for Tab 1:', { tab1StartIndex, tab1EndIndex, totalKeywords });
        return;
    }
    
    multiTabState.tabIds.push(currentTab.id);
    multiTabState.tabsCreated = 1;
    multiTabState.tabAssignments[currentTab.id] = {
        startIndex: tab1StartIndex,
        endIndex: tab1EndIndex,
        profileIndex: baseProfileIndex,
        repetitionCount: repetitionCount,
        keywordsPerPrompt: keywordsPerPrompt,
        isMultiTabMode: true,
        isSerialMode: true, // Add flag to indicate serial mode
        tabNumber: 1
    };
    
    // Update saved state
    await chrome.storage.local.set({ multiTabState: multiTabState });
    
    console.log(`Tab 1 (current tab ${currentTab.id}): keywords ${tab1StartIndex + 1}-${tab1EndIndex}`);
    
    // Pre-calculate assignments for all tabs - serial distribution
    for (let i = 1; i < numberOfTabs; i++) {
        // Calculate serial start and end indices
        const startIndex = tab1StartIndex + (i * keywordsPerTab);
        const endIndex = Math.min(startIndex + keywordsPerTab, totalKeywords);
        
        if (startIndex >= totalKeywords) break;
        
        // Ensure we have valid indices
        if (startIndex < 0 || endIndex <= 0 || startIndex >= totalKeywords) {
            console.warn(`Skipping Tab ${i + 1} due to invalid indices:`, { startIndex, endIndex, totalKeywords });
            continue;
        }
        
        multiTabState.tabAssignments[`pending_${i}`] = {
            startIndex: startIndex,
            endIndex: endIndex,
            profileIndex: baseProfileIndex,
            repetitionCount: repetitionCount,
            keywordsPerPrompt: keywordsPerPrompt,
            isMultiTabMode: true,
            isSerialMode: true, // Add flag to indicate serial mode
            tabNumber: i + 1,
            url: baseProfileIndex > 0 
                ? `https://aistudio.google.com/u/${baseProfileIndex}/prompts/new_chat`
                : `https://aistudio.google.com/prompts/new_chat`
        };
        
        console.log(`Tab ${i + 1} (pending): keywords ${startIndex + 1}-${endIndex}`);
    }
    
    // Update saved state with all assignments
    await chrome.storage.local.set({ multiTabState: multiTabState });
    
    // Start processing on Tab 1
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
        await chrome.tabs.sendMessage(currentTab.id, {
            action: 'startCollection',
            startIndex: tab1StartIndex,
            endIndex: tab1EndIndex,
            profileIndex: baseProfileIndex,
            repetitionCount: repetitionCount,
            keywordsPerPrompt: keywordsPerPrompt,
            isMultiTabMode: true,
            isSerialMode: true, // Add flag to indicate serial mode
            tabNumber: 1,
            totalTabs: numberOfTabs
        });
        
        console.log(`Started processing on Tab 1 (${currentTab.id})`);
    } catch (err) {
        console.error(`Failed to start Tab 1:`, err);
    }
}

async function moveToNextTab() {
    if (!multiTabState.isActive) return;
    
    // Check if we've processed all tabs
    if (multiTabState.currentProcessingTab >= multiTabState.totalTabs - 1) {
        console.log('All tabs have completed processing. Collection complete.');
        multiTabState.isActive = false;
        await chrome.storage.local.set({ multiTabState: null, isRunning: false });
        return;
    }
    
    // Move to the next tab
    multiTabState.currentProcessingTab++;
    const nextTabNumber = multiTabState.currentProcessingTab + 1; // +1 because currentProcessingTab is 0-based
    const pendingKey = `pending_${multiTabState.currentProcessingTab}`;
    const assignment = multiTabState.tabAssignments[pendingKey];
    
    if (!assignment) {
        console.log('No more tabs to process. Collection complete.');
        multiTabState.isActive = false;
        await chrome.storage.local.set({ multiTabState: null, isRunning: false });
        return;
    }
    
    console.log(`Creating and activating Tab ${nextTabNumber} for serial processing...`);
    
    // Create the next tab
    chrome.tabs.create({ url: assignment.url, active: true }, async (newTab) => {
        console.log(`Created Tab ${nextTabNumber} (ID: ${newTab.id}): keywords ${assignment.startIndex + 1}-${assignment.endIndex}`);
        
        // Update state
        multiTabState.tabIds.push(newTab.id);
        multiTabState.tabAssignments[newTab.id] = { ...assignment };
        delete multiTabState.tabAssignments[pendingKey];
        multiTabState.tabsCreated++;
        
        // Save updated state
        await chrome.storage.local.set({ multiTabState: multiTabState });
        
        // Wait for tab to load
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                
                setTimeout(async () => {
                    try {
                        await chrome.tabs.sendMessage(newTab.id, {
                            action: 'startCollection',
                            startIndex: assignment.startIndex,
                            endIndex: assignment.endIndex,
                            profileIndex: assignment.profileIndex,
                            repetitionCount: assignment.repetitionCount,
                            keywordsPerPrompt: assignment.keywordsPerPrompt,
                            isMultiTabMode: true,
                            isSerialMode: true, // Add flag to indicate serial mode
                            tabNumber: nextTabNumber,
                            totalTabs: multiTabState.totalTabs
                        });
                        
                        console.log(`Started processing on Tab ${nextTabNumber} (${newTab.id})`);
                    } catch (err) {
                        console.error(`Failed to start Tab ${nextTabNumber}:`, err);
                    }
                }, 2000);
            }
        });
    });
}