/**
 * Media inspect: continuous morph from curved sphere patch → flat framed
 * photo + caption (masks the 3D→2D handoff). Exit reverses back to center.
 */

import * as THREE from "three";
import { bendGeometry, flattenGeometry } from "./sphere.js";
import { SPHERE_RADIUS } from "./zones.js";
import { setShaderOpacity } from "./mediaShader.js";
import { mediaHoverLines } from "./mediaHover.js";

const CLICK_MAX_DIST = 7;
const CLICK_MAX_MS = 450;
const FOCUS_DURATION = 0.72;
const UNFOCUS_DURATION = 0.9;
const FOCUS_EASE = "power2.inOut";
/**
 * Outside → inside: spherical orbit around the photo + exponential follow
 * (same idea as gigadesign media-wall focus).
 */
const APPROACH_DURATION = 0.85;
const APPROACH_FOLLOW = 12;
/** Inside only: camera recenter + morph (outside keeps FOCUS_DURATION). */
const FACE_INSIDE_DURATION = 0.85;
const FOCUS_INSIDE_DURATION = 0.5;
const EXIT_CENTER_FRAC = 0.18;
const FRAME_DIST = 5.35;
const DESIRED_H = 2.15;
/** Others fully hidden while inspecting. */
const DIM_OPACITY = 0;
const EASE = "sine.inOut";

