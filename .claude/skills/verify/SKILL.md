# Verify — wn-crm-backend

Visual UI verification before any UI commit.

## Setup
- Server: `node server.js` on port 5000
- Browser: Playwright with Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- playwright installed in project: `node_modules/playwright`
- Run script from project root: `node verify-ui.js`

## How it works
1. Spawns `node server.js` internally
2. Generates a real JWT using the secret from `.env` (`wn-crm-jwt-secret-2026-change-this-in-production`)
3. Injects token via `page.addInitScript` so app auto-logs in
4. Intercepts all `http://localhost:5000/api/**` requests via `page.route()` and returns mock data (no real MongoDB needed)
5. Navigates to the tab under test, takes screenshots, runs structural checks
6. Screenshots saved to `/tmp/verify-*.png`

## What to check for Authors tab
- Columns: Author ID (frozen), Reg. Month (frozen, no pin button), Author Name, ...
- Reg. Month format: `mmm' yy` (e.g. `Jan' 25`)
- Scroll right: Author ID and Reg. Month must remain visible
- Express Contest / 7 Day Contest: render as checkboxes

## Scrollable container
CSS class: `table-scroll` — found via:
```js
[...document.querySelectorAll('div')].find(d => d.scrollWidth > d.clientWidth + 50 && d.querySelector('table'))
```

## Key gotchas
- `text=Authors` selector matches the login `<h1>` — use `.nav-link:has-text("Authors")` instead
- Row count includes 2 extra rows (sticky header + filter row) — data rows = rowCount - 2
- The `.th-label` spans don't include the checkbox column header
- `_regMonth` is a virtual field computed client-side in `loadAuthorsPage` from `regnDate`
