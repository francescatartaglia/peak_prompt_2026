import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { interpolatePoint } from "./geo.js";

const LAYER_OFFSETS = {
  audio: { lateral: 0, lift: 180 },
  image: { lateral: 70, lift: 95 },
  video: { lateral: -70, lift: 40 },
};

export function createScene(canvas, world) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1b242b, 0.00055);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 80;
  controls.maxDistance = 4200;

  // Lights
  scene.add(new THREE.AmbientLight(0xb7c7d1, 0.55));
  const sun = new THREE.DirectionalLight(0xffe6c8, 1.15);
  sun.position.set(800, 1400, 400);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7eb6c9, 0.35);
  fill.position.set(-600, 400, -800);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);

  const terrain = buildTerrain(world.points);
  root.add(terrain);

  const path = buildGlowingPath(world.points);
  root.add(path.group);

  const traveler = buildTraveler();
  root.add(traveler);

  const mediaRoot = new THREE.Group();
  root.add(mediaRoot);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let markerMeshes = [];
  let animatingCamera = false;

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  function setOverviewCamera(immediate = false) {
    const { bounds } = world;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 400);
    const target = new THREE.Vector3(cx, cy + 40, cz);
    const position = new THREE.Vector3(cx + span * 0.55, cy + span * 0.62, cz + span * 0.9);
    flyTo(position, target, immediate ? 0 : 1.6);
  }

  function flyTo(position, target, duration = 1.4) {
    animatingCamera = true;
    controls.enabled = false;
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const state = { t: 0 };

    if (!duration || typeof gsap === "undefined") {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      controls.enabled = true;
      animatingCamera = false;
      return;
    }

    gsap.to(state, {
      t: 1,
      duration,
      ease: "power3.inOut",
      onUpdate: () => {
        camera.position.lerpVectors(fromPos, position, state.t);
        controls.target.lerpVectors(fromTarget, target, state.t);
        controls.update();
      },
      onComplete: () => {
        controls.enabled = true;
        animatingCamera = false;
      },
    });
  }

  function flyToMedia(asset) {
    const p = asset._world;
    const position = new THREE.Vector3(p.x + 120, p.y + 90, p.z + 140);
    const target = new THREE.Vector3(p.x, p.y + 10, p.z);
    flyTo(position, target, 1.35);
  }

  function followProgress(progress) {
    const p = interpolatePoint(world.points, progress);
    traveler.position.set(p.x, p.y + 8, p.z);
    // Soft look-ahead
    const ahead = interpolatePoint(world.points, Math.min(progress + 0.02, 1));
    const target = new THREE.Vector3(p.x, p.y + 20, p.z);
    if (!animatingCamera && followEnabled) {
      const cam = new THREE.Vector3(p.x - 90, p.y + 70, p.z + 110);
      camera.position.lerp(cam, 0.08);
      controls.target.lerp(target, 0.1);
    }
    return { point: p, ahead };
  }

  let followEnabled = false;

  function setMarkers(assets) {
    // Clear previous
    while (mediaRoot.children.length) {
      const child = mediaRoot.children[0];
      mediaRoot.remove(child);
      child.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose?.();
        }
      });
    }
    markerMeshes = [];

    const connectorPositions = [];

    for (const asset of assets) {
      const base = world.points[asset.match?.index ?? 0] || interpolatePoint(world.points, asset.progress);
      const layer = LAYER_OFFSETS[asset.kind] || LAYER_OFFSETS.image;
      // Perpendicular offset from path tangent for layer rails
      const i = Math.min(base.index ?? 0, world.points.length - 2);
      const a = world.points[i];
      const b = world.points[Math.min(i + 1, world.points.length - 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;

      const x = base.x + nx * layer.lateral;
      const y = base.y + layer.lift;
      const z = base.z + nz * layer.lateral;
      asset._world = { x, y, z, base };

      const mesh = buildMarker(asset);
      mesh.position.set(x, y, z);
      mesh.userData.asset = asset;
      mediaRoot.add(mesh);
      markerMeshes.push(mesh);

      connectorPositions.push(base.x, base.y + 4, base.z, x, y, z);
    }

    if (connectorPositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(connectorPositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xd7e2e8,
        transparent: true,
        opacity: 0.28,
      });
      const lines = new THREE.LineSegments(geo, mat);
      lines.name = "connectors";
      mediaRoot.add(lines);
    }
  }

  function setFilter(kind) {
    for (const mesh of markerMeshes) {
      const show = kind === "all" || mesh.userData.asset.kind === kind;
      mesh.visible = show;
    }
    const connectors = mediaRoot.getObjectByName("connectors");
    if (connectors) connectors.visible = kind === "all";
  }

  function pick(clientX, clientY) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(markerMeshes, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.asset) obj = obj.parent;
    return obj?.userData.asset || null;
  }

  function tick() {
    controls.update();
    // Billboard markers toward camera
    for (const mesh of markerMeshes) {
      if (mesh.visible) mesh.quaternion.copy(camera.quaternion);
    }
    renderer.render(scene, camera);
  }

  setOverviewCamera(true);

  return {
    scene,
    camera,
    controls,
    renderer,
    tick,
    setOverviewCamera,
    flyToMedia,
    followProgress,
    setMarkers,
    setFilter,
    pick,
    setFollow(v) {
      followEnabled = v;
    },
    get followEnabled() {
      return followEnabled;
    },
  };
}