export function createFocusController({
  camera,
  controls,
  scene,
  getMeshes,
  getSphereRadius,
  getSphereGroup,
  isEnabled,
  onInspectChange,
  onCaption,
} = {}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _mediaPos = new THREE.Vector3();
  const _outward = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _startCam = new THREE.Vector3();
  const _startTarget = new THREE.Vector3();
  const _startPos = new THREE.Vector3();
  const _startDir = new THREE.Vector3();
  const _endDir = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _startQuat = new THREE.Quaternion();
  const _endQuat = new THREE.Quaternion();
  const _tmpQuat = new THREE.Quaternion();
  const _worldUp = new THREE.Vector3(0, 1, 0);
  const _mediaUp = new THREE.Vector3();
  const _startUp = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _guideCam = new THREE.Vector3();
  const _guideLook = new THREE.Vector3();
  const _sph0 = new THREE.Spherical();
  const _sph1 = new THREE.Spherical();
  const _sph = new THREE.Spherical();

  let focused = null;
  let animating = false;
  /** True while flying to face the photo — spin frozen, heartbeat still live. */
  let approaching = false;
  let isInspectingMedia = false;
  let activeTween = null;
  let domElement = null;
  let focusLookAt = null;

  let downX = 0;
  let downY = 0;
  let downT = 0;
  let downValid = false;

  function setPointerFromEvent(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  function pick(event) {
    const meshes = (getMeshes?.() || []).filter((m) => m?.visible && !m.userData?.slideshowLock);
    if (!meshes.length) return null;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits[0]?.object || null;
  }

  function killTween() {
    if (activeTween && typeof gsap !== "undefined") {
      activeTween.kill();
      activeTween = null;
    }
  }

  function setInspecting(next) {
    if (isInspectingMedia === next) return;
    isInspectingMedia = next;
    onInspectChange?.(next);
  }

  function sphereRadius() {
    return Math.max(1, getSphereRadius?.() || SPHERE_RADIUS || 56);
  }

  function framePose() {
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_fwd);
    // Dead-center on optical axis (view offset handles free-band centering)
    _pos.copy(camera.position).addScaledVector(_fwd, FRAME_DIST);
    return {
      position: _pos.clone(),
      quaternion: camera.quaternion.clone(),
    };
  }

  function flatScale(mesh) {
    const baseH = mesh?.userData?.baseH || 2.2;
    return DESIRED_H / Math.max(baseH, 0.05);
  }

  function captureCurved(mesh) {
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) return;
    mesh.geometry.userData.inspectCurved = new Float32Array(pos.array);
  }

  /** t=0 curved (on sphere), t=1 flat. */
  function morphGeometry(mesh, t) {
    const geo = mesh.geometry;
    const flat = geo?.userData?.flat;
    const curved = geo?.userData?.inspectCurved;
    const pos = geo?.attributes?.position;
    if (!flat || !curved || !pos) return;
    const a = pos.array;
    const u = THREE.MathUtils.clamp(t, 0, 1);
    for (let i = 0; i < pos.count; i += 1) {
      const i3 = i * 3;
      a[i3] = curved[i3] * (1 - u) + flat[i3] * u;
      a[i3 + 1] = curved[i3 + 1] * (1 - u) + flat[i3 + 1] * u;
      a[i3 + 2] = curved[i3 + 2] * (1 - u) + flat[i3 + 2] * u;
    }
    pos.needsUpdate = true;
    if (u > 0.98) geo.computeVertexNormals();
  }

  function pullToScene(mesh) {
    if (!mesh || mesh.parent === scene) return;
    const parent = mesh.parent;
    mesh.userData.inspectParent = parent;
    parent?.updateMatrixWorld?.(true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
    parent.remove(mesh);
    scene.add(mesh);
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    mesh.scale.copy(worldScale);
    mesh.visible = true;
  }

  function shelveMesh(mesh) {
    if (!mesh) return;
    const s = mesh.userData.mediaScale || 1;
    bendGeometry(mesh.geometry, sphereRadius(), s);
    mesh.userData.inspectFlat = false;
    delete mesh.geometry.userData.inspectCurved;

    const parent = mesh.userData.inspectParent || getSphereGroup?.();
    const homePos = mesh.userData.homePosition?.clone?.() || new THREE.Vector3();
    const homeQuat = mesh.userData.homeQuaternion?.clone?.() || new THREE.Quaternion();
    if (mesh.parent) mesh.parent.remove(mesh);
    if (parent) {
      parent.add(mesh);
      mesh.position.copy(homePos);
      mesh.quaternion.copy(homeQuat);
      mesh.scale.setScalar(1);
    }
    setShaderOpacity(mesh.material, 1);
    mesh.userData.inspectLock = false;
    mesh.userData.inspectParent = null;
    if (mesh.userData.focusRenderOrder != null) {
      mesh.renderOrder = mesh.userData.focusRenderOrder;
      delete mesh.userData.focusRenderOrder;
    }
  }

  function homeWorldPose(mesh) {
    const parent = mesh.userData.inspectParent || getSphereGroup?.();
    const homePos = mesh.userData.homePosition?.clone?.() || new THREE.Vector3();
    const homeQuat = mesh.userData.homeQuaternion?.clone?.() || new THREE.Quaternion();
    if (!parent) {
      return { position: homePos, quaternion: homeQuat, scale: 1 };
    }
    parent.updateMatrixWorld(true);
    const position = homePos.clone().applyMatrix4(parent.matrixWorld);
    const parentQ = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQ);
    const quaternion = parentQ.clone().multiply(homeQuat);
    return { position, quaternion, scale: 1 };
  }

  function setMeshOpacity(mesh, o) {
    setShaderOpacity(mesh.material, o);
  }

  function dimOthers(except) {
    const list = (getMeshes?.() || []).filter(
      (m) => m && m !== except && !m.userData?.slideshowLock
    );
    for (const mesh of list) mesh.userData._inspectDimmed = true;
    return list;
  }

  function restoreDimFlags() {
    for (const mesh of getMeshes?.() || []) {
      if (!mesh?.userData?._inspectDimmed) continue;
      setMeshOpacity(mesh, 1);
      delete mesh.userData._inspectDimmed;
    }
  }

  function showCaption(mesh) {
    const asset = mesh?.userData?.asset;
    if (!asset || !onCaption) return;
    onCaption(mediaHoverLines(asset), mesh);
  }

  function hideCaption() {
    onCaption?.(null, null);
  }

  function layoutCaption() {
    if (!focused || !isInspectingMedia) return null;
    camera.updateMatrixWorld(true);
    focused.updateMatrixWorld(true);

    const geo = focused.geometry;
    const w0 = geo?.userData?.width || focused.userData.baseW || 2.2;
    const h0 = geo?.userData?.height || focused.userData.baseH || 2.2;
    const hw = w0 * 0.5 * focused.scale.x;
    const hh = h0 * 0.5 * focused.scale.y;

    const locals = [
      [-hw, hh, 0],
      [hw, hh, 0],
      [-hw, -hh, 0],
      [hw, -hh, 0],
    ];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const [lx, ly, lz] of locals) {
      _v.set(lx, ly, lz).applyMatrix4(focused.matrixWorld).project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

    return {
      left: Math.min(maxX + 16, window.innerWidth - 12),
      top: Math.max(8, minY),
    };
  }

  /** Inside park: photo centered in view and upright (mesh local +Y). */
  function parkPoseForMedia(mesh) {
    mesh.updateWorldMatrix?.(true, false);
    mesh.updateMatrixWorld?.(true);
    mesh.getWorldPosition(_mediaPos);
    mesh.getWorldQuaternion(_tmpQuat);
    _outward.set(0, 0, 1).applyQuaternion(_tmpQuat).normalize();
    _mediaUp.set(0, 1, 0).applyQuaternion(_tmpQuat).normalize();
    if (_outward.lengthSq() < 1e-8) _outward.set(0, 0.1, 1).normalize();
    // Keep up orthogonal to view so lookAt has no twist
    _mediaUp.addScaledVector(_outward, -_mediaUp.dot(_outward));
    if (_mediaUp.lengthSq() < 1e-8) _mediaUp.copy(_worldUp);
    else _mediaUp.normalize();

    focusLookAt = _mediaPos.clone();
    const R = sphereRadius();
    const near = THREE.MathUtils.clamp(R * EXIT_CENTER_FRAC, 6, 14);
    _camPos.copy(_outward).multiplyScalar(near);
    return {
      cam: _camPos.clone(),
      target: _mediaPos.clone(),
      up: _mediaUp.clone(),
    };
  }

  /** Face the photo without OrbitControls Y-up reset. */
  function applyParkView(park) {
    camera.position.copy(park.cam);
    camera.up.copy(park.up || _worldUp);
    controls.target.copy(park.target);
    camera.lookAt(park.target);
  }

  function exitCameraPose() {
    const R = sphereRadius();
    if (focusLookAt) _mediaPos.copy(focusLookAt);
    else _mediaPos.set(0, 0, R);
    _outward.copy(_mediaPos).normalize();
    if (_outward.lengthSq() < 1e-8) _outward.set(0, 0.1, 1).normalize();
    const near = THREE.MathUtils.clamp(R * EXIT_CENTER_FRAC, 6, 14);
    _camPos.copy(_outward).multiplyScalar(-near);
    return { cam: _camPos.clone(), target: new THREE.Vector3(0, 0, 0) };
  }

  /** Radial camera move (dir + radius) — clean arcs, no chords through the shell. */
  function animateCameraRadial(toCam, toTarget, duration) {
    return new Promise((resolve) => {
      killTween();
      _startCam.copy(camera.position);
      _startTarget.copy(controls.target);
      const fromLen = Math.max(_startCam.length(), 1e-4);
      const toLen = Math.max(toCam.length(), 1e-4);
      _startDir.copy(_startCam).multiplyScalar(1 / fromLen);
      _endDir.copy(toCam).normalize();

      if (typeof gsap === "undefined") {
        camera.position.copy(toCam);
        controls.target.copy(toTarget);
        controls.update();
        resolve();
        return;
      }

      const state = { t: 0 };
      activeTween = gsap.to(state, {
        t: 1,
        duration,
        ease: EASE,
        onUpdate: () => {
          const t = state.t;
          _dir.lerpVectors(_startDir, _endDir, t);
          if (_dir.lengthSq() < 1e-8) _dir.copy(_endDir);
          else _dir.normalize();
          camera.position.copy(_dir).multiplyScalar(THREE.MathUtils.lerp(fromLen, toLen, t));
          controls.target.lerpVectors(_startTarget, toTarget, t);
          controls.update();
        },
        onComplete: () => {
          activeTween = null;
          resolve();
        },
      });
    });
  }

  /**
   * Fluid orbit into the photo (gigadesign-style):
   * spherical lerp around the image + exponential camera follow.
   * Camera always looks at the photo.
   */
  function approachFromOutside(park) {
    return new Promise((resolve) => {
      killTween();
      _startCam.copy(camera.position);
      _startUp.copy(camera.up).normalize();
      const endUp = park.up || _worldUp;
      const pivot = park.target;

      // Orbit relative to the photo so gaze stays locked on it
      _dir.copy(_startCam).sub(pivot);
      if (_dir.lengthSq() < 1e-8) _dir.set(0, 0.2, 1);
      _sph0.setFromVector3(_dir);
      _dir.copy(park.cam).sub(pivot);
      if (_dir.lengthSq() < 1e-8) _dir.copy(pivot).normalize().multiplyScalar(-1);
      _sph1.setFromVector3(_dir);

      let dTheta = _sph1.theta - _sph0.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;

      if (typeof gsap === "undefined") {
        applyParkView(park);
        resolve();
        return;
      }

      const state = { u: 0 };
      let lastT = performance.now();
      activeTween = gsap.to(state, {
        u: 1,
        duration: APPROACH_DURATION,
        ease: "power2.inOut",
        onUpdate: () => {
          const now = performance.now();
          const dt = Math.min(64, Math.max(0, now - lastT));
          lastT = now;
          const e = state.u;

          _sph.radius = THREE.MathUtils.lerp(_sph0.radius, _sph1.radius, e);
          _sph.phi = THREE.MathUtils.lerp(_sph0.phi, _sph1.phi, e);
          _sph.theta = _sph0.theta + dTheta * e;
          _sph.makeSafe();

          _guideLook.copy(pivot);
          _guideCam.setFromSpherical(_sph).add(_guideLook);

          // Soft follow — kills the mechanical step feel
          const k = 1 - Math.exp((-APPROACH_FOLLOW * dt) / 1000);
          camera.position.lerp(_guideCam, k);
          controls.target.lerp(_guideLook, Math.min(1, k * 1.15));
          _camUp.lerpVectors(_startUp, endUp, e).normalize();
          camera.up.copy(_camUp);
          camera.lookAt(controls.target);
        },
        onComplete: () => {
          activeTween = null;
          applyParkView(park);
          resolve();
        },
      });
    });
  }

  /** Same morph curve for every media (inside + outside). */
  function morphEase(t) {
    const u = THREE.MathUtils.clamp(t, 0, 1);
    return u * u * (3 - 2 * u);
  }

  function beginInspectMesh(mesh) {
    captureCurved(mesh);
    pullToScene(mesh);
    mesh.userData.inspectLock = true;
    mesh.userData.focusRenderOrder = mesh.renderOrder;
    mesh.renderOrder = 10000;
    mesh.userData.inspectFlat = false;
  }

  function finishInspectMesh(mesh, park, endScale) {
    flattenGeometry(mesh.geometry);
    mesh.userData.inspectFlat = true;
    mesh.geometry.computeVertexNormals();
    applyParkView(park);
    const pose = framePose();
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    mesh.scale.setScalar(endScale);
  }

  function applyInspectMorph(mesh, park, mt, startScale, endScale, dimList) {
    applyParkView(park);
    const pose = framePose();
    mesh.position.lerpVectors(_startPos, pose.position, mt);
    _endQuat.copy(pose.quaternion);
    _tmpQuat.copy(_startQuat).slerp(_endQuat, mt);
    mesh.quaternion.copy(_tmpQuat);
    mesh.scale.setScalar(THREE.MathUtils.lerp(startScale, endScale, mt));
    morphGeometry(mesh, mt);
    const dim = THREE.MathUtils.lerp(1, DIM_OPACITY, THREE.MathUtils.smoothstep(mt, 0, 0.9));
    for (const m of dimList) setMeshOpacity(m, dim);
  }

  /**
   * Inside only: slowly, smoothly bring the photo to center.
   * Does not touch zoom/morph speed (that's morphIntoInspect / FOCUS_DURATION).
   */
  function faceMediaFromInside(park) {
    return new Promise((resolve) => {
      killTween();
      _startCam.copy(camera.position);
      _startTarget.copy(controls.target);
      _startUp.copy(camera.up).normalize();
      const endUp = park.up || _worldUp;

      if (typeof gsap === "undefined") {
        applyParkView(park);
        resolve();
        return;
      }

      const state = { u: 0 };
      activeTween = gsap.to(state, {
        u: 1,
        duration: FACE_INSIDE_DURATION,
        ease: "sine.inOut",
        onUpdate: () => {
          const e = state.u;
          camera.position.lerpVectors(_startCam, park.cam, e);
          controls.target.lerpVectors(_startTarget, park.target, e);
          _camUp.lerpVectors(_startUp, endUp, e).normalize();
          camera.up.copy(_camUp);
          camera.lookAt(controls.target);
        },
        onComplete: () => {
          activeTween = null;
          applyParkView(park);
          resolve();
        },
      });
    });
  }

  /** Inside: faster recenter, then faster zoom/rotation. */
  async function inspectFromInside(mesh, park) {
    await faceMediaFromInside(park);
    if (!focused) return;
    approaching = false;
    for (const m of getMeshes?.() || []) {
      if (m && !m.userData?.slideshowLock) m.scale.setScalar(1);
    }
    await morphIntoInspect(mesh, park, FOCUS_INSIDE_DURATION);
  }

  /**
   * Shared media rotation/zoom. Optional duration (inside uses a quicker one).
   */
  function morphIntoInspect(mesh, park, duration = FOCUS_DURATION) {
    return new Promise((resolve) => {
      killTween();
      applyParkView(park);
      beginInspectMesh(mesh);

      _startPos.copy(mesh.position);
      _startQuat.copy(mesh.quaternion);
      const startScale = mesh.scale.x;
      const endScale = flatScale(mesh);
      const dimList = dimOthers(mesh);

      if (typeof gsap === "undefined") {
        finishInspectMesh(mesh, park, endScale);
        for (const m of dimList) setMeshOpacity(m, DIM_OPACITY);
        resolve();
        return;
      }

      const state = { t: 0 };
      activeTween = gsap.to(state, {
        t: 1,
        duration,
        ease: FOCUS_EASE,
        onUpdate: () => {
          const mt = morphEase(state.t);
          applyInspectMorph(mesh, park, mt, startScale, endScale, dimList);
        },
        onComplete: () => {
          activeTween = null;
          finishInspectMesh(mesh, park, endScale);
          resolve();
        },
      });
    });
  }

  /** Reverse morph: flat framed → curved on sphere, camera to center. */
  function morphOutInspect(mesh) {
    return new Promise((resolve) => {
      killTween();
      const home = homeWorldPose(mesh);
      const exit = exitCameraPose();

      if (!mesh.geometry.userData.inspectCurved) {
        const s = mesh.userData.mediaScale || 1;
        bendGeometry(mesh.geometry, sphereRadius(), s);
        captureCurved(mesh);
        flattenGeometry(mesh.geometry);
      }

      _startCam.copy(camera.position);
      _startTarget.copy(controls.target);
      _startPos.copy(mesh.position);
      _startQuat.copy(mesh.quaternion);
      const startScale = mesh.scale.x;
      const dimList = (getMeshes?.() || []).filter((m) => m?.userData?._inspectDimmed);

      if (typeof gsap === "undefined") {
        shelveMesh(mesh);
        camera.position.copy(exit.cam);
        controls.target.copy(exit.target);
        controls.update();
        restoreDimFlags();
        resolve();
        return;
      }

      const state = { t: 0 };
      activeTween = gsap.to(state, {
        t: 1,
        duration: UNFOCUS_DURATION,
        ease: EASE,
        onUpdate: () => {
          const t = state.t;
          camera.position.lerpVectors(_startCam, exit.cam, t);
          controls.target.lerpVectors(_startTarget, exit.target, t);
          controls.update();

          mesh.position.lerpVectors(_startPos, home.position, t);
          _tmpQuat.copy(_startQuat).slerp(home.quaternion, t);
          mesh.quaternion.copy(_tmpQuat);
          mesh.scale.setScalar(THREE.MathUtils.lerp(startScale, home.scale, t));

          morphGeometry(mesh, 1 - t);

          // Gradually restore others as we leave inspect
          const dimT = THREE.MathUtils.smoothstep(t, 0.1, 1);
          const dim = THREE.MathUtils.lerp(DIM_OPACITY, 1, dimT);
          for (const m of dimList) setMeshOpacity(m, dim);
        },
        onComplete: () => {
          activeTween = null;
          shelveMesh(mesh);
          const active = getMeshes?.() || [];
          mesh.visible = active.includes(mesh);
          for (const m of dimList) setMeshOpacity(m, 1);
          restoreDimFlags();
          resolve();
        },
      });
    });
  }

  async function focus(mesh) {
    if (!mesh || animating) return;
    if (focused === mesh) return;
    if (focused && focused !== mesh) {
      await unfocus({ resumeNav: false });
    }
    if (animating) return;

    focused = mesh;
    animating = true;
    approaching = true;
    // Freeze sphere spin so the photo stays put while we face it
    setInspecting(true);
    if (controls) controls.enabled = false;
    hideCaption();

    const park = parkPoseForMedia(mesh);
    const R = sphereRadius();
    const outside = camera.position.length() > R * 0.85;

    if (outside) {
      // Outside: fly in always looking at the photo, then morph
      await approachFromOutside(park);
      if (!focused) {
        approaching = false;
        animating = false;
        return;
      }
      applyParkView(park);
      approaching = false;
      for (const m of getMeshes?.() || []) {
        if (m && !m.userData?.slideshowLock) m.scale.setScalar(1);
      }
      await morphIntoInspect(mesh, park);
    } else {
      // Inside: rotation/morph starts early while camera centers
      await inspectFromInside(mesh, park);
    }

    if (!focused) {
      approaching = false;
      animating = false;
      return;
    }

    showCaption(mesh);
    animating = false;
  }

  async function unfocus({ resumeNav = true } = {}) {
    if (!isInspectingMedia && !focused) return;
    if (animating) return;
    animating = true;

    const mesh = focused;
    hideCaption();
    focused = null;

    if (mesh) await morphOutInspect(mesh);
    else {
      const exit = exitCameraPose();
      if (typeof gsap !== "undefined") {
        await new Promise((resolve) => {
          const state = {
            cx: camera.position.x,
            cy: camera.position.y,
            cz: camera.position.z,
            tx: controls.target.x,
            ty: controls.target.y,
            tz: controls.target.z,
          };
          activeTween = gsap.to(state, {
            cx: exit.cam.x,
            cy: exit.cam.y,
            cz: exit.cam.z,
            tx: exit.target.x,
            ty: exit.target.y,
            tz: exit.target.z,
            duration: UNFOCUS_DURATION,
            ease: EASE,
            onUpdate: () => {
              camera.position.set(state.cx, state.cy, state.cz);
              controls.target.set(state.tx, state.ty, state.tz);
              controls.update();
            },
            onComplete: () => {
              activeTween = null;
              resolve();
            },
          });
        });
      }
      restoreDimFlags();
    }

    focusLookAt = null;
    animating = false;
    setInspecting(false);
    if (resumeNav && controls && isEnabled?.()) controls.enabled = true;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (!isEnabled?.() && !isInspectingMedia) return;
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
    downValid = true;
  }

  function onPointerUp(e) {
    if (!downValid || e.button !== 0) return;
    downValid = false;

    const dt = performance.now() - downT;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dt > CLICK_MAX_MS || dist > CLICK_MAX_DIST) return;
    if (!isEnabled?.() && !isInspectingMedia) return;

    const hit = pick(e);

    if (isInspectingMedia) {
      if (!hit || hit !== focused) void unfocus();
      return;
    }

    if (hit) void focus(hit);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && isInspectingMedia) {
      e.preventDefault();
      void unfocus();
    }
  }

  function bind(el) {
    domElement = el;
    if (!domElement) return;
    domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function dispose() {
    killTween();
    hideCaption();
    if (domElement) domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    if (focused) shelveMesh(focused);
    restoreDimFlags();
    focused = null;
    if (isInspectingMedia) setInspecting(false);
  }

  return {
    bind,
    dispose,
    focus,
    unfocus,
    pick,
    layoutCaption,
    get focused() {
      return focused;
    },
    get animating() {
      return animating;
    },
    get isInspectingMedia() {
      return isInspectingMedia;
    },
    get isApproaching() {
      return approaching;
    },
  };
}
