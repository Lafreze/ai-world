import * as THREE from "three";
import { WorldRenderer } from "/world-render.js";
import { buildHumanoid, animateHumanoid } from "/voxel-character.js";

// ----- Auth state -----
const authState = {
  token: localStorage.getItem("token") || null,
  user: null,
};
function authHeaders() {
  return authState.token ? { Authorization: `Bearer ${authState.token}` } : {};
}
async function fetchMe() {
  if (!authState.token) return null;
  try {
    const r = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!r.ok) throw new Error();
    const d = await r.json();
    authState.user = d.user;
    return d.user;
  } catch {
    authState.token = null;
    localStorage.removeItem("token");
    return null;
  }
}

// ----- Three.js setup -----
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x9fc8ea);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fc8ea, 30, 90);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

// Lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x6b8a5b, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(8, 20, 6);
scene.add(sun);

// World renderer
let worldId = 1;
let gridSize = 16;
let worldRenderer = new WorldRenderer(scene, gridSize);

// Agents
const agentsGroup = new THREE.Group();
scene.add(agentsGroup);
const agentNodes = new Map(); // id -> { group, data, prevPos, targetPos, lerpT, walking, phase, label }

function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.fillText(text, canvas.width / 2, 42);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

function makeSpeechBubble(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 18);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.font = "32px sans-serif";
  ctx.textAlign = "center";
  wrapText(ctx, text, canvas.width / 2, 56, canvas.width - 40, 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true }),
  );
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + " ";
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, y);
}

function ensureAgentNode(a) {
  let node = agentNodes.get(a.id);
  if (!node) {
    const group = buildHumanoid(a.appearance || {});
    const label = makeLabel(a.name);
    label.position.y = 1.55;
    group.add(label);
    agentsGroup.add(group);
    node = {
      group,
      data: a,
      prevPos: { x: a.x, z: a.z },
      targetPos: { x: a.x, z: a.z },
      lerpT: 1,
      walking: false,
      phase: 0,
      label,
    };
    agentNodes.set(a.id, node);
  }
  node.data = { ...node.data, ...a };
  const { x, z } = a;
  node.targetPos = { x, z };
  if (Math.abs(x - node.prevPos.x) + Math.abs(z - node.prevPos.z) > 0) {
    node.lerpT = 0;
    node.walking = true;
  }
  // Facing → rotation around y. 0=N(-z), 1=E(+x), 2=S(+z), 3=W(-x)
  const yawByFacing = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];
  node.targetYaw = yawByFacing[a.facing ?? 0];
  if (
    node.group.rotation.y === 0 &&
    node.prevPos.x === x &&
    node.prevPos.z === z
  ) {
    node.group.rotation.y = node.targetYaw;
  }
  return node;
}

function removeAgentNode(id) {
  const node = agentNodes.get(id);
  if (!node) return;
  agentsGroup.remove(node.group);
  agentNodes.delete(id);
}

function placeAgent(node) {
  const t = node.lerpT;
  const fx = node.prevPos.x + (node.targetPos.x - node.prevPos.x) * t;
  const fz = node.prevPos.z + (node.targetPos.z - node.prevPos.z) * t;
  node.group.position.set(fx + 0.5, 0, fz + 0.5);
}

function showSpeech(agentId, text) {
  const node = agentNodes.get(agentId);
  if (!node) return;
  if (node.speech) node.group.remove(node.speech);
  const sprite = makeSpeechBubble(text);
  sprite.position.y = 2.1;
  node.group.add(sprite);
  node.speech = sprite;
  node.speechUntil = performance.now() + 4000;

  // Chat feed
  const feed = document.getElementById("chat-feed");
  const line = document.createElement("div");
  line.className = "chat-line";
  line.innerHTML = `<span class="who">${escapeHtml(node.data.name)}</span> ${escapeHtml(text)}`;
  feed.appendChild(line);
  while (feed.children.length > 30) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// ----- Camera orbit controls (minimal) -----
const camState = {
  theta: Math.PI / 4,
  phi: Math.PI / 4,
  dist: 22,
  target: new THREE.Vector3(0, 0, 0),
};
function updateCamera() {
  const { theta, phi, dist, target } = camState;
  const x = target.x + dist * Math.sin(phi) * Math.cos(theta);
  const y = target.y + dist * Math.cos(phi);
  const z = target.z + dist * Math.sin(phi) * Math.sin(theta);
  camera.position.set(x, y, z);
  camera.lookAt(target);
}

let dragging = false;
let lastX = 0;
let lastZ = 0;
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && !e.shiftKey && editorActive() && hoveredCell) {
    paintCell(hoveredCell.x, hoveredCell.z, false);
    return;
  }
  if (e.button === 0 && e.shiftKey && editorActive() && hoveredCell) {
    paintCell(hoveredCell.x, hoveredCell.z, true);
    return;
  }
  if (
    e.button === 2 ||
    (e.button === 0 && e.altKey) ||
    (e.button === 0 && !editorActive())
  ) {
    dragging = true;
    lastX = e.clientX;
    lastZ = e.clientY;
  }
});
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastZ;
  lastX = e.clientX;
  lastZ = e.clientY;
  camState.theta -= dx * 0.008;
  camState.phi = Math.max(
    0.1,
    Math.min(Math.PI / 2 - 0.05, camState.phi - dy * 0.008),
  );
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camState.dist = Math.max(6, Math.min(80, camState.dist + e.deltaY * 0.02));
  },
  { passive: false },
);

