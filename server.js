const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

// ---------- HTTP: 게임 파일 제공 ----------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- WebSocket: 멀티플레이 ----------
const wss = new WebSocketServer({ server });
const players = new Map(); // id -> player
let nextId = 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj, except) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = { id, name: 'Player' + id, color: 0x4488ff, x: 0, y: 0, z: 5, ry: 0 };
  players.set(id, player);
  ws.isAlive = true;

  send(ws, { t: 'init', id, players: [...players.values()] });
  broadcast({ t: 'join', player }, ws);

  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'hello') {
      player.name = String(m.name || '').slice(0, 12) || player.name;
      player.color = Math.max(0, Math.min(0xffffff, num(m.color)));
      broadcast({ t: 'info', id, name: player.name, color: player.color });
    } else if (m.t === 'move') {
      player.x = num(m.x);
      player.y = num(m.y);
      player.z = num(m.z);
      player.ry = num(m.ry);
    } else if (m.t === 'finish') {
      broadcast({ t: 'finish', name: player.name });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ t: 'leave', id });
  });
});

// 위치 브로드캐스트 (초당 15회)
setInterval(() => {
  if (players.size === 0) return;
  const list = [...players.values()].map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry }));
  broadcast({ t: 'state', players: list });
}, 1000 / 15);

// 연결 유지 (Render는 유휴 연결을 끊을 수 있음)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Server listening on', PORT));
