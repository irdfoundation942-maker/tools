// Background script for Keyword Planner Scraper extension

// Listen for extension installation
chrome.runtime.onInstalled.addListener(function(details) {
  console.log("Keyword Planner Scraper extension installed");
  
  // Create context menu for quick access
  chrome.contextMenus.create({
    id: "keyword-scraper",
    title: "Scrape Keywords",
    contexts: ["page"],
    documentUrlPatterns: ["https://ads.google.com/aw/keywordplanner/*"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId === "keyword-scraper") {
    // Open the extension popup
    chrome.action.openPopup();
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "contentScriptLoaded") {
    console.log("Content script loaded in tab:", sender.tab.id);
  }
  
  if (request.action === "dataAvailable") {
    console.log("New data available in tab:", sender.tab.id);
  }
  
  return true; // Keep the message channel open for async response
});

// Handle tab updates to check if we're on the right page
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('ads.google.com/aw/keywordplanner')) {
      // Page is loaded, we can enable the extension
      console.log("Keyword Planner page loaded in tab:", tabId);
      
      // Check if it's the home page
      if (tab.url.includes('/home')) {
        console.log("Keyword Planner home page detected");
      }
      
      // Check if it's the ideas/new page
      if (tab.url.includes('/ideas/new')) {
        console.log("Keyword Planner ideas page detected");
      }
    }
  }
});

// NEW CODE: Handle tab management for automation
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "closeAndReopenTab") {
    // Use the Keyword Planner home URL and prefer the active account (authuser=1)
    // Removing or matching the user's authuser helps avoid landing on the Ads overview page.
    const homeUrl = "https://ads.google.com/aw/keywordplanner/home?ocid=1064115482&euid=660477114&__u=6332839786&uscid=1064115482&__c=9540054218&authuser=1";

    if (sender.tab && sender.tab.id) {
      const tabId = sender.tab.id;

      // Store automation config if continuing
      if (request.continueAutomation) {
        chrome.storage.local.set({
          resumeAutomation: true,
          nextBatchIndex: request.nextBatchIndex,
          automationConfig: request.automationConfig
        });
      }

      // Instead of opening a new tab (which may pick a different account or redirect),
      // update the current tab to the desired Keyword Planner home URL. This preserves
      // the active profile and reduces risk of being redirected to the overview page.
      chrome.tabs.update(tabId, { url: homeUrl }, function(updatedTab) {
        if (chrome.runtime.lastError) {
          console.error('Failed to update tab URL:', chrome.runtime.lastError.message);
          // Fallback: create a new tab if update fails
          chrome.tabs.create({ url: homeUrl }, function(newTab) {
            console.log('Opened new tab as fallback for Keyword Planner home');
            sendResponse({ success: true, newTabId: newTab.id });
          });
        } else {
          console.log('Updated current tab to Keyword Planner home, automation will resume there');
          sendResponse({ success: true, updatedTabId: updatedTab.id });
        }
      });
    }

    return true; // Keep message channel open
  }
});
