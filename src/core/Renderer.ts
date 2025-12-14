import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Water } from "./Water";
import {
  waterVertexShader,
  waterFragmentShader,
  sphereVertexShader,
  sphereFragmentShader,
  cubeVertexShader,
  cubeFragmentShader,
} from "../shaders/water";
import {
  causticsVertexShader,
  causticsFragmentShader,
} from "../shaders/caustics";

export class Renderer {
  tileTexture: THREE.Texture;
  lightDir: THREE.Vector3;
  causticTex: THREE.WebGLRenderTarget;

  waterMesh: THREE.Mesh;
  waterMaterial: THREE.ShaderMaterial;

  sphereMesh: THREE.Mesh;
  sphereMaterial: THREE.ShaderMaterial;

  cubeMesh: THREE.Mesh;
  cubeMaterial: THREE.ShaderMaterial;

  sphereRadius: number;
  sphereCenter: THREE.Vector3;

  causticsMaterial: THREE.ShaderMaterial;
  causticsScene: THREE.Scene;
  causticsCamera: THREE.Camera;
  causticsMesh: THREE.Mesh;

  scene: THREE.Scene;

  duckMesh: THREE.Object3D | null = null;
  dirLight: THREE.DirectionalLight | null = null;

  // Duck state
  duckPosition: THREE.Vector3 = new THREE.Vector3();
  duckQuaternion: THREE.Quaternion = new THREE.Quaternion();

  // 渲染纹理 Render Targets
  duckRefractionTex: THREE.WebGLRenderTarget;
  resolution: THREE.Vector2 = new THREE.Vector2();

  poolWidth: number = 2;
  poolLength: number = 2;
  poolHeight: number = 2;
  wallHeight: number = 1;

