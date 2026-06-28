#!/usr/bin/env node
/**
 * smoke-test.js — CRM end-to-end smoke test
 *
 * Usage:
 *   node smoke-test.js [BASE_URL] [EMAIL] [PASSWORD]
 *
 * Defaults:
 *   BASE_URL  = http://localhost:5000
 *   EMAIL     = smoke@test.com
 *   PASSWORD  = SmokeTest123!
 *
 * The script self-registers a test user if it doesn't exist, runs all checks,
 * then cleans up every record it created. Exit code 0 = all passed, 1 = any failed.
 */

const BASE   = process.argv[2] || 'http://localhost:5000';
const EMAIL  = process.argv[3] || 'smoke@test.com';
const PASS   = process.argv[4] || 'SmokeTest123!';

// ─── Tiny test harness ────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? '  →  ' + detail : ''}`);
    failed++;
    failures.push(label);
  }
}

async function section(title, fn) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  try { await fn(); }
  catch (e) { ok(`${title} (no unhandled exception)`, false, e.message); }
}

async function api(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

// ─── Test data (prefixed to avoid collisions) ─────────────────────────────────

const TS       = Date.now();
const A_UID    = `smoke-author-${TS}`;
const A_UID2   = `smoke-author2-${TS}`;
const B_ID     = `smoke-book-${TS}`;
const B_ID2    = `smoke-book2-${TS}`;

// ─── Run ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nCRM Smoke Test  →  ${BASE}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // ── 1. Health ──────────────────────────────────────────────────────────────
  await section('Health check', async () => {
    const { status, body } = await api('/api/health');
    ok('GET /api/health returns 200', status === 200, `got ${status}`);
    ok('health body has status field', body.status !== undefined, JSON.stringify(body));
  });

  // ── 2. Auth — unauthenticated guards ──────────────────────────────────────
  await section('Auth — unauthenticated requests rejected', async () => {
    for (const path of ['/api/authors', '/api/books', '/api/stats', '/api/backups']) {
      const { status } = await api(path);
      ok(`GET ${path} without token → 401`, status === 401, `got ${status}`);
    }
  });

  // ── 3. Register / Login ───────────────────────────────────────────────────
  let token;
  await section('Auth — register & login', async () => {
    // Register (may already exist — that's fine)
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASS })
    });
    ok('POST /api/auth/register → 201 or 400 (exists)', [201, 400].includes(reg.status), `got ${reg.status}`);

    // Login
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASS })
    });
    ok('POST /api/auth/login → 200', login.status === 200, `got ${login.status}`);
    ok('login response has token', typeof login.body.token === 'string', JSON.stringify(login.body));
    token = login.body.token;

    // Bad password
    const bad = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: 'wrong-password' })
    });
    ok('Login with wrong password → 401', bad.status === 401, `got ${bad.status}`);

    // Invalid token
    const bogus = await api('/api/authors', {}, 'bogus-token');
    ok('Invalid token → 401', bogus.status === 401, `got ${bogus.status}`);
  });

  if (!token) {
    console.error('\nCannot continue — failed to obtain auth token.');
    process.exit(1);
  }

  // ── 4. Stats ───────────────────────────────────────────────────────────────
  await section('Stats', async () => {
    const { status, body } = await api('/api/stats', {}, token);
    ok('GET /api/stats → 200', status === 200, `got ${status}`);
    ok('stats has authors count', typeof body.authors === 'number', JSON.stringify(body));
    ok('stats has books count', typeof body.books === 'number', JSON.stringify(body));
  });

  // ── 5. Authors — list ─────────────────────────────────────────────────────
  await section('Authors — list', async () => {
    const { status, body } = await api('/api/authors?limit=10', {}, token);
    ok('GET /api/authors → 200', status === 200, `got ${status}`);
    ok('response is array', Array.isArray(body), typeof body);
    // No record should have a blank uid
    const blankUid = (body || []).filter(a => !a.uid);
    ok('No authors with blank uid in results', blankUid.length === 0, `${blankUid.length} blank-uid records found`);
  });

  // ── 6. Author import — insert ─────────────────────────────────────────────
  await section('Authors — import (insert)', async () => {
    const authors = [
      { uid: A_UID,  name: 'Smoke Author One', email: 'smoke1@test.com', locale: 'IN' },
      { uid: A_UID2, name: 'Smoke Author Two', email: 'smoke2@test.com', locale: 'US' },
    ];
    const { status, body } = await api('/api/import/authors', {
      method: 'POST',
      body: JSON.stringify({ authors })
    }, token);
    ok('POST /api/import/authors → 200', status === 200, `got ${status}`);
    ok('inserted = 2', body.inserted === 2, `inserted=${body.inserted} updated=${body.updated} skipped=${body.skipped}`);
    ok('skipped = 0', body.skipped === 0, `skipped=${body.skipped} reasons=${JSON.stringify(body.skippedReasons)}`);
    ok('response has importId', typeof body.importId === 'string', JSON.stringify(body));
  });

  // ── 7. Author import — no-blank-overwrite rule ────────────────────────────
  await section('Authors — import (no blank overwrite)', async () => {
    const authors = [{ uid: A_UID, name: '', email: null, locale: undefined }];
    const { status, body } = await api('/api/import/authors', {
      method: 'POST',
      body: JSON.stringify({ authors })
    }, token);
    ok('Re-import with blanks → 200', status === 200, `got ${status}`);
    // Fetch the record and verify name was NOT blanked
    const { body: fetched } = await api(`/api/authors/${A_UID}`, {}, token);
    ok('Existing name not overwritten by blank', fetched.name === 'Smoke Author One', `name=${fetched.name}`);
  });

  // ── 8. Author import — error value reject ─────────────────────────────────
  await section('Authors — import (error value reject)', async () => {
    const BAD_VALS = ['N/A', '#ERROR', '#REF!', 'null', 'undefined'];
    for (const bad of BAD_VALS) {
      const { status } = await api('/api/import/authors', {
        method: 'POST',
        body: JSON.stringify({ authors: [{ uid: A_UID, name: bad }] })
      }, token);
      const { body: fetched } = await api(`/api/authors/${A_UID}`, {}, token);
      ok(`"${bad}" does not overwrite name`, fetched.name === 'Smoke Author One', `name=${fetched.name} after sending "${bad}"`);
    }
  });

  // ── 9. Author import — missing uid rejected ───────────────────────────────
  await section('Authors — import (missing uid skipped)', async () => {
    const { status, body } = await api('/api/import/authors', {
      method: 'POST',
      body: JSON.stringify({ authors: [{ name: 'No UID Author' }] })
    }, token);
    ok('Record without uid → skipped', body.skipped === 1, `skipped=${body.skipped}`);
    ok('Skipped reason mentions missing ID', body.skippedReasons?.[0]?.reason?.toLowerCase().includes('id'), JSON.stringify(body.skippedReasons));
  });

  // ── 10. Author — get by id ────────────────────────────────────────────────
  await section('Authors — get by id', async () => {
    const { status, body } = await api(`/api/authors/${A_UID}`, {}, token);
    ok('GET /api/authors/:id → 200', status === 200, `got ${status}`);
    ok('uid matches', body.uid === A_UID, `uid=${body.uid}`);
    ok('has rollup fields', typeof body.booksCreated === 'number', `booksCreated=${body.booksCreated}`);
  });

  // ── 11. Author — update ───────────────────────────────────────────────────
  await section('Authors — update', async () => {
    const { status, body } = await api(`/api/authors/${A_UID}`, {
      method: 'PUT',
      body: JSON.stringify({ locale: 'GB' })
    }, token);
    ok('PUT /api/authors/:id → 200', status === 200, `got ${status}`);
    const { body: fetched } = await api(`/api/authors/${A_UID}`, {}, token);
    ok('locale updated to GB', fetched.locale === 'GB', `locale=${fetched.locale}`);
  });

  // ── 12. Books — import (insert) ───────────────────────────────────────────
  await section('Books — import (insert)', async () => {
    const books = [
      { id: B_ID,  authorId: A_UID, title: 'Smoke Book One', status: 'Published' },
      { id: B_ID2, authorId: A_UID, title: 'Smoke Book Two', status: 'Unpublished' },
    ];
    const { status, body } = await api('/api/import/books', {
      method: 'POST',
      body: JSON.stringify({ books })
    }, token);
    ok('POST /api/import/books → 200', status === 200, `got ${status}`);
    ok('inserted = 2', body.inserted === 2, `inserted=${body.inserted} updated=${body.updated} skipped=${body.skipped}`);
    ok('skipped = 0', body.skipped === 0, JSON.stringify(body.skippedReasons));
  });

  // ── 13. Books — list ──────────────────────────────────────────────────────
  await section('Books — list', async () => {
    const { status, body } = await api(`/api/books?limit=10`, {}, token);
    ok('GET /api/books → 200', status === 200, `got ${status}`);
    ok('response is array', Array.isArray(body), typeof body);
  });

  // ── 14. Books — get by id ─────────────────────────────────────────────────
  await section('Books — get by id', async () => {
    const { status, body } = await api(`/api/books/${B_ID}`, {}, token);
    ok('GET /api/books/:id → 200', status === 200, `got ${status}`);
    ok('id matches', body.id === B_ID, `id=${body.id}`);
    ok('authorId matches', body.authorId === A_UID, `authorId=${body.authorId}`);
    ok('title matches', body.title === 'Smoke Book One', `title=${body.title}`);
  });

  // ── 15. Books — no blank overwrite ────────────────────────────────────────
  await section('Books — import (no blank overwrite)', async () => {
    await api('/api/import/books', {
      method: 'POST',
      body: JSON.stringify({ books: [{ id: B_ID, title: '', status: 'N/A' }] })
    }, token);
    const { body: fetched } = await api(`/api/books/${B_ID}`, {}, token);
    ok('Book title not overwritten by blank', fetched.title === 'Smoke Book One', `title=${fetched.title}`);
    ok('Book status not overwritten by N/A', fetched.status === 'Published', `status=${fetched.status}`);
  });

  // ── 16. Books — missing id skipped ───────────────────────────────────────
  await section('Books — import (missing id skipped)', async () => {
    const { body } = await api('/api/import/books', {
      method: 'POST',
      body: JSON.stringify({ books: [{ authorId: A_UID, title: 'No ID Book' }] })
    }, token);
    ok('Book without id → skipped', body.skipped === 1, `skipped=${body.skipped}`);
  });

  // ── 17. Rollup fields on author ───────────────────────────────────────────
  await section('Authors — rollup fields reflect linked books', async () => {
    const { body } = await api(`/api/authors/${A_UID}`, {}, token);
    ok('booksCreated = 2', body.booksCreated === 2, `booksCreated=${body.booksCreated}`);
  });

  // ── 18. Backups ───────────────────────────────────────────────────────────
  await section('Backups — list', async () => {
    const { status, body } = await api('/api/backups', {}, token);
    ok('GET /api/backups → 200', status === 200, `got ${status}`);
    ok('response is array', Array.isArray(body), typeof body);
  });

  // ── 19. Book update ───────────────────────────────────────────────────────
  await section('Books — update', async () => {
    const { status } = await api(`/api/books/${B_ID}`, {
      method: 'PUT',
      body: JSON.stringify({ pubWC: 15000 })
    }, token);
    ok('PUT /api/books/:id → 200', status === 200, `got ${status}`);
    const { body: fetched } = await api(`/api/books/${B_ID}`, {}, token);
    ok('pubWC updated', fetched.pubWC === 15000, `pubWC=${fetched.pubWC}`);
  });

  // ── 20. Cleanup ───────────────────────────────────────────────────────────
  await section('Cleanup — delete test records', async () => {
    for (const id of [B_ID, B_ID2]) {
      const { status } = await api(`/api/books/${id}`, { method: 'DELETE' }, token);
      ok(`DELETE /api/books/${id} → 200`, status === 200, `got ${status}`);
    }
    for (const id of [A_UID, A_UID2]) {
      const { status } = await api(`/api/authors/${id}`, { method: 'DELETE' }, token);
      ok(`DELETE /api/authors/${id} → 200`, status === 200, `got ${status}`);
    }
    // Verify they're gone
    const { status: s1 } = await api(`/api/authors/${A_UID}`, {}, token);
    ok('Deleted author returns 404', s1 === 404, `got ${s1}`);
    const { status: s2 } = await api(`/api/books/${B_ID}`, {}, token);
    ok('Deleted book returns 404', s2 === 404, `got ${s2}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
  if (failures.length) {
    console.log(`\n  Failed checks:`);
    failures.forEach(f => console.log(`    • ${f}`));
  }
  console.log(`${'═'.repeat(64)}\n`);

  process.exit(failed > 0 ? 1 : 0);
})();
