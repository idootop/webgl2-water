import * as THREE from "three";
import { Water } from "./water";
import { Renderer } from "./renderer";

// Global error handler
window.onerror = (event: Event | string) => {
  const errorHtml = String(event)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const loading = document.getElementById("loading");
  if (loading) {
    loading.innerHTML = errorHtml;
    loading.style.zIndex = "1";
  }
  return false;
};

let water: Water;
let skyTexture: THREE.Texture;
let renderer: Renderer;
let angleX = 90;
let angleY = 180;

// Sphere physics info
let useSpherePhysics = true;
let center: THREE.Vector3;
let oldCenter: THREE.Vector3;
let velocity: THREE.Vector3;
let gravity: THREE.Vector3;
let radius: number;
let paused = false;
let mousePoint = new THREE.Vector3(100, 100, 100);

// Three.js Core
const sceneRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);

let poolWidth = 2;
let poolLength = 2;
let containerHeight = 1.4; // Total height (walls)
let poolDepth = 0; // Current water depth (calculated)
let waterFillRatio = 0.7; // 0 to 1
let sphereFloatRatio = 0.7; // 0 to 1 (Ratio of diameter that is above water at equilibrium)
let sphereImpactStrength = 0.04; // New parameter to control impact force

function updatePoolDimensions() {
  const waterDepth = containerHeight * waterFillRatio;
  const wallHeight = containerHeight * (1 - waterFillRatio);

  // Update global poolDepth for physics checks (used in update() and dragging)
  poolDepth = waterDepth;

  renderer.updateDimensions(poolWidth, poolLength, waterDepth, wallHeight);
  water.updateDimensions(poolWidth, poolLength);
}

