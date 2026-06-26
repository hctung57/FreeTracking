# Free Tracking

Free Tracking is a Chrome extension for processing USPS tracking numbers at scale. It supports two workflows: manual entry for quick lookups and file-based import for order sheets that already contain a `TRACKING_ID` column. The extension opens USPS tracking pages in batches, reads the current shipment state, and exports the updated result back to Excel or CSV.

## Key Features

- Process tracking numbers manually or from an uploaded order file.
- Import `.csv`, `.xlsx`, or `.xls` files.
- Read tracking IDs from the `TRACKING_ID` column.
- Write the lookup result back to `TRACKING_STATUS`.
- Handle batch processing with automatic delays between requests.
- **Stop** a running job at any time and **continue** it later.
- **Reset** state to clear all results and start fresh.
- Automatic retry with exponential backoff when a batch fails (up to 3 attempts).
- Real-time progress bar with live counters (total, processed, success, errors).
- Countdown timer between batches so you know when the next lookup starts.
- Visual status indicator (idle, running, waiting, done, stopped).
- **Theme toggle** — switch between dark and pink themes.
- Export the final result as a CSV or Excel file.
- Dedicated controller tab with a modern, simplified UI.

## Permissions

The extension requests the following Chrome permissions:

| Permission | Purpose |
|---|---|
| `storage` | Save job state so it survives browser restarts. |
| `tabs` | Open and manage USPS tracking tabs in the background. |
| `scripting` | Inject the content script into USPS pages. |
| `downloads` | Trigger the Excel/CSV file download. |
| `alarms` | Schedule the next batch after the cooldown delay. |
| `https://tools.usps.com/*` | Access USPS tracking pages to read shipment status. |

## Requirements

- Google Chrome or a Chromium-based browser.
- Node.js 18 or newer (development only).
- npm (development only).

If you only want to install the extension, you do **not** need Node.js or npm on your machine. The built extension lives in `dist/`, so you can load the project root directly into Chrome.

## Installation

### Developer setup

These steps are only needed if you plan to modify the source code and rebuild the extension.

#### 1. Clone or open the project

Open the project folder in VS Code or your editor of choice.

#### 2. Install dependencies

Run the following command in the project root:

```bash
npm install
```

#### 3. Build the extension

Create the production-ready files in `dist/`:

```bash
npm run build
```

For development with automatic rebuilds on file changes:

```bash
npm run dev
```

The build step bundles the background worker, content script, and controller UI with [esbuild](https://esbuild.github.io/), then copies the assets into the `dist/` folder.

#### 4. Run tests

```bash
npm test
```

#### 5. Load the extension into Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the project root folder.
5. Pin the extension if you want quick access from the toolbar.

#### 6. Open the controller

Click the extension icon in the toolbar. The extension opens a dedicated controller tab.

## Usage

### Manual mode

1. Open the controller tab.
2. Select **Manual** in the mode switch.
3. Paste one tracking number per line into the textarea.
4. Click the **Play** button (▶) to start the job.
5. Monitor progress in the stats panel — the progress bar and counters update in real time.
6. When the job completes, click the **Download** button (⬇) to export results.
7. Use the **Reset** button (↺) to clear everything and start over.

### File mode

1. Open the controller tab.
2. Select **File** in the mode switch.
3. Upload a CSV or Excel file by clicking the upload zone or dragging a file onto it.
4. Make sure the file contains a `TRACKING_ID` column.
5. Click the **Play** button (▶) to start the job.
6. When the job is complete, click the **Download** button (⬇). The exported file preserves your original columns and adds/updates the `TRACKING_STATUS` column.

### Stopping and continuing a job

- While a job is running, the Play button changes to a **Stop** button (⏹). Click it to pause the job.
- When stopped, the button changes back to **Play**. Click it to continue from where you left off.
- You can stop and continue as many times as you want — the job state is persisted automatically.

### Theme toggle

Click the theme knob in the top-right corner of the header to switch between the dark theme (default) and the pink theme. Your preference is saved and restored on the next launch.

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
scripts/               Build scripts (esbuild bundler)
src/app/               Controller page UI
src/background/        Service worker and job orchestration
src/content/           USPS page parser (content script)
src/shared/            Shared helpers for tracking and Excel export
tests/                 Sample files and test data
manifest.json          Chrome extension manifest (Manifest V3)
```

## Development Notes

- The extension is built on **Manifest V3** and uses ES modules throughout.
- Tracking requests are processed in batches of 35 (configurable via `USPS_BATCH_SIZE`).
- A random delay (5–20 seconds) is inserted between batches to reduce request bursts.
- Failed batches are retried up to 3 times with exponential backoff (2s → 4s → 8s).
- Results are stored per tracking number so one failure does not stop the job.
- Job state is persisted to `chrome.storage.local` and survives browser restarts.
- The controller UI is a dedicated tab, not a popup — this keeps it open during long jobs.

## Rebuild After Changes

If you change any source files, run:

```bash
npm run build
```

The build command regenerates `dist/`. Reload the unpacked extension from the project root in Chrome.

## End-User Installation Without npm

If you only want to install the extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project root folder.

You can use the extension immediately — no `npm install` or `npm run build` required.

## License

No license has been specified for this project.