// ----- Raycaster for cell pick / agent hover -----
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredCell = null;
let hoveredAgentId = null;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Cell pick
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    const cx = Math.floor(hit.x);
    const cz = Math.floor(hit.z);
    const half = Math.floor(gridSize / 2);
    if (cx >= -half && cx < half && cz >= -half && cz < half) {
      hoveredCell = { x: cx, z: cz };
    } else hoveredCell = null;
  }

  // Agent hover
  const groups = [];
  for (const node of agentNodes.values()) groups.push(node.group);
  const intersects = raycaster.intersectObjects(groups, true);
  if (intersects.length > 0) {
    let g = intersects[0].object;
    while (g && !g.userData?.totalHeight && g.parent !== agentsGroup)
      g = g.parent;
    if (g) {
      const id = [...agentNodes.entries()].find(([, n]) => n.group === g)?.[0];
      hoveredAgentId = id ?? null;
    }
  } else hoveredAgentId = null;
});

// Hover highlight
const hoverHelper = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  }),
);
hoverHelper.rotation.x = -Math.PI / 2;
hoverHelper.visible = false;
scene.add(hoverHelper);

// ----- Editor -----
function editorActive() {
  return authState.user?.role === "admin";
}

async function paintCell(x, z, erase) {
  const terrain = erase ? "grass" : document.getElementById("ed-terrain").value;
  const kindRaw = erase ? "" : document.getElementById("ed-kind").value;
  const kind = kindRaw || null;
  const body = {
    cells: [{ x, z, terrain, kind, floors: 1, terrain_floors: 1 }],
  };
  const r = await fetch(`/api/worlds/${worldId}/cells`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn("paint failed", await r.text());
    return;
  }
  // Optimistic local update
  worldRenderer.setCell(x, z, {
    x,
    z,
    terrain,
    kind,
    floors: 1,
    terrain_floors: 1,
  });
}

