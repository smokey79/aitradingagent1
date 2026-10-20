/** Pure review allowance plus fail-closed persistent reservation. */
const fs = require('fs');
const path = require('path');
const policy = require('../config/lowCostPolicy.json');

function reviewAllowance(state, now, settings = policy) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = state.day === day ? state.used : 0;
  if (!Number.isInteger(used) || used < 0 || !Number.isFinite(state.lastReviewAt || 0))
    return { approved: false, reason: 'invalid_review_state' };
  if (!settings.localReviewsEnabled) return { approved: false, reason: 'local_reviews_disabled' };
  if (used >= settings.maxLocalReviewsPerUtcDay)
    return { approved: false, reason: 'daily_review_cap' };
  if (state.lastReviewAt && now - state.lastReviewAt < settings.minReviewIntervalMinutes * 60000)
    return { approved: false, reason: 'review_cooldown' };
  return { approved: true, nextState: { day, used: used + 1, lastReviewAt: now } };
}

function reserveReview(now = Date.now()) {
  const directory = path.join(__dirname, '../freqtrade/user_data/research');
  const target = path.join(directory, 'ai-review-budget.json');
  const lock = target + '.lock';
  let fd;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fd = fs.openSync(lock, 'wx');
    const state = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    const result = reviewAllowance(state, now);
    if (result.approved) {
      const temp = target + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(result.nextState));
      fs.renameSync(temp, target);
    }
    return result;
  } catch (_) { return { approved: false, reason: 'review_budget_unavailable' }; }
  finally {
    if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}
module.exports = { reviewAllowance, reserveReview };
