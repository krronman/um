import * as THREE from 'three';

// ================= 설정 =================
const R = 0.4;          // 플레이어 반지름
const H = 1.8;          // 플레이어 키
const SPEED = 7;
const GRAVITY = 25;
const JUMP = 9;
const CAM_DIST = 7;

// ================= 장면 =================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;   sun.shadow.camera.bottom = -60;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// 바닥
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x6aa84f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(400, 100, 0x4a7a38, 0x5d9444));

// ================= 코스 (계단식 점프맵) =================
const boxes = []; // {minX,maxX,minZ,maxZ,minY,maxY}
let finishBox = null;

function addBox(cx, cz, w, d, top, color, isFinish = false) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, top, d),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(cx, top / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const b = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: 0, maxY: top };
  boxes.push(b);
  if (isFinish) finishBox = b;
}

const STEPS = 10;
for (let i = 0; i < STEPS; i++) {
  const x = Math.sin(i * 0.8) * 5;
  const z = -10 - i * 6;
  const top = (i + 1) * 1.2;
  const hue = (i / STEPS) * 0.8;
  addBox(x, z, 5, 5, top, new THREE.Color().setHSL(hue, 0.6, 0.55));
}
// 골인 지점
{
  const x = Math.sin(STEPS * 0.8) * 5;
  const z = -10 - STEPS * 6;
  addBox(x, z, 8, 8, (STEPS + 1) * 1.2, 0xffd700, true);
}

// ================= 캐릭터 만들기 =================
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 36px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.fillRect(0, 8, 256, 48);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 46);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(2, 0.5, 1);
  s.position.y = H + 0.5;
  return s;
}

function makeCharacter(name, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(R, H - R * 2, 4, 12),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = H / 2;
  body.castShadow = true;
  g.add(body);
  // 앞쪽 표시 (+z 방향)
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  nose.position.set(0, H - 0.5, R);
  g.add(nose);
  g.userData.body = body;
  g.userData.label = makeLabel(name);
  g.add(g.userData.label);
  scene.add(g);
  return g;
}

function setLabel(g, name) {
  g.remove(g.userData.label);
  g.userData.label.material.map.dispose();
  g.userData.label = makeLabel(name);
  g.add(g.userData.label);
}

// ================= 상태 =================
const me = {
  pos: new THREE.Vector3((Math.random() - 0.5) * 6, 0, 5),
  vy: 0,
  onGround: false,
  ry: 0,
  mesh: null,
  name: '',
  color: 0x3b82f6,
  finished: false,
};
const others = new Map(); // id -> {mesh, target:Vector3, tRy}
let myId = null;
let ws = null;
let started = false;

// ================= 입력 =================
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && started) respawn();
});
addEventListener('keyup', (e) => (keys[e.code] = false));

let yaw = 0, pitch = 0.45;
renderer.domElement.addEventListener('click', () => {
  if (started) renderer.domElement.requestPointerLock?.();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.003;
  pitch += e.movementY * 0.003;
  pitch = Math.max(0.05, Math.min(1.3, pitch));
});

// ================= 충돌 =================
function hits(px, py, pz) {
  for (const b of boxes) {
    if (px + R > b.minX && px - R < b.maxX && pz + R > b.minZ && pz - R < b.maxZ && py < b.maxY && py + H > b.minY) {
      return b;
    }
  }
  return null;
}

function respawn() {
  me.pos.set((Math.random() - 0.5) * 6, 0, 5);
  me.vy = 0;
  me.finished = false;
}

function updateMe(dt) {
  // 이동 방향 (카메라 기준)
  let f = 0, r = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) r += 1;
  if (keys.KeyA || keys.ArrowLeft) r -= 1;

  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let dx = fx * f + rx * r;
  let dz = fz * f + rz * r;
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    dx /= len; dz /= len;
    const target = Math.atan2(dx, dz);
    let diff = target - me.ry;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    me.ry += diff * Math.min(1, dt * 14);
  }

  // 수평 이동 (축별 충돌)
  const nx = me.pos.x + dx * SPEED * dt;
  if (!hits(nx, me.pos.y, me.pos.z)) me.pos.x = nx;
  const nz = me.pos.z + dz * SPEED * dt;
  if (!hits(me.pos.x, me.pos.y, nz)) me.pos.z = nz;

  // 점프
  if (keys.Space && me.onGround) {
    me.vy = JUMP;
    me.onGround = false;
  }

  // 수직 이동
  me.vy -= GRAVITY * dt;
  const ny = me.pos.y + me.vy * dt;
  const hit = hits(me.pos.x, ny, me.pos.z);
  me.onGround = false;
  if (hit) {
    if (me.vy < 0) {
      me.pos.y = hit.maxY;
      me.onGround = true;
    }
    me.vy = 0;
  } else {
    me.pos.y = ny;
  }
  if (me.pos.y <= 0) {
    me.pos.y = 0;
    me.vy = 0;
    me.onGround = true;
  }

  // 골인 체크
  if (!me.finished && finishBox && me.onGround && me.pos.y >= finishBox.maxY - 0.05 &&
      me.pos.x > finishBox.minX && me.pos.x < finishBox.maxX &&
      me.pos.z > finishBox.minZ && me.pos.z < finishBox.maxZ) {
    me.finished = true;
    toast('🏁 골인!');
    send({ t: 'finish' });
  }

  me.mesh.position.copy(me.pos);
  me.mesh.rotation.y = me.ry;
}

