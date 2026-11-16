/* Delivery settings for this site: infrastructure, not spec content. Loaded by index.html and manager.html.
   Not a secret: the receiver address is public by nature (the page sends to it); the receiver
   enforces its own limits and allowed domains.
   - submitUrl:      the receiver's web app address (Google Apps Script, ends with /exec).
                     Empty = sending is not set up: the form shows no Send button (download and print stay).
   - allowedDomains: email domains the manager page accepts in "Send results to". The receiver checks
                     its own list again (script property ALLOWED_DOMAINS), so keep the two the same.
   - sendTimeoutMs:  optional; how long the form waits for the receiver (default 25000). */
window.SITE_CONFIG = {
  submitUrl: "https://script.google.com/macros/s/AKfycbx8B00ccMAgf3A_7TyZBqLboKYsl6iRyby8rY0Jqrdnklifh0nV6J4VDqHDA72wix0/exec",
  allowedDomains: ["wllmd.com"]
};
