/**
 * UI verification script — run from /home/user/wn-crm-backend/
 * Starts server, intercepts API calls with mock data, takes screenshots.
 * Usage: node verify-ui.js
 */
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');

const JWT_SECRET = 'wn-crm-jwt-secret-2026-change-this-in-production';
const TOKEN = jwt.sign({ userId: 'verify-bot', email: 'verify@test.com' }, JWT_SECRET, { expiresIn: '1h' });

const MOCK_AUTHORS = Array.from({ length: 25 }, (_, i) => ({
  uid: `uid-${String(i).padStart(5,'0')}`,
  name: `Author ${['Singh','Patel','Kumar','Sharma','Rao'][i%5]} ${i}`,
  regnDate: `202${3+(i%3)}-${String((i%12)+1).padStart(2,'0')}-${String((i%28)+1).padStart(2,'0')}`,
  email: `author${i}@example.com`,
  phone: `+9190000${String(i).padStart(5,'0')}`,
  locale: ['en','hi','mr'][i%3],
  aeEmail: `ae${i%3}@example.com`,
  bucketTag: ['A','B','C'][i%3],
  form1MailSent: i%4===0 ? 'YES' : '',
  expressContest: i%2===0,
  sevenDayContest: i%3===0,
  firstContractDate: i%5===0 ? `2024-0${(i%9)+1}-15` : null,
}));

(async () => {
  // Kill any existing server
  try { execSync('pkill -f "node server.js"', { stdio:'ignore' }); } catch(e){}
  await new Promise(r => setTimeout(r, 1000));

  // Start server
  const srv = spawn('node', ['server.js'], {
    cwd: '/home/user/wn-crm-backend',
    stdio: ['ignore','pipe','pipe'],
    env: { ...process.env }
  });
  srv.stdout.on('data', d => process.stdout.write('[server] ' + d));
  await new Promise(r => setTimeout(r, 5000));

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Inject real token before page scripts run
  await page.addInitScript((token) => {
    localStorage.setItem('crm_token', token);
  }, TOKEN);

  // Intercept ALL API calls — return mock data for authors, empty for others
  await page.route('http://localhost:5000/api/**', async route => {
    const url = route.request().url();
    console.log('[intercept]', route.request().method(), url);
    if (url.includes('/api/authors/query')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_AUTHORS, total: MOCK_AUTHORS.length, page: 1, pages: 1 })
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
  });

  await page.goto('http://localhost:5000');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/verify-00-initial.png' });

  // Navigate to Authors tab via nav link
  await page.click('.nav-link:has-text("Authors")');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/verify-01-authors-loaded.png' });

  // Find scrollable container and scroll right
  const scrollContainer = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d =>
      d.scrollWidth > d.clientWidth + 50 && d.querySelector('table')
    );
    if (el) { el.scrollLeft = 500; return el.className; }
    return null;
  });
  console.log('Scroll container class:', scrollContainer);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/verify-02-authors-scrolled.png' });

  // Structural checks
  const checks = await page.evaluate(() => {
    const labelEls = [...document.querySelectorAll('th .th-label')];
    const headers = labelEls.map(el => el.textContent.trim());

    const regMonthIdx = headers.indexOf('Reg. Month');
    const authorIdIdx = headers.indexOf('Author ID');
    const authorNameIdx = headers.indexOf('Author Name');

    const thEls = [...document.querySelectorAll('th')];
    const regMonthTh = thEls.find(th => th.querySelector('.th-label')?.textContent.trim() === 'Reg. Month');

    const hasPinBtn   = regMonthTh ? !!regMonthTh.querySelector('.pin-btn') : null;
    const isSticky    = regMonthTh ? regMonthTh.classList.contains('is-sticky') : null;
    const stickyStyle = regMonthTh ? regMonthTh.style.cssText : null;

    // First data row cells
    const rows = [...document.querySelectorAll('#authors-body tr')];
    const firstRowCells = rows[0] ? [...rows[0].querySelectorAll('td')] : [];
    // col index in headers array = DOM col index - 1 (checkbox col)
    const regMonthCellText = regMonthIdx >= 0 && firstRowCells[regMonthIdx+1]
      ? firstRowCells[regMonthIdx+1].textContent.trim() : null;

    return { headers: headers.slice(0,8), regMonthIdx, authorIdIdx, authorNameIdx,
             hasPinBtn, isSticky, stickyStyle, regMonthCellText, rowCount: rows.length };
  });

  console.log('\n─── Column Checks ───');
  console.log('First 8 headers:', checks.headers);
  console.log(`Author ID index : ${checks.authorIdIdx}  (expect 0)`);
  console.log(`Reg. Month index: ${checks.regMonthIdx}  (expect 1)`);
  console.log(`Author Name idx : ${checks.authorNameIdx}  (expect 2)`);
  console.log(`Has pin button  : ${checks.hasPinBtn}  (expect false)`);
  console.log(`Is sticky       : ${checks.isSticky}  (expect true)`);
  console.log(`Sticky style    : ${checks.stickyStyle}`);
  console.log(`Cell value      : "${checks.regMonthCellText}"  (expect e.g. "Jan' 23")`);
  console.log(`Row count       : ${checks.rowCount}  (expect 25)`);

  const pass = checks.authorIdIdx===0 && checks.regMonthIdx===1 && checks.authorNameIdx===2
    && checks.hasPinBtn===false && checks.isSticky===true
    && /[A-Z][a-z]+'/.test(checks.regMonthCellText||'') && checks.rowCount===25;

  console.log('\n' + (pass ? '✅ PASS — all checks green' : '❌ FAIL — see above'));

  await browser.close();
  srv.kill();

  console.log('\nScreenshots:');
  console.log('  /tmp/verify-00-initial.png');
  console.log('  /tmp/verify-01-authors-loaded.png');
  console.log('  /tmp/verify-02-authors-scrolled.png');
})();
