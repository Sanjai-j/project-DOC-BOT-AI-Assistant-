#!/usr/bin/env node
/**
 * Capture README demo screenshots via the Chrome DevTools Protocol.
 * Zero dependencies — Node >= 22 (global fetch + WebSocket).
 *
 *   node scripts/screenshots.mjs
 *
 * Requires the app to be running (API :4000, web :5173) and Chrome or Edge.
 * Output: docs/screenshots/*.png
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const APP = process.env.APP_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:4000';
const DEBUG_PORT = 9333;
const VIEWPORT = { width: 1440, height: 900 };

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

// ─── small CDP client ────────────────────────────────────────────────────────

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const cb of listeners.get(msg.method)) cb(msg.params);
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () =>
      resolve({
        call(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res, rej) => pending.set(mid, { resolve: res, reject: rej }));
        },
        on(method, cb) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(cb);
        },
      })
    );
    ws.addEventListener('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 20000, interval = 250, label = 'condition' } = {}) {
  const t0 = Date.now();
  let lastErr;
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? ` (${lastErr.message})` : ''}`);
}

// ─── browser ─────────────────────────────────────────────────────────────────

async function launchChrome() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return spawnAt(process.env.CHROME_PATH);
    }
    throw new Error('No Chrome/Edge found — set CHROME_PATH');
  }
  return spawnAt(exe);
}

function spawnAt(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'docbot-shots-'));
  const proc = spawn(
    exe,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--no-default-browser-check',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
    { stdio: 'ignore' }
  );
  return { proc, profile };
}

async function connectBrowser(profile) {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error('Chrome DevTools endpoint never came up');
  return connect(version.webSocketDebuggerUrl);
}

// ─── page actions ────────────────────────────────────────────────────────────

async function openPage(cdp, url) {
  // Create a tab over HTTP, then talk to it on its own WebSocket —
  // avoids flattened-session routing quirks entirely.
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.call('Page.enable');
  await page.call('Runtime.enable');
  await page.call('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  return { page, targetId: target.id };
}

async function navigate(page, url) {
  await page.call('Page.navigate', { url });
  await waitFor(
    () =>
      page
        .call('Runtime.evaluate', { expression: 'document.readyState' })
        .then((r) => r.result.value === 'complete'),
    { label: `load ${url}` }
  );
  await sleep(700); // React mount + initial data fetch
}

async function evalJs(page, expression) {
  const r = await page.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval failed');
  }
  return r.result.value;
}

async function shoot(page, name) {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  ✓ ${name.padEnd(26)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

async function login(page, kind, credentials) {
  return evalJs(
    page,
    `(async () => {
      const res = await fetch('${API}/api/auth/${kind}/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(${JSON.stringify(credentials)}),
      });
      if (!res.ok) throw new Error('${kind} login HTTP ' + res.status);
      const data = await res.json();
      localStorage.setItem('docbot_token', data.token);
      localStorage.setItem('docbot_user', JSON.stringify(data.user));
      return data.user.name;
    })()`
  );
}

async function setSession(page, kind, credentials) {
  // Visit the origin first so localStorage applies to the right host.
  await navigate(page, APP);
  const name = await login(page, kind, credentials);
  console.log(`  logged in as ${name} (${kind})`);
}

async function typeAndSend(page, text) {
  await evalJs(
    page,
    `(() => {
      const inp = document.querySelector('input[placeholder="Describe your symptoms…"]');
      if (!inp) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(text)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
  await sleep(150);
  await evalJs(
    page,
    `(() => {
      const btn = [...document.querySelectorAll('form button')].find((b) => b.textContent.trim() === 'Send');
      if (btn) btn.click();
      return !!btn;
    })()`
  );
}

const bubbleCount = (page) =>
  evalJs(page, `document.querySelectorAll('div.whitespace-pre-wrap').length`);

// ─── shots ───────────────────────────────────────────────────────────────────

async function main() {
  for (const [name, url] of [
    ['API', `${API}/api/hospitals/top-rated`],
    ['web app', APP],
  ]) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error(`✗ ${name} not reachable at ${url} (${e.message}).`);
      console.error('  Start it first:  npm run dev');
      process.exit(1);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { proc, profile } = await launchChrome();
  console.log('Chrome up, capturing…');

  try {
    const cdp = await connectBrowser(profile);
    const opened = [];

    // 1. Public landing page (hero)
    {
      const { page, targetId } = await openPage(cdp, `${APP}/`);
      opened.push(targetId);
      await navigate(page, `${APP}/`);
      await waitFor(() => evalJs(page, `document.body.innerText.includes('DocBot')`), {
        label: 'landing render',
      });
      await shoot(page, 'landing.png');
    }

    // 2. How it works (public)
    {
      const { page, targetId } = await openPage(cdp, `${APP}/how-it-works`);
      opened.push(targetId);
      await navigate(page, `${APP}/how-it-works`);
      await waitFor(() => evalJs(page, `document.body.innerText.includes('How DocBot TeleMed works')`), {
        label: 'how-it-works render',
      });
      await shoot(page, 'how-it-works.png');
    }

    // 3. Patient dashboard
    {
      const { page, targetId } = await openPage(cdp, `${APP}/`);
      opened.push(targetId);
      await setSession(page, 'patient', {
        identifier: 'patient@docbot.dev',
        password: 'patient123',
      });
      await navigate(page, `${APP}/patient`);
      await waitFor(() => evalJs(page, `document.body.innerText.length > 400`), {
        label: 'patient dashboard render',
      });
      await sleep(800);
      await shoot(page, 'patient-dashboard.png');
    }

    // 4. DocBot chat — a real two-turn conversation
    {
      const { page, targetId } = await openPage(cdp, `${APP}/`);
      opened.push(targetId);
      await setSession(page, 'patient', {
        identifier: 'patient@docbot.dev',
        password: 'patient123',
      });
      await navigate(page, `${APP}/patient/docbot`);
      await waitFor(
        () => evalJs(page, `!!document.querySelector('input[placeholder="Describe your symptoms…"]')`),
        { label: 'chat input' }
      );

      await typeAndSend(page, 'I have a fever and a sore throat since yesterday');
      await waitFor(() => bubbleCount(page).then((n) => n >= 2), { label: 'first DocBot reply' });
      await sleep(400);

      await typeAndSend(page, 'Also I have a blocked nose and ear pain on one side');
      await waitFor(() => bubbleCount(page).then((n) => n >= 4), { label: 'second DocBot reply' });
      await sleep(600);

      await shoot(page, 'docbot-chat.png');
    }

    // 5. Find doctors
    {
      const { page, targetId } = await openPage(cdp, `${APP}/`);
      opened.push(targetId);
      await navigate(page, `${APP}/find-doctors`);
      await waitFor(
        () => evalJs(page, `document.body.innerText.includes('Dr. ')`),
        { label: 'doctor cards' }
      );
      await sleep(500);
      await shoot(page, 'find-doctors.png');
    }

    // 6. Admin dashboard
    {
      const { page, targetId } = await openPage(cdp, `${APP}/`);
      opened.push(targetId);
      await setSession(page, 'admin', {
        email: 'admin@docbot.dev',
        password: 'ChangeMe!123',
      });
      await navigate(page, `${APP}/admin`);
      await waitFor(() => evalJs(page, `document.body.innerText.length > 400`), {
        label: 'admin dashboard render',
      });
      await sleep(800);
      await shoot(page, 'admin-dashboard.png');
    }

    for (const targetId of opened) {
      try {
        await cdp.call('Target.closeTarget', { targetId });
      } catch {
        /* best effort */
      }
    }
    console.log(`\nAll screenshots in ${path.relative(ROOT, OUT_DIR)}/`);
  } finally {
    // Chrome spawns children; a plain kill leaves them holding profile files.
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      proc.kill();
    }
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
