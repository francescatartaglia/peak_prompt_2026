/**
 * Dentro la sfera:
 * - a riposo la camera resta al centro
 * - zoom in → verso la parete di fronte (si ferma poco prima)
 * - dezoom → torna al centro
 * - drag → scegli/ruota la direzione di sguardo (la parete davanti)
 */

import * as THREE from "three";

export function createInsideControls(
  camera,
  domElement,
  {
    getRadius = () => 56,
    /** Distanza dal centro a riposo (quasi 0). */
    centerDistance = 0.12,
    wallMargin = 0.55,
    rotateSpeed = 0.0045,
    zoomSpeed = 2.8,
  } = {}
) {
  let enabled = false;
  let theta = 0;
  let phi = Math.PI / 2;
  /** 0 = centro; 1 = max verso la parete. */
  let zoom = 0;
  let dragging = false;
  let prevX = 0;
  let prevY = 0;

  const _dir = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _sph = new THREE.Spherical();

  function maxTravel() {
    return Math.max(0.5, getRadius() - wallMargin - centerDistance);
  }

  function distanceFromZoom() {
    return centerDistance + zoom * maxTravel();
  }

  function apply() {
    zoom = Math.min(1, Math.max(0, zoom));
    phi = Math.min(Math.PI - 0.08, Math.max(0.08, phi));

    _dir.setFromSphericalCoords(1, phi, theta);
    const dist = distanceFromZoom();
    camera.position.copy(_dir).multiplyScalar(dist);

    // Parete di fronte (sempre verso fuori lungo lo sguardo)
    _look.copy(_dir).multiplyScalar(getRadius() * 2);
    camera.lookAt(_look);
  }

  /** Allinea lo sguardo a ciò che la camera sta già guardando (parete davanti). */
  function syncLookFromCamera() {
    camera.getWorldDirection(_fwd);
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
    _sph.setFromVector3(_fwd);
    theta = _sph.theta;
    phi = _sph.phi || Math.PI / 2;
    zoom = 0;
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
    // Ruota solo la direzione di sguardo; se zoom=0 resti al centro
    theta -= dx * rotateSpeed;
    phi -= dy * rotateSpeed;
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
    // Scroll su → zoom verso la parete; scroll giù → torna al centro
    const step = -e.deltaY * 0.0011 * zoomSpeed;
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
      if (enabled) {
        syncLookFromCamera();
      }
    },
    update() {
      if (enabled) apply();
    },
    /** Forza riposo al centro, mantenendo lo sguardo attuale. */
    resetToCenter() {
      zoom = 0;
      apply();
    },
    syncLookFromCamera,
    apply,
  };
}
