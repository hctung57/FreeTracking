# Workspace Instructions

This workspace is for a Chrome extension that imports tracking numbers, queries USPS status, and exports results to Excel.

Follow these rules when editing or adding code:

- Prefer Manifest V3 patterns.
- Keep UI logic in `src/app`, automation logic in `src/content`, background orchestration in `src/background`, and reusable helpers in `src/shared`.
- Keep the first implementation simple and incremental.
- Use ASCII by default.
- Preserve existing file and folder names unless a change is necessary.
- When adding batch processing, keep the chunk size explicit and configurable.
- When exporting data, keep the output format stable and easy to map to Excel columns.
