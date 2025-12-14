import * as THREE from "three";

export const MODE_ADD_DROPS = 0;
export const MODE_MOVE_SPHERE = 1;
export const MODE_ORBIT_CAMERA = 2;

export class InputManager {
  mousePoint = new THREE.Vector3(100, 100, 100);
  angleX = 90;
  angleY = 180;

  mode = -1;

  private camera: THREE.Camera;
  private domElement: HTMLElement;

  // Dragging state
  private oldX: number = 0;
  private oldY: number = 0;
  private prevHit = new THREE.Vector3();
  private planeNormal = new THREE.Vector3();

  // Interaction hooks
  public onAddDrop: ((x: number, z: number) => void) | null = null;
  public onMoveSphere: ((delta: THREE.Vector3) => void) | null = null;

  constructor(camera: THREE.Camera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.initListeners();
  }

  private initListeners() {
    window.addEventListener("mousemove", this.onMouseMoveGlobal.bind(this));
    window.addEventListener(
      "deviceorientation",
      this.onDeviceOrientation.bind(this)
    );

    this.domElement.addEventListener("mousedown", this.onMouseDown.bind(this));
    // We attach mousemove/up to document to handle dragging outside canvas
    document.addEventListener("mousemove", this.onDragMove.bind(this));
    document.addEventListener("mouseup", this.onDragEnd.bind(this));

    this.domElement.addEventListener(
      "touchstart",
      this.onTouchStart.bind(this)
    );
    this.domElement.addEventListener("touchmove", this.onTouchMove.bind(this));
    this.domElement.addEventListener("touchend", this.onTouchEnd.bind(this));
  }

  // --- Raycasting Helpers ---