window.onload = function () {
  const ratio = window.devicePixelRatio || 1;
  const dist = 4;

  function onresize(): void {
    const width = innerWidth;
    const height = innerHeight;
    sceneRenderer.setSize(width, height);
    sceneRenderer.setPixelRatio(ratio);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Auto-resize pool to fill screen (top-down view)
    const visibleHeight = 2 * dist * Math.tan((45 * Math.PI) / 360);
    const visibleWidth = visibleHeight * camera.aspect;

    poolWidth = visibleWidth;
    poolLength = visibleHeight;
    updatePoolDimensions();
  }

  document.body.appendChild(sceneRenderer.domElement);
  sceneRenderer.setClearColor(new THREE.Color(0, 0, 0));

  // Check for floating point texture support
  if (
    !sceneRenderer.capabilities.isWebGL2 &&
    !sceneRenderer.extensions.get("OES_texture_float")
  ) {
    throw new Error(
      "Rendering to floating-point textures is required but not supported"
    );
  }
  // Linear filtering for float textures is also needed
  sceneRenderer.extensions.get("OES_texture_float_linear");

  function getEl(id: string): HTMLImageElement {
    const el = document.getElementById(id) as HTMLImageElement;
    if (!el) {
      throw new Error(`Could not find element with id: ${id}`);
    }
    return el;
  }

  water = new Water();
  renderer = new Renderer();
  renderer.loadDuck("/duck.glb");

  // 鼠标或倾斜设备时的回调（-1 to 1）
  // todo 验证移动端设备传感器
  const onMove = (ndcX: number, ndcY: number) => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, target)) {
      mousePoint.copy(target);
    }
  };

  window.addEventListener("mousemove", (e) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    onMove(x, y);
  });

  window.addEventListener("deviceorientation", (e) => {
    // Use gamma (left/right) for X and beta (front/back) for Z
    if (e.gamma === null || e.beta === null) return;

    const maxTilt = 30; // degrees
    const gamma = Math.min(Math.max(e.gamma, -maxTilt), maxTilt);
    const beta = Math.min(Math.max(e.beta, -maxTilt), maxTilt);

    const ndcX = gamma / maxTilt;
    const ndcY = -beta / maxTilt; // Tilt forward (positive beta) -> Top of screen (positive Y)

    // todo 驱动鸭子移动
    onMove(ndcX, ndcY);
  });

  const skyImg = getEl("sky");
  skyTexture = new THREE.Texture(skyImg);
  skyTexture.wrapS = THREE.ClampToEdgeWrapping;
  skyTexture.wrapT = THREE.ClampToEdgeWrapping;
  skyTexture.minFilter = THREE.LinearFilter;
  skyTexture.needsUpdate = true;

  center = new THREE.Vector3(0, 0, 0);
  oldCenter = new THREE.Vector3(0, 0, 0);
  velocity = new THREE.Vector3();
  gravity = new THREE.Vector3(0, -4, 0);
  radius = 0.25;

  for (let i = 0; i < 20; i++) {
    water.addDrop(
      sceneRenderer,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      0.03,
      i & 1 ? 0.01 : -0.01
    );
  }

  const loading = document.getElementById("loading");
  if (loading) {
    loading.innerHTML = "";
  }
  onresize();

  updatePoolDimensions();

  let prevTime = new Date().getTime();
  function animate(): void {
    const nextTime = new Date().getTime();
    if (!paused) {
      update((nextTime - prevTime) / 1000);
      draw();
    }
    prevTime = nextTime;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  window.onresize = onresize;

  let prevHit: THREE.Vector3;
  let planeNormal: THREE.Vector3;
  let mode = -1;
  const MODE_ADD_DROPS = 0;
  const MODE_MOVE_SPHERE = 1;
  const MODE_ORBIT_CAMERA = 2;

  let oldX: number, oldY: number;

  function getRay(x: number, y: number): THREE.Ray {
    const rect = sceneRenderer.domElement.getBoundingClientRect();
    const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((y - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    return raycaster.ray;
  }

  function startDrag(x: number, y: number): void {
    oldX = x;
    oldY = y;

    const ray = getRay(x, y);

    // hitTestSphere
    const sphere = new THREE.Sphere(center, radius);
    const sphereHit = ray.intersectSphere(sphere, new THREE.Vector3());

    if (sphereHit) {
      mode = MODE_MOVE_SPHERE;
      prevHit = sphereHit;
      planeNormal = camera.position
        .clone()
        .sub(new THREE.Vector3(0, 0, 0))
        .normalize()
        .negate();
      const viewDir = new THREE.Vector3();
      camera.getWorldDirection(viewDir);
      planeNormal = viewDir.negate();
    } else {
      // Plane interaction
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const pointOnPlane = new THREE.Vector3();
      const hit = ray.intersectPlane(plane, pointOnPlane);

      if (
        hit &&
        Math.abs(pointOnPlane.x) < poolWidth / 2 &&
        Math.abs(pointOnPlane.z) < poolLength / 2
      ) {
        mode = MODE_ADD_DROPS;
        duringDrag(x, y);
      } else {
        mode = MODE_ORBIT_CAMERA;
      }
    }
  }

  function duringDrag(x: number, y: number, fromTouch = false): void {
    switch (mode) {
      case MODE_ADD_DROPS: {
        const ray = getRay(x, y);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const pointOnPlane = new THREE.Vector3();
        const hit = ray.intersectPlane(plane, pointOnPlane);

        if (hit) {
          water.addDrop(
            sceneRenderer,
            pointOnPlane.x,
            pointOnPlane.z,
            0.03,
            0.02
          );
          if (paused) {
            water.updateNormals(sceneRenderer);
            renderer.updateCaustics(sceneRenderer, water);
          }
        }
        if (fromTouch) {
          x = (x / window.innerWidth) * 2 - 1;
          y = -(y / window.innerHeight) * 2 + 1;
          onMove(x, y);
        }
        break;
      }
      case MODE_MOVE_SPHERE: {
        const ray = getRay(x, y);
        // t = -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
        // This is intersection with a plane passing through prevHit with normal planeNormal.
        const dragPlane = new THREE.Plane();
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal, prevHit);

        const nextHit = new THREE.Vector3();
        const hit = ray.intersectPlane(dragPlane, nextHit);

        if (hit) {
          center.add(nextHit.clone().sub(prevHit));
          center.x = Math.max(
            radius - poolWidth / 2,
            Math.min(poolWidth / 2 - radius, center.x)
          );
          center.y = Math.max(radius - poolDepth, Math.min(10, center.y));
          center.z = Math.max(
            radius - poolLength / 2,
            Math.min(poolLength / 2 - radius, center.z)
          );
          prevHit = nextHit;
          if (paused) renderer.updateCaustics(sceneRenderer, water);
        }
        break;
      }
      case MODE_ORBIT_CAMERA: {
        angleY -= x - oldX;
        angleX -= y - oldY;
        angleX = Math.max(-89.999, Math.min(89.999, angleX));
        break;
      }
    }
    oldX = x;
    oldY = y;
    if (paused) draw();
  }

  function stopDrag(): void {
    mode = -1;
  }

  document.onmousedown = function (e: MouseEvent): void {
    // e.preventDefault(); // Might block interaction?
    startDrag(e.pageX, e.pageY);
  };

  document.onmousemove = function (e: MouseEvent): void {
    duringDrag(e.pageX, e.pageY);
  };

  document.onmouseup = function (): void {
    stopDrag();
  };

  document.ontouchstart = function (e: TouchEvent): void {
    if (e.touches.length === 1) {
      e.preventDefault();
      startDrag(e.touches[0].pageX, e.touches[0].pageY);
    }
  };

  document.ontouchmove = function (e: TouchEvent): void {
    if (e.touches.length === 1) {
      duringDrag(e.touches[0].pageX, e.touches[0].pageY, true);
    }
  };

  document.ontouchend = function (e: TouchEvent): void {
    if (e.touches.length == 0) {
      stopDrag();
    }
  };

  let frame = 0;

  function update(seconds: number): void {
    if (seconds > 1) return;
    frame += seconds * 2;

    // 1. Physics Update
    if (mode == MODE_MOVE_SPHERE) {
      velocity.set(0, 0, 0);
    } else if (useSpherePhysics) {
      // Get water info at current position for buoyancy
      const waterInfo = water.getWaterAt(sceneRenderer, center.x, center.z);
      const waterHeight = waterInfo.height;

      const percentUnderWater = Math.max(
        0,
        Math.min(1, (waterHeight + radius - center.y) / (2 * radius))
      );

      const buoyancyFactor = 1.0 / (1.0 - sphereFloatRatio);

      // Gravity and Buoyancy (Vertical)
      const gTerm = gravity
        .clone()
        .multiplyScalar(seconds - buoyancyFactor * seconds * percentUnderWater);
      velocity.add(gTerm);

      // Mouse Interaction (Repulsion)
      if (mousePoint) {
        const distVec = center.clone().sub(mousePoint);
        distVec.y = 0; // Horizontal only
        const dist = distVec.length();
        const influenceRadius = 1;

        if (dist < influenceRadius) {
          const pushStrength = 2.0;
          // Closer = stronger push
          const force = distVec
            .normalize()
            .multiplyScalar(
              pushStrength * (1.0 - dist / influenceRadius) * seconds
            );
          velocity.add(force);
        }
      }

      if (velocity.lengthSq() > 0) {
        const drag = velocity
          .clone()
          .normalize()
          .multiplyScalar(percentUnderWater * seconds * velocity.dot(velocity));
        velocity.sub(drag);
      }

      center.add(velocity.clone().multiplyScalar(seconds));

      // Wall collision (X)
      if (center.x < radius - poolWidth / 2) {
        center.x = radius - poolWidth / 2;
        velocity.x = Math.abs(velocity.x) * 0.5;
      } else if (center.x > poolWidth / 2 - radius) {
        center.x = poolWidth / 2 - radius;
        velocity.x = -Math.abs(velocity.x) * 0.5;
      }

      // Wall collision (Z)
      if (center.z < radius - poolLength / 2) {
        center.z = radius - poolLength / 2;
        velocity.z = Math.abs(velocity.z) * 0.5;
      } else if (center.z > poolLength / 2 - radius) {
        center.z = poolLength / 2 - radius;
        velocity.z = -Math.abs(velocity.z) * 0.5;
      }

      // Floor collision
      if (center.y < radius - poolDepth) {
        center.y = radius - poolDepth;
        velocity.y = Math.abs(velocity.y) * 0.7;
      }
    }

    // 2. Duck Visual Update
    renderer.duckPosition.copy(center);
    renderer.duckPosition.y -= 0.1; // Visual tweak

    // Calculate rotation: Yaw ONLY (Horizontal rotation)
    // Up vector is always global Y (0, 1, 0)
    const Y = new THREE.Vector3(0, 1, 0);
    let Z = velocity.clone();
    Z.y = 0; // Ignore vertical velocity for rotation

    // If horizontal velocity is small, maintain current heading
    if (Z.lengthSq() < 0.001) {
      Z = new THREE.Vector3(0, 0, 1).applyQuaternion(renderer.duckQuaternion);
      Z.y = 0;
    }
    Z.normalize();

    // Calculate Right vector X
    const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    // Re-calculate Z to ensure orthogonality (though Z is already horizontal)
    Z.crossVectors(X, Y).normalize();

    const targetRot = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(X, Y, Z)
    );

    renderer.duckQuaternion.slerp(targetRot, 0.05);

    // 3. Water Simulation Interaction
    water.moveSphere(
      sceneRenderer,
      oldCenter,
      center,
      radius,
      sphereImpactStrength
    );
    oldCenter.copy(center);

    // Update the water simulation and graphics
    for (let i = 0; i < 4; i++) {
      water.stepSimulation(sceneRenderer);
    }
    water.updateNormals(sceneRenderer);
    renderer.updateCaustics(sceneRenderer, water);
  }

  function draw(): void {
    // Angles are in degrees
    const radX = (angleX * Math.PI) / 180;
    const radY = (angleY * Math.PI) / 180;

    // Let's stick to a simple orbit for now.
    camera.position.x = Math.sin(radY) * dist * Math.cos(radX);
    camera.position.y = Math.sin(radX) * dist;
    camera.position.z = Math.cos(radY) * dist * Math.cos(radX);

    camera.lookAt(new THREE.Vector3(0, 0.5, 0));

    renderer.sphereCenter = center;
    renderer.sphereRadius = radius;
    renderer.render(sceneRenderer, camera, water, skyTexture);
  }
};
