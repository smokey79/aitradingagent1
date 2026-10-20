/** Research journal only. Fills and balances belong to Freqtrade's database. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../freqtrade/user_data/research');

function saveSnapshot(snapshot) {
  const dir = path.join(root, 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, snapshot.id + '.json');
  if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(snapshot), { flag: 'wx' });
}

function logDecision(event) {
  fs.mkdirSync(root, { recursive: true });
  fs.appendFileSync(path.join(root, 'decisions.jsonl'), JSON.stringify({
    schemaVersion: 1, recordedAt: new Date().toISOString(), ...event,
  }) + '\n');
}
module.exports = { saveSnapshot, logDecision };
