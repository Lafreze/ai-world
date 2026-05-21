// Tiny voxel humanoid. Stylized chibi proportions (big head).
// Returns a THREE.Group whose y=0 sits on the ground.
import * as THREE from "three";

function box(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

export function buildHumanoid(appearance = {}) {
  const skin = appearance.skinColor || "#f1c27d";
  const hair = appearance.hairColor || "#2b1d0e";
  const shirt = appearance.shirtColor || "#5e7cff";
  const pants = appearance.pantsColor || "#333a47";
  const shoes = "#1b1f27";

  const g = new THREE.Group();

  // Legs
  const legL = box(0.18, 0.32, 0.18, pants);
  legL.position.set(-0.11, 0.16, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.11;
  g.add(legR);

  // Shoes
  const shoeL = box(0.2, 0.06, 0.22, shoes);
  shoeL.position.set(-0.11, 0.03, 0.02);
  g.add(shoeL);
  const shoeR = shoeL.clone();
  shoeR.position.x = 0.11;
  g.add(shoeR);

  // Torso
  const torso = box(0.42, 0.36, 0.24, shirt);
  torso.position.set(0, 0.5, 0);
  g.add(torso);

  // Arms (pivot at shoulder for swing animation)
  const armPivotL = new THREE.Group();
  armPivotL.position.set(-0.27, 0.66, 0);
  g.add(armPivotL);
  const armL = box(0.14, 0.34, 0.16, shirt);
  armL.position.set(0, -0.17, 0);
  armPivotL.add(armL);
  const handL = box(0.14, 0.1, 0.16, skin);
  handL.position.set(0, -0.39, 0);
  armPivotL.add(handL);

  const armPivotR = new THREE.Group();
  armPivotR.position.set(0.27, 0.66, 0);
  g.add(armPivotR);
  const armR = armL.clone();
  armR.position.set(0, -0.17, 0);
  armPivotR.add(armR);
  const handR = handL.clone();
  handR.position.set(0, -0.39, 0);
  armPivotR.add(handR);

  // Leg pivots for walk (rebuild as pivots)
  g.remove(legL, legR, shoeL, shoeR);
  const legPivotL = new THREE.Group();
  legPivotL.position.set(-0.11, 0.32, 0);
  const legMeshL = box(0.18, 0.32, 0.18, pants);
  legMeshL.position.set(0, -0.16, 0);
  legPivotL.add(legMeshL);
  const shoeMeshL = box(0.2, 0.06, 0.22, shoes);
  shoeMeshL.position.set(0, -0.32 - 0.03 + 0.005, 0.02);
  legPivotL.add(shoeMeshL);
  g.add(legPivotL);

  const legPivotR = legPivotL.clone(true);
  legPivotR.position.x = 0.11;
  g.add(legPivotR);

  // Head
  const head = box(0.46, 0.42, 0.42, skin);
  head.position.set(0, 0.92, 0);
  g.add(head);

  // Hair cap
  const hairCap = box(0.5, 0.14, 0.46, hair);
  hairCap.position.set(0, 1.16, 0);
  g.add(hairCap);

  // Eyes
  const eyeGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#1a1a1a" });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.1, 0.96, 0.22);
  g.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.1, 0.96, 0.22);
  g.add(eyeR);

  // Expose pivots for animation
  g.userData.armPivotL = armPivotL;
  g.userData.armPivotR = armPivotR;
  g.userData.legPivotL = legPivotL;
  g.userData.legPivotR = legPivotR;
  g.userData.totalHeight = 1.3;

  // Slight shadow blob underfoot (cheap)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 16),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.25,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  g.add(shadow);

  return g;
}

// Walk-cycle animation. Pass a phase that increments each frame.
export function animateHumanoid(group, phase, walking) {
  const { armPivotL, armPivotR, legPivotL, legPivotR } = group.userData;
  if (!armPivotL) return;
  if (walking) {
    const swing = Math.sin(phase) * 0.7;
    armPivotL.rotation.x = swing;
    armPivotR.rotation.x = -swing;
    legPivotL.rotation.x = -swing * 0.8;
    legPivotR.rotation.x = swing * 0.8;
  } else {
    const idle = Math.sin(phase * 0.4) * 0.05;
    armPivotL.rotation.x = idle;
    armPivotR.rotation.x = -idle;
    legPivotL.rotation.x = 0;
    legPivotR.rotation.x = 0;
  }
}