  private getRay(x: number, y: number): THREE.Ray {
    const rect = this.domElement.getBoundingClientRect();
    const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((y - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return raycaster.ray;
  }

  private updateMousePoint(ndcX: number, ndcY: number) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, target)) {
      this.mousePoint.copy(target);
    }
  }

  // --- Event Handlers ---

  private onMouseMoveGlobal(e: MouseEvent) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.updateMousePoint(x, y);
  }

  private onDeviceOrientation(e: DeviceOrientationEvent) {
    const ctx = this.getContext();
    this.updateFromOrientation(e, ctx.center);
  }

  // We need current sphere state to start drag
  startDrag(
    x: number,
    y: number,
    sphereCenter: THREE.Vector3,
    sphereRadius: number,
    poolWidth: number,
    poolLength: number
  ) {
    this.oldX = x;
    this.oldY = y;

    const ray = this.getRay(x, y);

    // 1. Hit Test Sphere
    const sphere = new THREE.Sphere(sphereCenter, sphereRadius);
    const sphereHit = ray.intersectSphere(sphere, new THREE.Vector3());

    if (sphereHit) {
      this.mode = MODE_MOVE_SPHERE;
      this.prevHit = sphereHit;

      // Calculate plane normal facing camera
      const viewDir = new THREE.Vector3();
      this.camera.getWorldDirection(viewDir);
      this.planeNormal = viewDir.negate();
    } else {
      // 2. Hit Test Water Plane
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const pointOnPlane = new THREE.Vector3();
      const hit = ray.intersectPlane(plane, pointOnPlane);

      if (
        hit &&
        Math.abs(pointOnPlane.x) < poolWidth / 2 &&
        Math.abs(pointOnPlane.z) < poolLength / 2
      ) {
        this.mode = MODE_ADD_DROPS;
        this.handleDragInteraction(x, y);
      } else {
        this.mode = MODE_ORBIT_CAMERA;
      }
    }
  }

  handleDragInteraction(x: number, y: number, fromTouch = false) {
    switch (this.mode) {
      case MODE_ADD_DROPS: {
        const ray = this.getRay(x, y);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const pointOnPlane = new THREE.Vector3();
        const hit = ray.intersectPlane(plane, pointOnPlane);

        if (hit && this.onAddDrop) {
          this.onAddDrop(pointOnPlane.x, pointOnPlane.z);
        }

        if (fromTouch) {
          // Update mousePoint for repulsion during touch
          const ndcX = (x / window.innerWidth) * 2 - 1;
          const ndcY = -(y / window.innerHeight) * 2 + 1;
          this.updateMousePoint(ndcX, ndcY);
        }
        break;
      }
      case MODE_MOVE_SPHERE: {
        const ray = this.getRay(x, y);
        const dragPlane = new THREE.Plane();
        dragPlane.setFromNormalAndCoplanarPoint(this.planeNormal, this.prevHit);

        const nextHit = new THREE.Vector3();
        const hit = ray.intersectPlane(dragPlane, nextHit);

        if (hit) {
          const delta = nextHit.clone().sub(this.prevHit);
          if (this.onMoveSphere) {
            this.onMoveSphere(delta);
          }
          this.prevHit = nextHit;
        }
        break;
      }
      case MODE_ORBIT_CAMERA: {
        this.angleY -= x - this.oldX;
        this.angleX -= y - this.oldY;
        this.angleX = Math.max(-89.999, Math.min(89.999, this.angleX));
        break;
      }
    }
    this.oldX = x;
    this.oldY = y;
  }

  stopDrag() {
    this.mode = -1;
  }

  // --- DOM Event Bindings ---

  public getContext: () => {
    center: THREE.Vector3;
    radius: number;
    poolWidth: number;
    poolLength: number;
  } = () => {
    return {
      center: new THREE.Vector3(),
      radius: 0.25,
      poolWidth: 2,
      poolLength: 2,
    };
  };

  private onMouseDown(e: MouseEvent) {
    const ctx = this.getContext();
    this.startDrag(
      e.pageX,
      e.pageY,
      ctx.center,
      ctx.radius,
      ctx.poolWidth,
      ctx.poolLength
    );
  }

  private onDragMove(e: MouseEvent) {
    if (this.mode !== -1) {
      this.handleDragInteraction(e.pageX, e.pageY);
    }
  }

  private onDragEnd() {
    this.stopDrag();
  }

  private onTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      e.preventDefault();
      const ctx = this.getContext();
      this.startDrag(
        e.touches[0].pageX,
        e.touches[0].pageY,
        ctx.center,
        ctx.radius,
        ctx.poolWidth,
        ctx.poolLength
      );
    }
  }

  private onTouchMove(e: TouchEvent) {
    if (e.touches.length === 1) {
      this.handleDragInteraction(e.touches[0].pageX, e.touches[0].pageY, true);
    }
  }

  private onTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) {
      this.stopDrag();
    }
  }

  // Public method to handle device orientation update
  updateFromOrientation(e: DeviceOrientationEvent, center: THREE.Vector3) {
    if (e.gamma === null || e.beta === null) return;

    const maxTilt = 30; // degrees
    const gamma = Math.min(Math.max(e.gamma, -maxTilt), maxTilt);
    const beta = Math.min(Math.max(e.beta, -maxTilt), maxTilt);

    const ndcX = -(gamma / maxTilt);
    const ndcY = -(beta / maxTilt);

    const duckScreenPos = center.clone().project(this.camera);
    const inputVec = new THREE.Vector2(-ndcX, ndcY);
    const intensity = inputVec.length();

    if (intensity < 0.1) {
      this.mousePoint.set(100, 100, 100);
    } else {
      inputVec.normalize();
      const raycaster = new THREE.Raycaster();
      const offsetNDC = new THREE.Vector2(duckScreenPos.x, duckScreenPos.y).add(
        inputVec.clone().multiplyScalar(0.05)
      );

      raycaster.setFromCamera(offsetNDC, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const targetPoint = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(plane, targetPoint)) {
        const worldDir = targetPoint.sub(center).normalize();
        worldDir.y = 0;
        const clampedIntensity = Math.min(intensity, 1.0);
        const dist = 1 - clampedIntensity * 0.5;
        this.mousePoint.copy(center).add(worldDir.multiplyScalar(dist));
      }
    }
  }
}
