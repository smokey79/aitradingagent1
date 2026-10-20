/** Read-only project checks. Never prints environment values or starts a service. */
const fs = require('fs');
const path = require('path');

function checkProject(root = path.join(__dirname, '..')) {
  const checks = [];
  function record(name, fn) {
    try { checks.push({ name, ok: !!fn() }); }
    catch (_) { checks.push({ name, ok: false }); }
  }
  let execution, policy;
  record('execution_config_readable', () => {
    execution = JSON.parse(fs.readFileSync(path.join(root, 'freqtrade/user_data/config.json'), 'utf8'));
    return true;
  });
  record('dry_run_enabled', () => execution.dry_run === true);
  record('spot_only', () => execution.trading_mode === 'spot');
  record('capital_cap', () => execution.dry_run_wallet === 250 &&
    execution.stake_amount <= 25 && execution.max_open_trades === 1);
  record('baseline_selected', () => execution.strategy === 'PriceOnlyChampion');
  record('low_cost_policy', () => {
    policy = JSON.parse(fs.readFileSync(path.join(root, 'config/lowCostPolicy.json'), 'utf8'));
    return policy.paidAiEnabled === false && policy.maxLocalReviewsPerUtcDay <= 4;
  });
  record('baseline_strategy_present', () => fs.existsSync(path.join(root,
    'freqtrade/user_data/strategies/PriceOnlyChampion.py')));
  record('node_version', () => Number(process.versions.node.split('.')[0]) >= 20);
  for (const dependency of ['axios','ccxt','dotenv','node-cron','@langchain/langgraph']) {
    record('installed:' + dependency, () => !!require.resolve(dependency, {paths:[root]}));
  }
  return { ok: checks.every((c) => c.ok), checks,
    note: 'File/dependency checks only. Docker, Python strategies, APIs, models and fills require runtime validation.' };
}

if (require.main === module) {
  const result = checkProject();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
module.exports = { checkProject };