document.getElementById("ed-clear")?.addEventListener("click", async () => {
  if (!confirm("Clear entire world?")) return;
  await fetch(`/api/worlds/${worldId}/cells`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  worldRenderer.clear();
});

document.getElementById("ag-spawn")?.addEventListener("click", async () => {
  if (!hoveredCell) {
    alert("Hover a cell first.");
    return;
  }
  const name = document.getElementById("ag-name").value.trim() || randomName();
  const r = await fetch(`/api/worlds/${worldId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, x: hoveredCell.x, z: hoveredCell.z }),
  });
  if (!r.ok) {
    alert("Spawn failed: " + (await r.text()));
    return;
  }
});

function randomName() {
  const a = [
    "Mira",
    "Toro",
    "Bee",
    "Kip",
    "Luna",
    "Otto",
    "Sage",
    "Wren",
    "Iris",
    "Finn",
  ];
  return a[Math.floor(Math.random() * a.length)];
}

// ----- Login flow -----
document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "flex";
});
document.getElementById("lg-cancel").addEventListener("click", () => {
  document.getElementById("login-modal").style.display = "none";
});
document.getElementById("lg-go").addEventListener("click", async () => {
  const username = document.getElementById("lg-user").value.trim();
  const password = document.getElementById("lg-pass").value;
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    document.getElementById("lg-msg").textContent = "Login failed";
    return;
  }
  const d = await r.json();
  authState.token = d.token;
  authState.user = d.user;
  localStorage.setItem("token", d.token);
  document.getElementById("login-modal").style.display = "none";
  refreshAuthUI();
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  authState.token = null;
  authState.user = null;
  localStorage.removeItem("token");
  refreshAuthUI();
});

function refreshAuthUI() {
  const u = authState.user;
  document.getElementById("me").textContent = u
    ? `${u.username} (${u.role})`
    : "";
  document.getElementById("loginBtn").style.display = u ? "none" : "";
  document.getElementById("logoutBtn").style.display = u ? "" : "none";
  document.getElementById("editor").style.display =
    u?.role === "admin" ? "" : "none";
}

// ----- Inspector -----
function updateInspector() {
  const body = document.getElementById("ins-body");
  if (!hoveredAgentId) {
    body.textContent = "Hover an agent…";
    return;
  }
  const node = agentNodes.get(hoveredAgentId);
  if (!node) return;
  const d = node.data;
  const a = d.attributes || {};
  const p = d.personality || {};
  const bar = (label, v) =>
    `<div class="row"><span class="k">${label}</span><span>${Math.round(v)}</span></div>
     <div class="bar"><div style="width:${Math.max(0, Math.min(100, v))}%"></div></div>`;
  body.innerHTML = `
    <div><b>${escapeHtml(d.name)}</b> #${d.id}</div>
    <div class="row"><span class="k">Position</span><span>(${d.x}, ${d.z})</span></div>
    <div class="row"><span class="k">Action</span><span>${escapeHtml(d.last_action || "")}</span></div>
    <div class="row"><span class="k">Thought</span><span>${escapeHtml((d.last_thought || "").slice(0, 30))}</span></div>
    <hr style="opacity:0.2; margin:6px 0"/>
    ${bar("HP", a.hp ?? 0)}
    ${bar("Energy", a.energy ?? 0)}
    ${bar("Hunger", a.hunger ?? 0)}
    ${bar("Social", a.social ?? 0)}
    ${bar("Mood", a.mood ?? 0)}
    <hr style="opacity:0.2; margin:6px 0"/>
    ${bar("Curiosity", p.curiosity ?? 0)}
    ${bar("Bravery", p.bravery ?? 0)}
    ${bar("Sociability", p.sociability ?? 0)}
    ${bar("Laziness", p.laziness ?? 0)}
    ${bar("Kindness", p.kindness ?? 0)}
  `;
}

// ----- Network -----
async function loadWorld() {
  const r = await fetch(`/api/worlds/${worldId}`);
  if (!r.ok) {
    document.getElementById("status").textContent = "world not found";
    return;
  }
  const d = await r.json();
  gridSize = d.world.grid_size;
  worldRenderer.setGridSize(gridSize);
  worldRenderer.loadCells(d.cells);
  for (const a of d.agents) ensureAgentNode(a);
  // Remove any client-side agents that no longer exist
  const liveIds = new Set(d.agents.map((a) => a.id));
  for (const id of [...agentNodes.keys()])
    if (!liveIds.has(id)) removeAgentNode(id);
}

let ws = null;
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/live/${worldId}`);
  ws.onopen = () => {
    document.getElementById("status").textContent = "live";
  };
  ws.onclose = () => {
    document.getElementById("status").textContent = "disconnected — retrying";
    setTimeout(connectWS, 2000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleWS(msg);
  };
}

function handleWS(msg) {
  switch (msg.type) {
    case "agent-tick": {
      const node = agentNodes.get(msg.id);
      if (!node) {
        // Refetch
        loadWorld();
        return;
      }
      node.prevPos = { x: node.targetPos.x, z: node.targetPos.z };
      node.targetPos = { x: msg.x, z: msg.z };
      node.lerpT = 0;
      node.walking = node.prevPos.x !== msg.x || node.prevPos.z !== msg.z;
      const yawByFacing = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];
      node.targetYaw = yawByFacing[msg.facing ?? 0];
      node.data = {
        ...node.data,
        x: msg.x,
        z: msg.z,
        facing: msg.facing,
        last_action: msg.action,
        last_thought: msg.thought,
        attributes: msg.attrs,
      };
      break;
    }
    case "say":
      showSpeech(msg.agentId, msg.text);
      break;
    case "agent-created":
      ensureAgentNode(msg.agent);
      break;
    case "agent-removed":
      removeAgentNode(msg.id);
      break;
    case "cells-updated":
    case "world-cleared":
      loadWorld();
      break;
  }
}

// ----- Render loop -----
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // Agent lerp + animation
  for (const node of agentNodes.values()) {
    if (node.lerpT < 1) {
      node.lerpT = Math.min(1, node.lerpT + dt * 2);
      if (node.lerpT >= 1) {
        node.walking = false;
        node.prevPos = { ...node.targetPos };
      }
    }
    placeAgent(node);
    // Smoothly rotate
    if (node.targetYaw !== undefined) {
      let diff = node.targetYaw - node.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      node.group.rotation.y += diff * Math.min(1, dt * 8);
    }
    node.phase += dt * (node.walking ? 8 : 1);
    animateHumanoid(node.group, node.phase, node.walking);

    if (node.speech && now > node.speechUntil) {
      node.group.remove(node.speech);
      node.speech = null;
    }
  }

  // Hover highlight
  if (hoveredCell) {
    hoverHelper.visible = true;
    hoverHelper.position.set(hoveredCell.x + 0.5, 0.01, hoveredCell.z + 0.5);
  } else {
    hoverHelper.visible = false;
  }

  updateInspector();
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ----- Boot -----
(async () => {
  await fetchMe();
  refreshAuthUI();
  await loadWorld();
  connectWS();
  requestAnimationFrame(frame);
})();
