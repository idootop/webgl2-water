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

// Create UI
const uiContainer = document.createElement("div");
uiContainer.style.position = "absolute";
uiContainer.style.top = "10px";
uiContainer.style.right = "10px";
uiContainer.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
uiContainer.style.padding = "10px";
uiContainer.style.borderRadius = "5px";
uiContainer.style.color = "white";
uiContainer.style.zIndex = "100";
document.body.appendChild(uiContainer);

const createInput = (
  label: string,
  value: number,
  onChange: (val: number) => void,
  min: number = 0.1,
  max: number = 5,
  step: number = 0.1
) => {
  const div = document.createElement("div");
  div.style.marginBottom = "5px";

  const lbl = document.createElement("label");
  lbl.textContent = label + ": ";
  lbl.style.display = "inline-block";
  lbl.style.width = "80px"; // Increased width for longer labels
  div.appendChild(lbl);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.width = "100px";
  input.oninput = (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    span.textContent = val.toFixed(2);
    onChange(val);
  };
  div.appendChild(input);

  const span = document.createElement("span");
  span.textContent = value.toFixed(2);
  span.style.marginLeft = "5px";
  div.appendChild(span);

  uiContainer.appendChild(div);
};

createInput(
  "Width",
  poolWidth,
  (val) => {
    poolWidth = val;
    updatePoolDimensions();
  },
  0.1,
  20
);
createInput(
  "Length",
  poolLength,
  (val) => {
    poolLength = val;
    updatePoolDimensions();
  },
  0.1,
  20
);
createInput("Total Height", containerHeight, (val) => {
  containerHeight = val;
  updatePoolDimensions();
});
createInput(
  "Water Fill",
  waterFillRatio,
  (val) => {
    waterFillRatio = val;
    updatePoolDimensions();
  },
  0.05,
  1.0,
  0.05
);

createInput(
  "Sphere Float",
  sphereFloatRatio,
  (val) => {
    sphereFloatRatio = val;
  },
  0.0,
  0.9,
  0.05
);

createInput(
  "Impact Force",
  sphereImpactStrength,
  (val) => {
    sphereImpactStrength = val;
  },
  0.01,
  1.0,
  0.01
);

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
  const onMove = (ndcX: number, ndcY: number) => {
    // todo 一些交互
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
    // Normalised Device Coordinates (NDC)
    // x, y are pageX, pageY.
    // canvas might have offset? "width = innerWidth - 20".
    // But event.pageX is relative to document.
    // Let's assume canvas is at top left but maybe not?
    // document.body.appendChild(canvas).

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
        .negate(); // View vector?
      // Original: tracer.getRayForPixel(width/2, height/2).negative() -> Vector pointing FROM center TO eye (if ray is eye->pixel).
      // Wait, ray is Eye -> Pixel. Negative is Pixel -> Eye.
      // Actually original was: planeNormal = ray_center.negative();
      // Ray from eye to center of screen. Negative is Z axis of camera in world space (roughly).
      // Let's just use camera forward vector negated? Or just camera direction.
      const viewDir = new THREE.Vector3();
      camera.getWorldDirection(viewDir);
      planeNormal = viewDir.negate();
    } else {
      // Plane interaction
      // pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
      // This intersects with Plane y=0.
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

  function duringDrag(x: number, y: number): void {
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
            0.01
          );
          if (paused) {
            water.updateNormals(sceneRenderer);
            renderer.updateCaustics(sceneRenderer, water);
          }
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
      duringDrag(e.touches[0].pageX, e.touches[0].pageY);
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

    if (mode == MODE_MOVE_SPHERE) {
      velocity.set(0, 0, 0);
    } else if (useSpherePhysics) {
      const percentUnderWater = Math.max(
        0,
        Math.min(1, (radius - center.y) / (2 * radius))
      );

      // velocity = velocity.add(gravity.multiply(seconds - 1.1 * seconds * percentUnderWater));

      // Calculate buoyancy factor based on target float ratio
      // At equilibrium: Buoyancy = Gravity
      // Buoyancy = k * Gravity * percentSubmerged
      // k * (1 - sphereFloatRatio) = 1
      // k = 1 / (1 - sphereFloatRatio)

      const buoyancyFactor = 1.0 / (1.0 - sphereFloatRatio);

      const gTerm = gravity
        .clone()
        .multiplyScalar(seconds - buoyancyFactor * seconds * percentUnderWater);
      velocity.add(gTerm);

      // velocity = velocity.subtract(velocity.unit().multiply(percentUnderWater * seconds * velocity.dot(velocity)));
      // Note: velocity.unit() -> normalize()
      if (velocity.lengthSq() > 0) {
        const drag = velocity
          .clone()
          .normalize()
          .multiplyScalar(percentUnderWater * seconds * velocity.dot(velocity));
        velocity.sub(drag);
      }

      center.add(velocity.clone().multiplyScalar(seconds));

      if (center.y < radius - poolDepth) {
        center.y = radius - poolDepth;
        velocity.y = Math.abs(velocity.y) * 0.7;
      }
    }

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
    // Let's implement orbit manually for camera
    // Angles are in degrees
    const radX = (angleX * Math.PI) / 180;
    const radY = (angleY * Math.PI) / 180;

    // Calculate camera position
    // Rotation Order: Y then X?

    // Let's stick to a simple orbit for now.
    camera.position.x = Math.sin(radY) * dist * Math.cos(radX);
    camera.position.y = Math.sin(radX) * dist; // + some offset?
    camera.position.z = Math.cos(radY) * dist * Math.cos(radX);

    // Adjust for the translations
    // The code had `gl.translate(0, 0.5, 0)` before drawing geometry.
    // This moves geometry UP by 0.5.
    // So the pivot point is effectively (0, 0, 0) of the geometry, which is displayed at y=0.5 relative to rotation center.
    // Effectively we look at point (0, 0.5, 0)?

    camera.lookAt(new THREE.Vector3(0, 0.5, 0)); // Guessing offset

    renderer.sphereCenter = center;
    renderer.sphereRadius = radius;
    renderer.render(sceneRenderer, camera, water, skyTexture);
  }
};
