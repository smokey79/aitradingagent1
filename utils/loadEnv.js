/**
 * Loads ALL API keys and settings from master.env.
 * Lookup order: MASTER_ENV_PATH env var -> <repo>/master.env -> <repo>/../master.env
 * Existing process env vars are never overridden.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const candidates = [
  process.env.MASTER_ENV_PATH,
  path.join(__dirname, '..', 'master.env'),
  path.join(__dirname, '..', '..', 'master.env'),
].filter(Boolean);

const found = candidates.find(p => fs.existsSync(p));

if (found) {
  dotenv.config({ path: found });
} else {
  console.error(`[env] master.env not found. Looked in:\n  ${candidates.join('\n  ')}\nPut master.env in the project folder or set MASTER_ENV_PATH.`);
}

module.exports = { masterEnvPath: found || null };
