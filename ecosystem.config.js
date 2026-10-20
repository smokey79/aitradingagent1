/** Only the current research scheduler belongs in this PM2 manifest.
 * Freqtrade is managed separately by its Compose file.
 * This file does not delete previously registered PM2 processes.
 */
module.exports = {
  apps: [{
    name: 'aitradingagent',
    cwd: __dirname,
    script: 'orchestrator/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: { NODE_ENV: 'production', PAPER_TRADING: 'true', DL4J_ENABLED: 'false' },
    restart_delay: 10000,
    min_uptime: 30000,
    max_restarts: 5,
    log_file: 'logs/pm2-trading.log',
  }],
};