function updateCamera() {
  const cx = me.pos.x + Math.sin(yaw) * Math.cos(pitch) * CAM_DIST;
  const cy = me.pos.y + 1.5 + Math.sin(pitch) * CAM_DIST;
  const cz = me.pos.z + Math.cos(yaw) * Math.cos(pitch) * CAM_DIST;
  camera.position.set(cx, Math.max(cy, 0.3), cz);
  camera.lookAt(me.pos.x, me.pos.y + 1.4, me.pos.z);
}

// ================= 네트워크 =================
function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function addOther(p) {
  if (p.id === myId || others.has(p.id)) return;
  const mesh = makeCharacter(p.name, p.color);
  mesh.position.set(p.x, p.y, p.z);
  others.set(p.id, { mesh, target: new THREE.Vector3(p.x, p.y, p.z), tRy: p.ry || 0 });
  updateHud();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    setStatus('');
    send({ t: 'hello', name: me.name, color: me.color });
  };

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'init') {
      myId = m.id;
      m.players.forEach(addOther);
    } else if (m.t === 'join') {
      addOther(m.player);
    } else if (m.t === 'info') {
      const o = others.get(m.id);
      if (o) {
        o.mesh.userData.body.material.color.setHex(m.color);
        setLabel(o.mesh, m.name);
      }
    } else if (m.t === 'state') {
      for (const p of m.players) {
        const o = others.get(p.id);
        if (o) {
          o.target.set(p.x, p.y, p.z);
          o.tRy = p.ry;
        }
      }
    } else if (m.t === 'leave') {
      const o = others.get(m.id);
      if (o) {
        scene.remove(o.mesh);
        others.delete(m.id);
        updateHud();
      }
    } else if (m.t === 'finish') {
      toast(`🏁 ${m.name} 골인!`);
    }
  };

  ws.onclose = () => {
    setStatus('연결이 끊겼어요. 다시 연결 중...');
    for (const o of others.values()) scene.remove(o.mesh);
    others.clear();
    setTimeout(connect, 2000);
  };
}

// 내 위치 전송 (초당 15회)
setInterval(() => {
  if (!started) return;
  send({ t: 'move', x: me.pos.x, y: me.pos.y, z: me.pos.z, ry: me.ry });
}, 1000 / 15);

// ================= UI =================
const hud = document.getElementById('hud');
const toastEl = document.getElementById('toast');
let statusText = '';
function setStatus(t) { statusText = t; updateHud(); }
function updateHud() {
  hud.textContent = (statusText ? statusText + '\n' : '') + `접속자: ${others.size + 1}명`;
  hud.style.whiteSpace = 'pre';
}
let toastTimer;
function toast(t) {
  toastEl.textContent = t;
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = 0), 2500);
}

document.getElementById('start').onclick = () => {
  me.name = document.getElementById('name').value.trim().slice(0, 12) || 'Player';
  me.color = parseInt(document.getElementById('color').value.slice(1), 16);
  me.mesh = makeCharacter(me.name, me.color);
  me.mesh.position.copy(me.pos);
  document.getElementById('overlay').style.display = 'none';
  started = true;
  connect();
  updateHud();
  renderer.domElement.requestPointerLock?.();
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= 메인 루프 =================
const clock = new THREE.Clock();
camera.position.set(0, 8, 14);
camera.lookAt(0, 1, 0);

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (started) {
    updateMe(dt);
    updateCamera();
  }

  // 다른 플레이어 부드럽게 보간
  for (const o of others.values()) {
    o.mesh.position.lerp(o.target, Math.min(1, dt * 12));
    let diff = o.tRy - o.mesh.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    o.mesh.rotation.y += diff * Math.min(1, dt * 12);
  }

  renderer.render(scene, camera);
}
loop();
