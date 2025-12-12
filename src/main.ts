import { Water } from "./water";
import { Renderer } from "./renderer";
import { Cubemap } from "./cubemap";
import { GL, type GLVector } from "./lib/lightgl";

export const gl = GL.create();

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
let cubemap: Cubemap;
let renderer: Renderer;
let angleX = -25;
let angleY = -200.5;

// Sphere physics info
let useSpherePhysics = false;
let center: GLVector;
let oldCenter: GLVector;
let velocity: GLVector;
let gravity: GLVector;
let radius: number;
let paused = false;

window.onload = function () {
  const ratio = window.devicePixelRatio || 1;

  function onresize(): void {
    const width = innerWidth - 20;
    const height = innerHeight;
    gl.canvas.width = width * ratio;
    gl.canvas.height = height * ratio;
    gl.canvas.style.width = width + "px";
    gl.canvas.style.height = height + "px";
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.matrixMode(gl.PROJECTION);
    gl.loadIdentity();
    gl.perspective(45, gl.canvas.width / gl.canvas.height, 0.01, 100);
    gl.matrixMode(gl.MODELVIEW);
    draw();
  }

  document.body.appendChild(gl.canvas);
  gl.clearColor(0, 0, 0, 1);

  water = new Water();
  renderer = new Renderer();
  cubemap = new Cubemap({
    xneg: document.getElementById("xneg") as HTMLImageElement,
    xpos: document.getElementById("xpos") as HTMLImageElement,
    yneg: document.getElementById("ypos") as HTMLImageElement,
    ypos: document.getElementById("ypos") as HTMLImageElement,
    zneg: document.getElementById("zneg") as HTMLImageElement,
    zpos: document.getElementById("zpos") as HTMLImageElement,
  });

  if (
    !(water.textureA as any).canDrawTo ||
    !(water.textureA as any).canDrawTo()
  ) {
    throw new Error(
      "Rendering to floating-point textures is required but not supported"
    );
  }

  center = oldCenter = new GL.Vector(-0.4, -0.75, 0.2);
  velocity = new GL.Vector();
  gravity = new GL.Vector(0, -4, 0);
  radius = 0.25;

  for (let i = 0; i < 20; i++) {
    water.addDrop(
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

  const requestAnimationFrame =
    window.requestAnimationFrame ||
    (window as any).webkitRequestAnimationFrame ||
    function (callback: FrameRequestCallback) {
      setTimeout(callback, 0);
    };

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

  let prevHit: GLVector;
  let planeNormal: GLVector;
  let mode = -1;
  const MODE_ADD_DROPS = 0;
  const MODE_MOVE_SPHERE = 1;
  const MODE_ORBIT_CAMERA = 2;

  let oldX: number, oldY: number;

  function startDrag(x: number, y: number): void {
    oldX = x;
    oldY = y;
    const tracer = new GL.Raytracer();
    const ray = tracer.getRayForPixel(x * ratio, y * ratio);
    const pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
    const sphereHitTest = GL.Raytracer.hitTestSphere(
      tracer.eye,
      ray,
      center,
      radius
    );
    if (sphereHitTest) {
      mode = MODE_MOVE_SPHERE;
      prevHit = sphereHitTest.hit;
      planeNormal = tracer
        .getRayForPixel(gl.canvas.width / 2, gl.canvas.height / 2)
        .negative();
    } else if (Math.abs(pointOnPlane.x) < 1 && Math.abs(pointOnPlane.z) < 1) {
      mode = MODE_ADD_DROPS;
      duringDrag(x, y);
    } else {
      mode = MODE_ORBIT_CAMERA;
    }
  }

  function duringDrag(x: number, y: number): void {
    switch (mode) {
      case MODE_ADD_DROPS: {
        const tracer = new GL.Raytracer();
        const ray = tracer.getRayForPixel(x * ratio, y * ratio);
        const pointOnPlane = tracer.eye.add(
          ray.multiply(-tracer.eye.y / ray.y)
        );
        water.addDrop(pointOnPlane.x, pointOnPlane.z, 0.03, 0.01);
        if (paused) {
          water.updateNormals();
          renderer.updateCaustics(water);
        }
        break;
      }
      case MODE_MOVE_SPHERE: {
        const tracer = new GL.Raytracer();
        const ray = tracer.getRayForPixel(x * ratio, y * ratio);
        const t =
          -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
        const nextHit = tracer.eye.add(ray.multiply(t));
        center = center.add(nextHit.subtract(prevHit));
        center.x = Math.max(radius - 1, Math.min(1 - radius, center.x));
        center.y = Math.max(radius - 1, Math.min(10, center.y));
        center.z = Math.max(radius - 1, Math.min(1 - radius, center.z));
        prevHit = nextHit;
        if (paused) renderer.updateCaustics(water);
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
    e.preventDefault();
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

  document.onkeydown = function (e: KeyboardEvent): void {
    if (e.which == " ".charCodeAt(0)) paused = !paused;
    else if (e.which == "G".charCodeAt(0)) useSpherePhysics = !useSpherePhysics;
    else if (e.which == "L".charCodeAt(0) && paused) draw();
  };

  let frame = 0;

  function update(seconds: number): void {
    if (seconds > 1) return;
    frame += seconds * 2;

    if (mode == MODE_MOVE_SPHERE) {
      // Start from rest when the player releases the mouse after moving the sphere
      velocity = new GL.Vector();
    } else if (useSpherePhysics) {
      // Fall down with viscosity under water
      const percentUnderWater = Math.max(
        0,
        Math.min(1, (radius - center.y) / (2 * radius))
      );
      velocity = velocity.add(
        gravity.multiply(seconds - 1.1 * seconds * percentUnderWater)
      );
      velocity = velocity.subtract(
        velocity
          .unit()
          .multiply(percentUnderWater * seconds * velocity.dot(velocity))
      );
      center = center.add(velocity.multiply(seconds));

      // Bounce off the bottom
      if (center.y < radius - 1) {
        center.y = radius - 1;
        velocity.y = Math.abs(velocity.y) * 0.7;
      }
    }

    // Displace water around the sphere
    water.moveSphere(
      [oldCenter.x, oldCenter.y, oldCenter.z],
      [center.x, center.y, center.z],
      radius
    );
    oldCenter = center;

    // Update the water simulation and graphics
    water.stepSimulation();
    water.stepSimulation();
    water.updateNormals();
    renderer.updateCaustics(water);
  }

  function draw(): void {
    // Change the light direction to the camera look vector when the L key is pressed
    if (GL.keys.L) {
      renderer.lightDir = GL.Vector.fromAngles(
        ((90 - angleY) * Math.PI) / 180,
        (-angleX * Math.PI) / 180
      );
      if (paused) renderer.updateCaustics(water);
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.loadIdentity();
    gl.translate(0, 0, -4);
    gl.rotate(-angleX, 1, 0, 0);
    gl.rotate(-angleY, 0, 1, 0);
    gl.translate(0, 0.5, 0);

    gl.enable(gl.DEPTH_TEST);
    renderer.sphereCenter = center;
    renderer.sphereRadius = radius;
    renderer.renderCube(water);
    renderer.renderWater(water, cubemap);
    renderer.renderSphere(water);
    gl.disable(gl.DEPTH_TEST);
  }
};
