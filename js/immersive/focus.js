/**
 * Raycast pick + foreground focus animation (no HTML popups).
 */

import * as THREE from "three";

export function createFocusController({ camera, controls }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let focused = null;
  let animating = false;

  function setPointerFromEvent(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  function pick(mediaMeshes, event) {
    if (!mediaMeshes?.length) return null;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(mediaMeshes, false);
    return hits[0]?.object || null;
  }

  function foregroundPose() {
    const local = new THREE.Vector3(0, 0, -8.5);
    const worldPos = local.applyMatrix4(camera.matrixWorld);
    return { position: worldPos, quaternion: camera.quaternion.clone(), scale: 2.35 };
  }

  function focus(mesh) {
    if (!mesh || animating) return Promise.resolve();
    if (focused && focused !== mesh) {
      return unfocus().then(() => focus(mesh));
    }
    if (focused === mesh) return Promise.resolve();

    focused = mesh;
    animating = true;
    if (controls) controls.enabled = false;

    const parent = mesh.parent;
    mesh.userData.focusParent = parent;
    parent.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    const scene = parent.parent;
    parent.remove(mesh);
    scene.add(mesh);
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    mesh.scale.copy(worldScale);

    return animateMesh(mesh, foregroundPose()).then(() => {
      animating = false;
    });
  }

  function unfocus() {
    if (!focused || animating) return Promise.resolve();
    const mesh = focused;
    animating = true;

    const parent = mesh.userData.focusParent;
    const homePos = mesh.userData.homePosition.clone();
    const homeQuat = mesh.userData.homeQuaternion.clone();
    const homeScale = mesh.userData.homeScale || 1;

    parent.updateMatrixWorld(true);
    const targetWorldPos = homePos.clone().applyMatrix4(parent.matrixWorld);
    const parentWorldQuat = new THREE.Quaternion();
    parent.getWorldQuaternion(parentWorldQuat);
    const targetWorldQuat = parentWorldQuat.clone().multiply(homeQuat);

    return animateMesh(mesh, {
      position: targetWorldPos,
      quaternion: targetWorldQuat,
      scale: homeScale,
    }).then(() => {
      mesh.parent.remove(mesh);
      parent.add(mesh);
      mesh.position.copy(homePos);
      mesh.quaternion.copy(homeQuat);
      mesh.scale.setScalar(homeScale);
      focused = null;
      animating = false;
      if (controls) controls.enabled = true;
    });
  }

  function animateMesh(mesh, { position, quaternion, scale }) {
    return new Promise((resolve) => {
      const fromQuat = mesh.quaternion.clone();

      if (typeof gsap === "undefined") {
        mesh.position.copy(position);
        mesh.quaternion.copy(quaternion);
        mesh.scale.setScalar(scale);
        resolve();
        return;
      }

      const state = {
        px: mesh.position.x,
        py: mesh.position.y,
        pz: mesh.position.z,
        s: mesh.scale.x,
        t: 0,
      };

      gsap.to(state, {
        px: position.x,
        py: position.y,
        pz: position.z,
        s: scale,
        t: 1,
        duration: 0.85,
        ease: "power3.inOut",
        onUpdate: () => {
          mesh.position.set(state.px, state.py, state.pz);
          mesh.scale.setScalar(state.s);
          mesh.quaternion.copy(fromQuat).slerp(quaternion, state.t);
        },
        onComplete: resolve,
      });
    });
  }

  return {
    pick,
    focus,
    unfocus,
    get focused() {
      return focused;
    },
    get animating() {
      return animating;
    },
  };
}
