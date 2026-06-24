---
description: Chrome extension implementation guidance for tracking lookup and Excel export work
applyTo: "src/**/*.{ts,tsx,js,jsx,json},manifest.json,*.md"
---

Use this guidance when working on the tracking extension.

- Put USPS page interaction in content scripts, not in the popup.
- Use the background service worker to coordinate queues, retries, and tab lifecycle.
- Keep popup code focused on collecting input and showing progress.
- Normalize tracking input by trimming whitespace, removing empty lines, and deduplicating values before processing.
- Process tracking numbers in small batches so failures can be isolated and retries stay bounded.
- Store intermediate results in a predictable structure with fields for tracking number, status, timestamp, and error message.
- Prefer simple module boundaries that make it easy to later add CSV or Excel export.
