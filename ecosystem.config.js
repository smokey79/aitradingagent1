module.exports = {
  apps: [
    {
      name: 'aitradingagent',
      script: 'orchestrator/index.js',
      watch: false,
      env: { NODE_ENV: 'production', PAPER_TRADING: 'true' },
      restart_delay: 5000,
      max_restarts: 10,
      log_file: 'logs/pm2-trading.log',
    },
    {
      name: 'aitradingagent-dashboard',
      script: 'dashboard/server.js',
      watch: false,
      env: { PORT: 3001 },
      restart_delay: 3000,
    }
  ]
};
