// Minimal voxel terrain renderer. Cell size = 1 unit.
import * as THREE from "three";

const TERRAIN_COLORS = {
  grass: 0x6cae5a,
  path: 0xc8a96a,
  dirt: 0x8a6a3a,
  water: 0x4a8fbf,
  stone: 0x8c8e92,
  sand: 0xe6cf94,
  snow: 0xf2f4f8,
};

const KIND_BUILDERS = {
  tree: makeTree,
  house: makeHouse,
  rock: makeRock,
  bridge: makeBridge,
  flower: makeFlower,
  bush: makeBush,
};

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function makeTile(terrain, floors) {
  const h = 0.2 * Math.max(1, floors || 1);
  const geo = new THREE.BoxGeometry(1, h, 1);
  const m = new THREE.Mesh(
    geo,
    mat(TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS.grass),
  );
  m.position.y = h / 2;
  return m;
}

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.5, 0.18),
    mat(0x6e4a22),
  );
  trunk.position.y = 0.45;
  g.add(trunk);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    mat(0x3e7d2f),
  );
  top.position.y = 0.95;
  g.add(top);
  const top2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.5),
    mat(0x4f9a3d),
  );
  top2.position.y = 1.4;
  g.add(top2);
  return g;
}

function makeHouse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.6, 0.8),
    mat(0xd8c39a),
  );
  body.position.y = 0.5;
  g.add(body);
  // Pyramid roof via cone with 4 segments
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.65, 0.45, 4),
    mat(0x9a3d3d),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 1.02;
  g.add(roof);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.3, 0.05),
    mat(0x5a3a1f),
  );
  door.position.set(0, 0.35, 0.41);
  g.add(door);
  return g;
}

function makeRock() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.4, 0.55),
    mat(0x9aa0a8),
  );
  a.position.y = 0.4;
  g.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(0xb0b6bd));
  b.position.set(0.2, 0.7, 0.15);
  g.add(b);
  return g;
}

function makeBridge() {
  const g = new THREE.Group();
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.9),
    mat(0x8a5a2a),
  );
  plank.position.y = 0.4;
  g.add(plank);
  return g;
}

function makeFlower() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.2, 0.04),
    mat(0x3e7d2f),
  );
  stem.position.y = 0.3;
  g.add(stem);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.08, 0.16),
    mat(0xff7aa8),
  );
  head.position.y = 0.45;
  g.add(head);
  return g;
}

function makeBush() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat(0x4f9a3d));
  b.position.y = 0.35;
  g.add(b);
  return g;
}

export class WorldRenderer {
  constructor(scene, gridSize) {
    this.scene = scene;
    this.gridSize = gridSize;
    this.cellGroup = new THREE.Group();
    this.scene.add(this.cellGroup);
    this.cells = new Map(); // "x,z" -> { tile, obj, data }
    this.buildBaseGround();
  }

  buildBaseGround() {
    if (this.base) this.scene.remove(this.base);
    const size = this.gridSize;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      mat(TERRAIN_COLORS.grass),
    );
    g.rotation.x = -Math.PI / 2;
    g.position.y = 0;
    this.scene.add(g);
    this.base = g;
  }

  setGridSize(n) {
    this.gridSize = n;
    this.buildBaseGround();
  }

  worldToScene(x, z) {
    return { sx: x + 0.5, sz: z + 0.5 };
  }

  setCell(x, z, data) {
    const key = `${x},${z}`;
    const existing = this.cells.get(key);
    if (existing) {
      this.cellGroup.remove(existing.group);
    }
    const isDefault =
      !data ||
      (data.terrain === "grass" &&
        !data.kind &&
        (data.terrain_floors ?? 1) === 1);
    if (isDefault) {
      this.cells.delete(key);
      return;
    }
    const group = new THREE.Group();
    if (data.terrain && data.terrain !== "grass") {
      const tile = makeTile(data.terrain, data.terrain_floors);
      group.add(tile);
    } else if ((data.terrain_floors || 1) > 1) {
      const tile = makeTile("grass", data.terrain_floors);
      group.add(tile);
    }
    if (data.kind && KIND_BUILDERS[data.kind]) {
      const obj = KIND_BUILDERS[data.kind](data);
      const baseH = 0.2 * Math.max(1, data.terrain_floors || 1);
      obj.position.y = data.terrain && data.terrain !== "grass" ? baseH : 0;
      group.add(obj);
    }
    const { sx, sz } = this.worldToScene(x, z);
    group.position.set(sx, 0, sz);
    this.cellGroup.add(group);
    this.cells.set(key, { group, data });
  }

  clear() {
    for (const { group } of this.cells.values()) this.cellGroup.remove(group);
    this.cells.clear();
  }

  loadCells(cellList) {
    this.clear();
    for (const c of cellList) this.setCell(c.x, c.z, c);
  }
}
