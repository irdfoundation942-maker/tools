chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractDomains") {
    const domains = extractDomainsFromPage();
    sendResponse({ domains: domains });
  } else if (request.action === "ping") {
    sendResponse({ ready: true });
  }
});

function extractDomainsFromPage() {
  const urls = new Set();
  const mainResultLinks = document.querySelectorAll('a[jsname="UWckNb"]');
  mainResultLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (href && href.startsWith("http")) {
      try {
        const url = new URL(href);
        if (!url.hostname.includes("google.") && url.hostname.length > 0) {
          urls.add(href);
        }
      } catch (e) {}
    }
  });
  if (urls.size === 0) {
    const selectors = [
      "div#search h3 a[href]",
      "div.g a[href]",
      "div[data-ved] h3 a[href]",
      ".yuRUbf a[href]",
    ];
    selectors.forEach((selector) => {
      const links = document.querySelectorAll(selector);
      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (href && href.startsWith("http")) {
          try {
            const url = new URL(href);
            if (!url.hostname.includes("google.") && url.hostname.length > 0) {
              urls.add(href);
            }
          } catch (e) {}
        }
      });
    });
  }
  return Array.from(urls);
}
