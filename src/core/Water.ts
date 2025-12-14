import * as THREE from "three";
import { commonVertexShader } from "../shaders/common";
import {
  dropFragmentShader,
  updateFragmentShader,
  normalFragmentShader,
  sphereVolumeFragmentShader,
} from "../shaders/simulation";

export class Water {
  mesh: THREE.Mesh;
  textureA: THREE.WebGLRenderTarget;
  textureB: THREE.WebGLRenderTarget;
  dropMaterial: THREE.ShaderMaterial;
  updateMaterial: THREE.ShaderMaterial;
  normalMaterial: THREE.ShaderMaterial;
  sphereMaterial: THREE.ShaderMaterial;

  // GPGPU helper objects
  camera: THREE.Camera;
  scene: THREE.Scene;

  poolWidth: number = 2;
  poolLength: number = 2;

  constructor(textureType: THREE.TextureDataType) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.camera.position.z = 0.5; // Ensure camera is backed off to see the mesh at Z=0
    this.scene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(2, 2);

    this.textureA = new THREE.WebGLRenderTarget(1024, 1024, {
      type: textureType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      depthBuffer: false,
    });

    this.textureB = this.textureA.clone();

    this.dropMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        center: { value: new THREE.Vector2() },
        radius: { value: 0 },
        strength: { value: 0 },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: commonVertexShader,
      fragmentShader: dropFragmentShader,
    });

    this.updateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        delta: { value: new THREE.Vector2() },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: commonVertexShader,
      fragmentShader: updateFragmentShader,
    });

    this.normalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        delta: { value: new THREE.Vector2() },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: commonVertexShader,
      fragmentShader: normalFragmentShader,
    });

    this.sphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        oldCenter: { value: new THREE.Vector3() },
        newCenter: { value: new THREE.Vector3() },
        radius: { value: 0 },
        strength: { value: 0.01 },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: commonVertexShader,
      fragmentShader: sphereVolumeFragmentShader,
    });

    this.mesh = new THREE.Mesh(geometry, this.dropMaterial); // Initial material
    this.scene.add(this.mesh);
  }

  updateDimensions(width: number, length: number) {
    this.poolWidth = width;
    this.poolLength = length;
    const poolSizeVal = new THREE.Vector2(width, length);
    this.dropMaterial.uniforms.poolSize.value.copy(poolSizeVal);
    this.updateMaterial.uniforms.poolSize.value.copy(poolSizeVal);
    this.normalMaterial.uniforms.poolSize.value.copy(poolSizeVal);
    this.sphereMaterial.uniforms.poolSize.value.copy(poolSizeVal);
  }

  // Helper to render to target
  private renderTo(
    renderer: THREE.WebGLRenderer,
    material: THREE.ShaderMaterial,
    uniforms: Record<string, any>
  ) {
    this.mesh.material = material;

    // Update uniforms
    material.uniforms["textureMap"].value = this.textureA.texture;
    for (const key in uniforms) {
      if (material.uniforms[key]) {
        material.uniforms[key].value = uniforms[key];
      }
    }

    renderer.setRenderTarget(this.textureB);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.swap();
  }

  private swap() {
    const temp = this.textureA;
    this.textureA = this.textureB;
    this.textureB = temp;
  }

  addDrop(
    renderer: THREE.WebGLRenderer,
    x: number,
    y: number,
    radius: number,
    strength: number
  ): void {
    // Pass -1..1 coordinates
    const nx = x / (this.poolWidth / 2);
    const ny = y / (this.poolLength / 2);

    // Pass PHYSICAL radius
    this.renderTo(renderer, this.dropMaterial, {
      center: new THREE.Vector2(nx, ny),
      radius: radius,
      strength,
    });
  }

  moveSphere(
    renderer: THREE.WebGLRenderer,
    oldCenter: THREE.Vector3,
    newCenter: THREE.Vector3,
    radius: number,
    strength: number
  ): void {
    // Normalize coordinates -1..1 for center passing
    const scaleX = this.poolWidth / 2;
    const scaleZ = this.poolLength / 2;

    const nOld = oldCenter.clone();
    nOld.x /= scaleX;
    nOld.z /= scaleZ;

    const nNew = newCenter.clone();
    nNew.x /= scaleX;
    nNew.z /= scaleZ;

    // Pass PHYSICAL radius
    this.renderTo(renderer, this.sphereMaterial, {
      oldCenter: nOld,
      newCenter: nNew,
      radius: radius,
      strength,
    });
  }

  stepSimulation(renderer: THREE.WebGLRenderer): void {
    this.renderTo(renderer, this.updateMaterial, {
      delta: new THREE.Vector2(
        1 / this.textureA.width,
        1 / this.textureA.height
      ),
    });
  }

  updateNormals(renderer: THREE.WebGLRenderer): void {
    this.renderTo(renderer, this.normalMaterial, {
      delta: new THREE.Vector2(
        1 / this.textureA.width,
        1 / this.textureA.height
      ),
    });
  }

  // Buffer for reading pixel data
  private readBuffer = new Float32Array(4);

  getWaterAt(
    renderer: THREE.WebGLRenderer,
    x: number,
    z: number
  ): { height: number; normal: THREE.Vector3 } {
    // x, z are world coordinates centered at 0,0
    // Map to 0..1 UV coordinates
    const u = x / this.poolWidth + 0.5;
    const v = z / this.poolLength + 0.5;

    // Clamp to valid texture range
    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));

    const px = Math.floor(clampedU * (this.textureA.width - 1));
    const py = Math.floor(clampedV * (this.textureA.height - 1));

    renderer.readRenderTargetPixels(
      this.textureA,
      px,
      py,
      1,
      1,
      this.readBuffer
    );

    const height = this.readBuffer[0];
    const nx = this.readBuffer[2];
    const nz = this.readBuffer[3];
    // Reconstruct y component of normal (assuming normalized)
    // The shader stores: info.ba = normalize(cross(dy, dx)).xz;
    // So nx^2 + ny^2 + nz^2 = 1 => ny = sqrt(1 - nx^2 - nz^2)
    let ny = 1.0;
    const xzSq = nx * nx + nz * nz;
    if (xzSq < 1.0) {
      ny = Math.sqrt(1.0 - xzSq);
    }

    return { height, normal: new THREE.Vector3(nx, ny, nz) };
  }
}