function buildTerrain(points) {
  const group = new THREE.Group();
  const halfW = 95;
  const positions = [];
  const colors = [];
  const indices = [];

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const tx = q.x - p.x;
    const tz = q.z - p.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = (-tz / len) * halfW;
    const nz = (tx / len) * halfW;

    // Four corners strip: left/right at current elevation with slight falloff
    const yL = p.y - 18;
    const yR = p.y - 18;
    positions.push(p.x + nx, yL, p.z + nz);
    positions.push(p.x - nx, yR, p.z - nz);

    const t = i / Math.max(points.length - 1, 1);
    const c = new THREE.Color().setHSL(0.1 - t * 0.05, 0.18, 0.28 + t * 0.12);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);

    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  // Soft under-plane
  const span = 2200;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(span, 48),
    new THREE.MeshStandardMaterial({ color: 0x141a1e, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = Math.min(...points.map((p) => p.y)) - 80;
  group.add(ground);

  return group;
}

function buildGlowingPath(points) {
  const group = new THREE.Group();
  const curvePoints = points.map((p) => new THREE.Vector3(p.x, p.y + 3, p.z));
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.1);

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(points.length * 2, 100), 4.2, 8, false),
    new THREE.MeshBasicMaterial({ color: 0xc4a574 })
  );
  group.add(tube);

  const glow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(points.length * 2, 100), 10, 8, false),
    new THREE.MeshBasicMaterial({
      color: 0xc4a574,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    })
  );
  group.add(glow);

  return { group, curve };
}

function buildTraveler() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(7, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xe7eef2 })
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(14, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x7eb6c9, transparent: true, opacity: 0.28, depthWrite: false })
  );
  g.add(core, halo);
  return g;
}

function buildMarker(asset) {
  const color = asset.kind === "audio" ? 0xd4a08c : asset.kind === "video" ? 0xb8c99a : 0x7eb6c9;
  const group = new THREE.Group();

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(14, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(15, 19, 28),
    new THREE.MeshBasicMaterial({ color: 0xe7eef2, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  group.add(ring);

  // Kind glyph as simple secondary disc for audio / play triangle proxy for video
  if (asset.kind === "audio") {
    const pulse = new THREE.Mesh(
      new THREE.CircleGeometry(6, 16),
      new THREE.MeshBasicMaterial({ color: 0x1b242b, side: THREE.DoubleSide })
    );
    pulse.position.z = 0.5;
    group.add(pulse);
  } else if (asset.kind === "video") {
    const play = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 3),
      new THREE.MeshBasicMaterial({ color: 0x1b242b, side: THREE.DoubleSide })
    );
    play.rotation.z = Math.PI / 2;
    play.position.z = 0.5;
    group.add(play);
  }

  if (!asset.onTrack) {
    disc.material.opacity = 0.45;
  }

  return group;
}
