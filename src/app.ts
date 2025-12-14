import * as THREE from "three";
import { Water } from "./core/Water";
import { Renderer } from "./core/Renderer";
import { PhysicsEngine } from "./core/Physics";
import { InputManager } from "./core/InputManager";

export class Application {
  sceneRenderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;

  water: Water;
  renderer: Renderer;
  physics: PhysicsEngine;
  inputManager: InputManager;

  skyTexture: THREE.Texture | null = null;

  // App Config
  containerHeight = 1.4;
  waterFillRatio = 0.7;
  dist = 4;

  constructor() {
    this.sceneRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.sceneRenderer.setClearColor(new THREE.Color(0, 0, 0));

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      100
    );

    // Check capabilities
    this.checkCapabilities();
    const textureType = this.getTextureType();

    // Initialize Modules
    this.water = new Water(textureType);
    this.renderer = new Renderer(textureType);
    this.physics = new PhysicsEngine();
    this.inputManager = new InputManager(
      this.camera,
      this.sceneRenderer.domElement
    );

    // Wire up events
    this.setupEvents();

    // Initial Setup
    this.renderer.loadDuck("duck.glb");
    document.body.appendChild(this.sceneRenderer.domElement);

    this.loadSkyTexture();
    this.initWaterDrops();

    this.updatePoolDimensions();
    this.onResize(); // Initial resize

    // Provide context to InputManager
    this.inputManager.getContext = () => ({
      center: this.physics.center,
      radius: this.physics.radius,
      poolWidth: this.physics.poolWidth,
      poolLength: this.physics.poolLength,
    });
  }

  private checkCapabilities() {
    if (
      !this.sceneRenderer.capabilities.isWebGL2 &&
      !this.sceneRenderer.extensions.get("OES_texture_float")
    ) {
      throw new Error(
        "Rendering to floating-point textures is required but not supported"
      );
    }

    // Explicitly enable EXT_float_blend to suppress warning and ensure portability
    this.sceneRenderer.extensions.get("EXT_float_blend");
  }

  private getTextureType(): THREE.TextureDataType {
    let textureType: THREE.TextureDataType = THREE.FloatType;
    if (!this.sceneRenderer.extensions.get("OES_texture_float_linear")) {
      textureType = THREE.HalfFloatType;
    }
    return textureType;
  }

  private loadSkyTexture() {
    const skyImg = document.getElementById("sky") as HTMLImageElement;
    if (skyImg) {
      this.skyTexture = new THREE.Texture(skyImg);
      this.skyTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.skyTexture.wrapT = THREE.ClampToEdgeWrapping;
      this.skyTexture.minFilter = THREE.LinearFilter;
      this.skyTexture.needsUpdate = true;
    }
  }

  private initWaterDrops() {
    for (let i = 0; i < 20; i++) {
      this.water.addDrop(
        this.sceneRenderer,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        0.03,
        i & 1 ? 0.01 : -0.01
      );
    }
  }

  private setupEvents() {
    window.addEventListener("resize", this.onResize.bind(this));

    // Input -> Physics/Water interaction
    this.inputManager.onAddDrop = (x, z) => {
      this.water.addDrop(this.sceneRenderer, x, z, 0.03, 0.02);
    };

    this.inputManager.onMoveSphere = (delta) => {
      this.physics.center.add(delta);
      // Clamp
      this.physics.center.x = Math.max(
        this.physics.radius - this.physics.poolWidth / 2,
        Math.min(
          this.physics.poolWidth / 2 - this.physics.radius,
          this.physics.center.x
        )
      );
      this.physics.center.y = Math.max(
        this.physics.radius - this.physics.poolDepth,
        Math.min(10, this.physics.center.y)
      );
      this.physics.center.z = Math.max(
        this.physics.radius - this.physics.poolLength / 2,
        Math.min(
          this.physics.poolLength / 2 - this.physics.radius,
          this.physics.center.z
        )
      );
    };
  }

  private updatePoolDimensions() {
    const waterDepth = this.containerHeight * this.waterFillRatio;
    const wallHeight = this.containerHeight * (1 - this.waterFillRatio);

    this.physics.poolDepth = waterDepth;
    this.renderer.updateDimensions(
      this.physics.poolWidth,
      this.physics.poolLength,
      waterDepth,
      wallHeight
    );
    this.water.updateDimensions(
      this.physics.poolWidth,
      this.physics.poolLength
    );
  }

  private onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.sceneRenderer.setSize(width, height);
    this.sceneRenderer.setPixelRatio(window.devicePixelRatio || 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Auto-resize pool to fill screen (top-down view)
    const visibleHeight = 2 * this.dist * Math.tan((45 * Math.PI) / 360);
    const visibleWidth = visibleHeight * this.camera.aspect;

    this.physics.poolWidth = visibleWidth;
    this.physics.poolLength = visibleHeight;
    this.updatePoolDimensions();
  }

  start() {
    const loading = document.getElementById("loading");
    if (loading) {
      loading.innerHTML = "";
    }

    let prevTime = new Date().getTime();

    const animate = () => {
      const nextTime = new Date().getTime();
      this.update((nextTime - prevTime) / 1000);
      this.draw();
      prevTime = nextTime;
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private update(seconds: number) {
    if (seconds > 1) return;

    // Physics
    this.physics.update(
      seconds,
      this.water,
      this.inputManager,
      this.sceneRenderer
    );

    // Sync Visuals
    this.renderer.duckPosition.copy(this.physics.center);
    this.renderer.duckPosition.y -= 0.1;

    // Visual Rotation Logic (could be moved to Physics or Renderer helper, staying here for now)
    const Y = new THREE.Vector3(0, 1, 0);
    let Z = this.physics.velocity.clone();
    Z.y = 0;
    if (Z.lengthSq() < 0.001) {
      Z = new THREE.Vector3(0, 0, 1).applyQuaternion(
        this.renderer.duckQuaternion
      );
      Z.y = 0;
    }
    Z.normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    Z.crossVectors(X, Y).normalize();
    const targetRot = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(X, Y, Z)
    );
    this.renderer.duckQuaternion.slerp(targetRot, 0.05);

    // Water Simulation Steps
    for (let i = 0; i < 4; i++) {
      this.water.stepSimulation(this.sceneRenderer);
    }
    this.water.updateNormals(this.sceneRenderer);
    this.renderer.updateCaustics(this.sceneRenderer, this.water);
  }

  private draw() {
    // Camera Orbit
    const radX = (this.inputManager.angleX * Math.PI) / 180;
    const radY = (this.inputManager.angleY * Math.PI) / 180;

    this.camera.position.x = Math.sin(radY) * this.dist * Math.cos(radX);
    this.camera.position.y = Math.sin(radX) * this.dist;
    this.camera.position.z = Math.cos(radY) * this.dist * Math.cos(radX);
    this.camera.lookAt(new THREE.Vector3(0, 0.5, 0));

    // Render
    this.renderer.sphereCenter = this.physics.center;
    this.renderer.sphereRadius = this.physics.radius;
    if (this.skyTexture) {
      this.renderer.render(
        this.sceneRenderer,
        this.camera,
        this.water,
        this.skyTexture
      );
    }
  }
}
