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
const FOCUS_DURATION = 1.35;
const UNFOCUS_DURATION = 1.25;
/**
 * Outside approach: horizontal circumnavigation outside the shell,
 * lateral entry beside the photo, then a smooth turn to face it.
 */
const APPROACH_DURATION = 3.6;
const EXIT_CENTER_FRAC = 0.18;
const FRAME_DIST = 5.35;
const DESIRED_H = 2.15;
/** Others fully hidden while inspecting. */
const DIM_OPACITY = 0;
const EASE = "sine.inOut";
const APPROACH_EASE = "sine.inOut";
/** Keep this clearance outside the sphere while orbiting. */
const SKIM_FRAC = 1.22;

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
  const _gateDir = new THREE.Vector3();
  const _mediaDir = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);
  const _origin = new THREE.Vector3(0, 0, 0);

  let focused = null;
  let animating = false;
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
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _pos.copy(camera.position).addScaledVector(_fwd, FRAME_DIST).addScaledVector(_up, 0.06);
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

  function parkPoseForMedia(mesh) {
    mesh.getWorldPosition(_mediaPos);
    const R = sphereRadius();
    _outward.copy(_mediaPos).normalize();
    if (_outward.lengthSq() < 1e-8) _outward.set(0, 0.1, 1).normalize();
    focusLookAt = _mediaPos.clone();
    const near = THREE.MathUtils.clamp(R * EXIT_CENTER_FRAC, 6, 14);
    _camPos.copy(_outward).multiplyScalar(near);
    return { cam: _camPos.clone(), target: _mediaPos.clone() };
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

  function shortestAzimuthDelta(a0, a1) {
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Horizontal orbit around Y: azimuth blend + soft elevation blend. */
  function dirFromAzimuthElev(azimuth, y, out) {
    const yy = THREE.MathUtils.clamp(y, -0.95, 0.95);
    const xz = Math.sqrt(Math.max(0, 1 - yy * yy));
    out.set(Math.sin(azimuth) * xz, yy, Math.cos(azimuth) * xz);
    return out.normalize();
  }

  /** Side gate beside the photo (horizontal perpendicular), closer to the camera. */
  function lateralGateDir(mediaDir, fromDir, out) {
    out.crossVectors(mediaDir, _worldUp);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    else out.normalize();
    const aFrom = Math.atan2(fromDir.x, fromDir.z);
    const aPos = Math.atan2(out.x, out.z);
    const aNeg = Math.atan2(-out.x, -out.z);
    if (Math.abs(shortestAzimuthDelta(aFrom, aNeg)) < Math.abs(shortestAzimuthDelta(aFrom, aPos))) {
      out.negate();
    }
    const y = THREE.MathUtils.clamp(mediaDir.y * 0.35, -0.35, 0.35);
    const xz = Math.sqrt(Math.max(0, 1 - y * y));
    const lenXZ = Math.hypot(out.x, out.z) || 1;
    out.set((out.x / lenXZ) * xz, y, (out.z / lenXZ) * xz).normalize();
    return out;
  }

  /**
   * One continuous horizontal path: orbit outside → lateral entry while
   * already easing the gaze toward the photo (no snap between phases).
   */
  function approachFromOutside(park) {
    return new Promise((resolve) => {
      killTween();
      const R = sphereRadius();
      const skim = R * SKIM_FRAC;
      const near = Math.max(park.cam.length(), R * EXIT_CENTER_FRAC);

      _startCam.copy(camera.position);
      _startTarget.copy(controls.target);
      if (_startCam.lengthSq() < 1e-8) _startCam.set(0, 0.2, 1);
      const fromLen = Math.max(_startCam.length(), skim);
      _startDir.copy(_startCam).normalize();

      _mediaDir.copy(park.target);
      if (_mediaDir.lengthSq() < 1e-8) _mediaDir.copy(park.cam);
      _mediaDir.normalize();
      lateralGateDir(_mediaDir, _startDir, _gateDir);

      const a0 = Math.atan2(_startDir.x, _startDir.z);
      const aGate = Math.atan2(_gateDir.x, _gateDir.z);
      const aMedia = Math.atan2(_mediaDir.x, _mediaDir.z);
      const d0 = shortestAzimuthDelta(a0, aGate);
      const d1 = shortestAzimuthDelta(aGate, aMedia);
      const y0 = _startDir.y;
      const yGate = _gateDir.y;
      const yMedia = _mediaDir.y;

      if (typeof gsap === "undefined") {
        camera.position.copy(park.cam);
        controls.target.copy(park.target);
        controls.update();
        resolve();
        return;
      }

      const state = { t: 0 };
      activeTween = gsap.to(state, {
        t: 1,
        duration: APPROACH_DURATION,
        ease: APPROACH_EASE,
        onUpdate: () => {
          const t = state.t;

          // Wider smoothsteps = longer overlaps, less perceptible transitions
          const leg1 = THREE.MathUtils.smoothstep(t, 0, 0.62);
          const leg2 = THREE.MathUtils.smoothstep(t, 0.28, 1);
          const azimuth = a0 + d0 * leg1 + d1 * leg2;
          const elev = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(y0, yGate, leg1),
            THREE.MathUtils.lerp(yGate, yMedia, leg2),
            THREE.MathUtils.smoothstep(t, 0.25, 1)
          );
          dirFromAzimuthElev(azimuth, elev, _dir);

          const toSkim = THREE.MathUtils.smoothstep(t, 0, 0.48);
          const toInside = THREE.MathUtils.smoothstep(t, 0.32, 0.95);
          let len = THREE.MathUtils.lerp(fromLen, skim, toSkim);
          len = THREE.MathUtils.lerp(len, near, toInside);
          if (t < 0.36) len = Math.max(len, skim);

          camera.position.copy(_dir).multiplyScalar(len);

          const toCenter = THREE.MathUtils.smoothstep(t, 0, 0.55);
          const toPhoto = THREE.MathUtils.smoothstep(t, 0.22, 1);
          _pos.lerpVectors(_startTarget, _origin, toCenter);
          controls.target.lerpVectors(_pos, park.target, toPhoto);
          controls.update();
        },
        onComplete: () => {
          activeTween = null;
          camera.position.copy(park.cam);
          controls.target.copy(park.target);
          controls.update();
          resolve();
        },
      });
    });
  }

  /**
   * One continuous flight: camera + mesh pose + unbend morph + dim.
   * Masks the sphere→flat handoff. Assumes camera already inside.
   */
  function morphIntoInspect(mesh, park) {
    return new Promise((resolve) => {
      killTween();
      captureCurved(mesh);
      pullToScene(mesh);
      mesh.userData.inspectLock = true;
      mesh.userData.focusRenderOrder = mesh.renderOrder;
      mesh.renderOrder = 10000;
      mesh.userData.inspectFlat = false;

      _startCam.copy(camera.position);
      _startTarget.copy(controls.target);
      _startPos.copy(mesh.position);
      _startQuat.copy(mesh.quaternion);
      const startScale = mesh.scale.x;
      const endScale = flatScale(mesh);
      // Opacity of siblings drops with zoom+rotation (not during outside approach)
      const dimList = dimOthers(mesh);

      if (typeof gsap === "undefined") {
        camera.position.copy(park.cam);
        controls.target.copy(park.target);
        controls.update();
        const pose = framePose();
        mesh.position.copy(pose.position);
        mesh.quaternion.copy(pose.quaternion);
        mesh.scale.setScalar(endScale);
        flattenGeometry(mesh.geometry);
        mesh.userData.inspectFlat = true;
        for (const m of dimList) setMeshOpacity(m, DIM_OPACITY);
        resolve();
        return;
      }

      const state = { t: 0 };
      activeTween = gsap.to(state, {
        t: 1,
        duration: FOCUS_DURATION,
        ease: EASE,
        onUpdate: () => {
          const t = state.t;
          camera.position.lerpVectors(_startCam, park.cam, t);
          controls.target.lerpVectors(_startTarget, park.target, t);
          controls.update();

          const pose = framePose();
          mesh.position.lerpVectors(_startPos, pose.position, t);
          _endQuat.copy(pose.quaternion);
          _tmpQuat.copy(_startQuat).slerp(_endQuat, t);
          mesh.quaternion.copy(_tmpQuat);
          mesh.scale.setScalar(THREE.MathUtils.lerp(startScale, endScale, t));

          morphGeometry(mesh, t);

          const dim = THREE.MathUtils.lerp(1, DIM_OPACITY, t);
          for (const m of dimList) setMeshOpacity(m, dim);
        },
        onComplete: () => {
          activeTween = null;
          flattenGeometry(mesh.geometry);
          mesh.userData.inspectFlat = true;
          mesh.geometry.computeVertexNormals();
          const pose = framePose();
          mesh.position.copy(pose.position);
          mesh.quaternion.copy(pose.quaternion);
          mesh.scale.setScalar(endScale);
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
    setInspecting(true);
    if (controls) controls.enabled = false;
    hideCaption();

    for (const m of getMeshes?.() || []) {
      if (m && !m.userData?.slideshowLock) m.scale.setScalar(1);
    }

    mesh.getWorldPosition(_mediaPos);
    focusLookAt = _mediaPos.clone();
    const park = parkPoseForMedia(mesh);
    const R = sphereRadius();
    const outside = camera.position.length() > R * 0.85;

    // From outside: enter + face photo in one soft move, then same zoom+rotation
    if (outside) {
      await approachFromOutside(park);
      if (!focused) {
        animating = false;
        return;
      }
    }

    await morphIntoInspect(mesh, park);
    if (!focused) {
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
  };
}
