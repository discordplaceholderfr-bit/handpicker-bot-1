// Single-instance lock.
//
// The bot keeps game/leaderboard/watcher state in memory and reacts to Discord
// events. If two copies run at once — e.g. during a Railway redeploy where the
// new instance boots before the old one exits — they can double-count poll
// reactions, post a handpick list twice, or assign team roles twice. This lock
// guarantees only ONE instance is ever connected to the gateway: call acquire()
// BEFORE client.login(). A booting instance waits for the previous one to
// release the lock (it does so on SIGTERM during deploys), then takes over. A
// crashed instance leaves a stale lock that is reclaimed once its heartbeat
// goes quiet.
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const dataDir  = process.env.DATA_DIR || path.join(__dirname, 'data');
const lockFile = path.join(dataDir, 'instance.lock');

const HEARTBEAT_MS = 10_000;  // how often the holder refreshes the lock
const STALE_MS     = 30_000;  // no heartbeat for this long ⇒ holder is dead
const WAIT_STEP_MS = 3_000;   // poll interval while waiting for a live holder
const MAX_WAIT_MS  = 90_000;  // give up waiting and take over (safety net)

const id = `${os.hostname()}:${process.pid}:${Date.now()}`;
let heartbeatTimer = null;
let released = false;

function readLock() {
  try { return JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { return null; }
}

function writeLock() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ id, heartbeat: Date.now() }));
}

// A lock held by someone else whose heartbeat is still fresh
function heldByOther(lock) {
  return lock && lock.id !== id && (Date.now() - lock.heartbeat) < STALE_MS;
}

async function acquire() {
  const started = Date.now();
  while (heldByOther(readLock())) {
    if (Date.now() - started > MAX_WAIT_MS) {
      console.warn(`[lock] still held after ${Math.round(MAX_WAIT_MS / 1000)}s — taking over anyway.`);
      break;
    }
    console.log('[lock] another instance is active — waiting for it to exit before connecting…');
    await new Promise(r => setTimeout(r, WAIT_STEP_MS));
  }

  writeLock();
  heartbeatTimer = setInterval(() => {
    try { writeLock(); } catch (err) { console.error('[lock] heartbeat failed:', err.message); }
  }, HEARTBEAT_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();

  process.once('SIGINT',  () => { release(); process.exit(0); });
  process.once('SIGTERM', () => { release(); process.exit(0); });
  process.once('exit', release);

  console.log('[lock] acquired — this is the active instance.');
}

function release() {
  if (released) return;
  released = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  const lock = readLock();
  if (lock && lock.id === id) {
    try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
  }
}

module.exports = { acquire, release };
