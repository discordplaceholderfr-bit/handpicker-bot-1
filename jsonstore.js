// Shared JSON persistence helpers.
//
// writeJson does an ATOMIC write: it writes to a temp file then renames it over
// the target. On POSIX (Railway) rename is atomic, so a crash mid-write can
// never leave a half-written / corrupted JSON file. Windows rename throws if the
// target exists, so there we fall back to a direct overwrite (fine for
// single-instance local dev).
const fs   = require('node:fs');
const path = require('node:path');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  const tmp  = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, json);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      fs.writeFileSync(file, json);          // Windows: overwrite in place
      fs.rmSync(tmp, { force: true });
    } else {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
}

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { writeJson, readJson };
