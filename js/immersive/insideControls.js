/**
 * Navigazione sfera:
 * - drag → ruota lo sguardo
 * - wheel → zoom out (overview) ↔ centro ↔ zoom in (parete)
 * - lo sguardo resta sulla stessa parete (niente flip / salto foto)
 */

import * as THREE from "three";

export function createInsideControls(
  camera,
  domElement,
  {
    getRadius = () => 56,
    /** Gruppo sfera: serve ad ancorare lo sguardo alle foto mentre ruota. */
    getSphereGroup = () => null,
    centerDistance = 0.12,
    wallMargin = 0.55,
    outsidePadding = 1.45,
    rotateSpeed = 0.0045,
    zoomSpeed = 2.8,
    wallLockZoom = 0.72,
  } = {}
) {
  let enabled = false;
  /**
   * 0 = overview (lato opposto), CENTER_ZOOM = centro, 1 = parete
   */
  const CENTER_ZOOM = 0.45;
  let zoom = CENTER_ZOOM;
  let dragging = false;
  let prevX = 0;
  let prevY = 0;

  /** Direzione di mira in spazio locale della sfera (segue le foto). */
  const localAim = new THREE.Vector3(0, 0, 1);
  const _aim = new THREE.Vector3();
  const _focus = new THREE.Vector3();
  const _qInv = new THREE.Quaternion();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);

  function outsideDistance() {
    const R = getRadius();
    const fov = (camera.fov * Math.PI) / 180;
    const fitH = R / Math.tan(fov / 2);
    const fitW = R / (Math.tan(fov / 2) * Math.max(camera.aspect, 0.2));
    return Math.max(fitH, fitW) * outsidePadding;
  }

  function wallDistance() {
    return Math.max(centerDistance + 0.5, getRadius() - wallMargin);
  }

  function updateWorldAim() {
    const g = getSphereGroup?.();
    _aim.copy(localAim);
    if (g) _aim.applyQuaternion(g.quaternion);
    _aim.normalize();
    return _aim;
  }

  function setLocalFromWorld(worldDir) {
    const g = getSphereGroup?.();
    localAim.copy(worldDir).normalize();
    if (g) {
      _qInv.copy(g.quaternion).invert();
      localAim.applyQuaternion(_qInv).normalize();
    }
  }

  /**
   * Distanza lungo l’asse di mira:
   * negativa = overview dal lato opposto, ~0 = centro, positiva = verso la parete.
   * lookAt sempre sulla stessa parete → niente ribaltamento a 180°.
   */
  function distanceFromZoom() {
    if (zoom <= CENTER_ZOOM) {
      const t = CENTER_ZOOM <= 1e-6 ? 1 : zoom / CENTER_ZOOM;
      return THREE.MathUtils.lerp(-outsideDistance(), centerDistance, t);
    }
    const t = (zoom - CENTER_ZOOM) / (1 - CENTER_ZOOM);
    return THREE.MathUtils.lerp(centerDistance, wallDistance(), t);
  }

  function apply() {
    zoom = Math.min(1, Math.max(0, zoom));
    const aim = updateWorldAim();
    const R = getRadius();
    _focus.copy(aim).multiplyScalar(R);

    let dist = distanceFromZoom();
    // Evita lo zero esatto (lookAt degenerato)
    if (Math.abs(dist) < 0.06) dist = dist < 0 ? -0.06 : 0.06;

    camera.position.copy(aim).multiplyScalar(dist);
    _up.copy(_worldUp);
    if (Math.abs(aim.dot(_worldUp)) > 0.92) _up.set(0, 0, 1);
    camera.up.copy(_up);
    camera.lookAt(_focus);
  }

  function isZoomedIn() {
    return zoom >= wallLockZoom;
  }

  function syncLookFromCamera() {
    if (camera.position.lengthSq() > 1e-8) {
      setLocalFromWorld(camera.position);
    } else {
      camera.getWorldDirection(_aim);
      if (_aim.lengthSq() < 1e-8) _aim.set(0, 0, 1);
      setLocalFromWorld(_aim);
    }
    zoom = CENTER_ZOOM;
    apply();
  }

  function onPointerDown(e) {
    if (!enabled || e.button !== 0) return;
    dragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
    domElement.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!enabled || !dragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;

    // Ruota la mira in spazio mondo, poi riporta in locale sfera
    const aim = updateWorldAim();
    _right.crossVectors(_worldUp, aim);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(aim, _right).normalize();

    // Fuori (dist < 0) l’orbita è invertita rispetto a dentro: correggi il segno
    const dist = distanceFromZoom();
    const s = dist < 0 ? -1 : 1;
    aim.applyAxisAngle(_up, -dx * rotateSpeed * s);
    aim.applyAxisAngle(_right, -dy * rotateSpeed * s);
    aim.normalize();
    setLocalFromWorld(aim);
    apply();
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    try {
      domElement.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    // Passi più piccoli vicino alla soglia centro per evitare scatti
    const nearCenter = Math.abs(zoom - CENTER_ZOOM) < 0.08;
    const damp = nearCenter ? 0.55 : 1;
    const step = -e.deltaY * 0.0009 * zoomSpeed * damp;
    zoom = Math.min(1, Math.max(0, zoom + step));
    apply();
  }

  domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  domElement.addEventListener("wheel", onWheel, { passive: false });

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = !!v;
      if (enabled) syncLookFromCamera();
    },
    isZoomedIn,
    /** Aggiorna la posa seguendo la rotazione sfera (stesse foto). */
    update() {
      if (enabled) apply();
    },
    resetToCenter() {
      zoom = CENTER_ZOOM;
      apply();
    },
    syncLookFromCamera,
    apply,
  };
}
