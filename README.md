# Free Tracking

Free Tracking is a Chrome extension for processing USPS tracking numbers at scale. It supports two workflows: manual entry for quick lookups and file-based import for order sheets that already contain a `TRACKING_ID` column. The extension opens USPS tracking pages in batches, reads the current shipment state, and exports the updated result back to Excel or CSV.

## Key Features

- Process tracking numbers manually or from an uploaded order file.
- Import `.csv`, `.xlsx`, or `.xls` files.
- Read tracking IDs from the `TRACKING_ID` column.
- Write the lookup result back to `TRACKING_STATUS`.
- Handle batch processing with automatic delays between requests.
- Continue processing even when one batch or tracking number fails.
- Export the final result as a CSV or Excel file.
- Use a dedicated controller tab with a modern, simplified UI.

## Requirements

- Google Chrome or a Chromium-based browser.
- Node.js 18 or newer.
- npm.

If you only want to install the extension, you do **not** need npm on your machine. The built extension lives in `dist/`, so you can load the project root directly into Chrome.

## Installation

### Developer setup

These steps are only needed if you plan to modify the source code and rebuild the extension.

### 1. Clone or open the project

Open the project folder in VS Code or your editor of choice.

### 2. Install dependencies

Run the following command in the project root:

```bash
npm install
```

### 3. Build the extension

Create the production-ready files in `dist/`:

```bash
npm run build
```

The build step bundles the background worker, content script, and controller UI, then copies the assets into the `dist/` folder.

### 4. Load the extension into Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the project root folder.
5. Pin the extension if you want quick access from the toolbar.

### 5. Open the controller

Click the extension icon in the toolbar. The extension opens a dedicated controller tab where you can:

- Paste tracking numbers manually.
- Switch to file mode and upload an order file.
- Start the USPS lookup job.
- Download the updated file when processing is complete.

## Usage

### Manual mode

1. Open the controller tab.
2. Select **Manual Tracking**.
3. Paste one tracking number per line.
4. Click **Start**.
5. Wait for processing to complete.
6. Click **Download Excel** to export the results.

### File mode

1. Open the controller tab.
2. Select **Order File**.
3. Upload a CSV or Excel file.
4. Make sure the file contains a `TRACKING_ID` column.
5. Click **Start**.
6. When the job is complete, click **Download Excel**.

## Input File Format

The file should contain a header row and at least one `TRACKING_ID` column. If a `TRACKING_STATUS` column already exists, the extension will update it. If not, the column will be added in the exported file.

Example:

```text
ORDER ID,ORDER CODE,STORE,FULL NAME,TRACKING_ID,TRACKING_STATUS
BF000000EY0R,4088416247,BOB,Nicole Rodriguez,9200190384072908333182,
```

## Project Structure

```text
assets/                Extension icons and logo assets
dist/                  Built extension output
src/app/               Controller page UI
src/background/        Service worker and job orchestration
src/content/           USPS page parser
src/shared/            Shared helpers for tracking and Excel export
tests/                 Sample files and test data
```

## Development Notes

- The extension processes USPS requests in batches.
- A random delay is inserted between batches to reduce request bursts.
- Results are stored per tracking number so one failure does not stop the job.
- The controller UI is built as a dedicated tab, not a popup.

## Rebuild After Changes

If you change any source files, run:

```bash
npm run build
```

The build command generates `dist/`. Reload the unpacked extension from the project root in Chrome.

## End-User Installation Without npm

If you are installing the extension only and do not want to set up a development environment:

1. Open the project root folder that contains the built `dist/` output.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the project root folder.

You can use the extension immediately without running `npm install` or `npm run build`.

## License

No license has been specified for this project.