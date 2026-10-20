/**
 * Paper-only contextual bandit for ranking strategy hypotheses from closed outcomes.
 * It never executes or changes a trading signal. Rewards must be realized paper-trade R.
 */
const fs = require('fs');

function readOutcomes(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row.strategy === 'string' && typeof row.regime === 'string' &&
          Number.isFinite(Number(row.rewardR)) && row.closed === true) rows.push(row);
    } catch (_) { /* Ignore malformed lines; the paper log remains append-only. */ }
  }
  return rows;
}

function recommendPaperStrategy(regime, options = {}) {
  const filePath = options.filePath || process.env.PAPER_RL_OUTCOMES_PATH ||
    'data/prediction/paper_outcomes.jsonl';
  const strategies = (options.strategies || process.env.PAPER_RL_STRATEGIES ||
    'consensus,trend_follow,mean_reversion').split(',').map((s) => s.trim()).filter(Boolean);
  const minimum = Math.max(1, Number(options.minimumPerStrategy ||
    process.env.PAPER_RL_MIN_OUTCOMES || 20));
  const rows = readOutcomes(filePath).filter((row) => row.regime === regime &&
    strategies.includes(row.strategy));
  const arms = strategies.map((strategy) => {
    const rewards = rows.filter((row) => row.strategy === strategy).map((row) => Number(row.rewardR));
    const avg = rewards.length ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null;
    return { strategy, samples: rewards.length, meanRewardR: avg === null ? null : Number(avg.toFixed(4)) };
  });
  const ready = arms.filter((arm) => arm.samples >= minimum);
  if (!ready.length) {
    return { status: 'collecting_paper_outcomes', regime, requiredPerStrategy: minimum, arms };
  }
  // UCB1 exploration bonus ranks experiments. It has no access to live order controls.
  const total = ready.reduce((n, arm) => n + arm.samples, 0);
  const ranked = ready.map((arm) => ({
    ...arm,
    ucbScore: arm.meanRewardR + Math.sqrt(2 * Math.log(Math.max(2, total)) / arm.samples),
  })).sort((a, b) => b.ucbScore - a.ucbScore);
  return {
    status: 'paper_recommendation_only',
    regime,
    strategy: ranked[0].strategy,
    arms,
    note: 'UCB ranking uses closed paper outcomes only; it does not change consensus or execute trades.',
  };
}

module.exports = { readOutcomes, recommendPaperStrategy };