  constructor(textureType: THREE.TextureDataType) {
    this.scene = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    const tileImg = document.getElementById("tiles") as HTMLImageElement;
    this.tileTexture = loader.load(tileImg ? tileImg.src : "");
    this.tileTexture.wrapS = THREE.RepeatWrapping;
    this.tileTexture.wrapT = THREE.RepeatWrapping;
    this.tileTexture.minFilter = THREE.LinearMipMapLinearFilter;

    this.lightDir = new THREE.Vector3(-1, 1, 1).normalize();

    this.causticTex = new THREE.WebGLRenderTarget(1024, 1024, {
      type: textureType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // 鸭子折射纹理 (用于水下透视)
    this.duckRefractionTex = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    const poolSizeVal = new THREE.Vector2(
      this.poolWidth / 2,
      this.poolLength / 2
    );

    // --- Water ---
    const waterGeometry = new THREE.PlaneGeometry(2, 2, 200, 200);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.lightDir },
        water: { value: null },
        tiles: { value: this.tileTexture },
        sky: { value: null },
        causticTex: { value: this.causticTex.texture },
        eye: { value: new THREE.Vector3() },
        sphereCenter: { value: new THREE.Vector3() },
        sphereRadius: { value: 0 },
        poolHeight: { value: this.poolHeight },
        wallHeight: { value: this.wallHeight },
        poolSize: { value: poolSizeVal },
        duckRefraction: { value: this.duckRefractionTex.texture }, // 传入折射纹理
        resolution: { value: this.resolution },
      },
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
    });
    this.waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);

    // --- Sphere (Keep for Physics logic if needed, but hidden) ---
    const sphereGeometry = new THREE.SphereGeometry(1, 10, 10);
    this.sphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.lightDir },
        water: { value: null },
        causticTex: { value: this.causticTex.texture },
        sphereCenter: { value: new THREE.Vector3() },
        sphereRadius: { value: 0 },
        tiles: { value: this.tileTexture },
        poolHeight: { value: this.poolHeight },
        wallHeight: { value: this.wallHeight },
        poolSize: { value: poolSizeVal },
      },
      vertexShader: sphereVertexShader,
      fragmentShader: sphereFragmentShader,
    });
    this.sphereMesh = new THREE.Mesh(sphereGeometry, this.sphereMaterial);
    this.sphereMesh.visible = false;
    this.scene.add(this.sphereMesh);

    // --- Cube (Pool Walls) ---
    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
    this.cubeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.lightDir },
        water: { value: null },
        tiles: { value: this.tileTexture },
        causticTex: { value: this.causticTex.texture },
        sphereCenter: { value: new THREE.Vector3() },
        sphereRadius: { value: 0 },
        poolHeight: { value: this.poolHeight },
        wallHeight: { value: this.wallHeight },
        poolSize: { value: poolSizeVal },
      },
      vertexShader: cubeVertexShader,
      fragmentShader: cubeFragmentShader,
      side: THREE.BackSide,
    });
    this.cubeMesh = new THREE.Mesh(cubeGeometry, this.cubeMaterial);
    this.scene.add(this.cubeMesh);

    this.sphereRadius = 0;
    this.sphereCenter = new THREE.Vector3();

    // --- Caustics Setup ---
    this.causticsScene = new THREE.Scene();
    this.causticsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.causticsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        light: { value: this.lightDir },
        water: { value: null },
        sphereCenter: { value: new THREE.Vector3() },
        sphereRadius: { value: 0 },
        poolHeight: { value: this.poolHeight },
        wallHeight: { value: this.wallHeight },
        poolSize: { value: poolSizeVal },
      },
      vertexShader: causticsVertexShader,
      fragmentShader: causticsFragmentShader,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcColorFactor,
      transparent: true,
    });
    this.causticsMesh = new THREE.Mesh(waterGeometry, this.causticsMaterial);
    this.causticsScene.add(this.causticsMesh);
  }

  loadDuck(url: string) {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      this.duckMesh = gltf.scene;
      const box = new THREE.Box3().setFromObject(this.duckMesh);
      const size = box.getSize(new THREE.Vector3());
      const targetSize = 0.5;
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = targetSize / maxDim;
      this.duckMesh.scale.setScalar(scale);

      this.duckMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) child.material.needsUpdate = true;
        }
      });
      this.scene.add(this.duckMesh);
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1);
    this.dirLight.position.copy(this.lightDir).multiplyScalar(10);
    this.scene.add(this.dirLight);
  }

  updateLightDirection(x: number, y: number, z: number) {
    this.lightDir.set(x, y, z).normalize();
    if (this.dirLight) {
      this.dirLight.position.copy(this.lightDir).multiplyScalar(10);
    }
  }

  updateDimensions(w: number, l: number, d: number, wh: number) {
    this.poolWidth = w;
    this.poolLength = l;
    this.poolHeight = d;
    this.wallHeight = wh;
    const poolSizeVal = new THREE.Vector2(w / 2, l / 2);
    this.waterMesh.scale.set(w / 2, 1, l / 2);
    const height = d + wh;
    this.cubeMesh.scale.set(w / 2, Math.max(height / 2, 0.01), l / 2);
    this.cubeMesh.position.y = (wh - d) / 2;
    const updateMaterial = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.poolHeight.value = d;
      mat.uniforms.wallHeight.value = wh;
      mat.uniforms.poolSize.value.copy(poolSizeVal);
    };
    updateMaterial(this.waterMaterial);
    updateMaterial(this.sphereMaterial);
    updateMaterial(this.cubeMaterial);
    updateMaterial(this.causticsMaterial);
  }

  updateCaustics(renderer: THREE.WebGLRenderer, water: Water): void {
    const material = this.causticsMesh.material as THREE.ShaderMaterial;
    material.uniforms["water"].value = water.textureA.texture;
    material.uniforms["sphereCenter"].value = this.sphereCenter;
    material.uniforms["sphereRadius"].value = this.sphereRadius;
    renderer.setRenderTarget(this.causticTex);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.causticsScene, this.causticsCamera);
    renderer.setRenderTarget(null);
  }

  // 渲染折射纹理 (从主相机视角渲染鸭子)
  renderDuckRefraction(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.duckMesh) return;

    // 隐藏遮挡物 (水面) 和 背景 (Cube)
    // Cube是BackSide，如果隐藏了背景就是黑/透明的，利于混合
    const oldVisible = {
      water: this.waterMesh.visible,
      cube: this.cubeMesh.visible,
      sphere: this.sphereMesh.visible,
    };

    // 隐藏遮挡物，只渲染鸭子
    this.waterMesh.visible = false;
    this.cubeMesh.visible = false;
    this.sphereMesh.visible = false;

    renderer.setRenderTarget(this.duckRefractionTex);
    renderer.setClearColor(0x000000, 0); // 透明清除
    renderer.clear();

    renderer.render(this.scene, camera);

    renderer.setRenderTarget(null);

    // 恢复可见性
    this.waterMesh.visible = oldVisible.water;
    this.cubeMesh.visible = oldVisible.cube;
  }

  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    water: Water,
    sky: THREE.Texture
  ): void {
    if (this.duckMesh) {
      this.duckMesh.position.copy(this.duckPosition);
      this.duckMesh.quaternion.copy(this.duckQuaternion);

      // 渲染折射 (用于透过水面看鸭子身体)
      this.renderDuckRefraction(renderer, camera);
    }

    // 更新分辨率 uniform
    const canvas = renderer.domElement;
    this.resolution.set(canvas.width, canvas.height);

    // 确保折射纹理尺寸匹配屏幕
    if (
      this.duckRefractionTex.width !== canvas.width ||
      this.duckRefractionTex.height !== canvas.height
    ) {
      this.duckRefractionTex.setSize(canvas.width, canvas.height);
    }

    this.waterMaterial.uniforms["water"].value = water.textureA.texture;
    this.waterMaterial.uniforms["sky"].value = sky;
    this.waterMaterial.uniforms["eye"].value = camera.position;
    this.waterMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.waterMaterial.uniforms["sphereRadius"].value = this.sphereRadius;
    this.waterMaterial.uniforms["duckRefraction"].value =
      this.duckRefractionTex.texture;
    this.waterMaterial.uniforms["resolution"].value = this.resolution;

    // 更新其他材质
    this.sphereMaterial.uniforms["water"].value = water.textureA.texture;
    this.sphereMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.sphereMaterial.uniforms["sphereRadius"].value = this.sphereRadius;

    this.cubeMaterial.uniforms["water"].value = water.textureA.texture;
    this.cubeMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.cubeMaterial.uniforms["sphereRadius"].value = this.sphereRadius;

    // 渲染主场景
    renderer.render(this.scene, camera);
  }
}
