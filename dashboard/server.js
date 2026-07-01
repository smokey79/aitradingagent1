/**
 * Dashboard WebSocket Server
 * Streams live trade signals, balance, and agent status to the React dashboard.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path    = require('path');
const { getSummary } = require('../utils/profitAllocator');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.DASHBOARD_PORT || 3001;

app.use(express.static(path.join(__dirname, 'build')));
app.get('/api/status', (req, res) => res.json({ ...getSummary(), uptime: process.uptime() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

// Broadcast to all connected dashboard clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
}

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  ws.send(JSON.stringify({ type: 'status', ...getSummary() }));
});

// Expose broadcast so orchestrator can push live signals
global.dashboardBroadcast = broadcast;

server.listen(PORT, () => console.log(`📊 Dashboard server running at http://localhost:${PORT}`));
module.exports = { broadcast };
