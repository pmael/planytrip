// Does the POST to Trip Manager for the content script. A page's own requests are bound by the page's CORS rules; an
// extension's service worker, with `host_permissions` for localhost:3000, is not. Only this extension's own content
// script may ask for it, and it only ever talks to the local app.
const ENDPOINT = 'http://localhost:3000/api/price-observations';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'trip-manager:import' || sender.id !== chrome.runtime.id) return false;

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message.payload),
  })
    .then(async (response) => {
      let body = null;
      try {
        body = await response.json();
      } catch {
        // An answer that is not JSON: the status says enough
      }
      sendResponse({ ok: response.ok, status: response.status, body });
    })
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  // The answer comes later
  return true;
});
