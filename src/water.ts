import * as THREE from "three";

// Common vertex shader for full-screen quad
const vertexShader = `
  varying vec2 coord;
  void main() {
    coord = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xyz, 1.0);
  }
`;

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
      vertexShader: vertexShader,
      fragmentShader: `
        const float PI = 3.141592653589793;
        uniform sampler2D textureMap;
        uniform vec2 center;
        uniform float radius;
        uniform float strength;
        uniform vec2 poolSize;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          
          // center and coord are in UV space (0..1)
          // We want to calculate distance in World space to keep drops circular.
          // center input is normalized -1..1 from addDrop.
          
          vec2 uvVector = (center * 0.5 + 0.5) - coord;
          vec2 worldVector = uvVector * poolSize; 
          
          float dist = length(worldVector);
          float drop = max(0.0, 1.0 - dist / radius);
          
          drop = 0.5 - cos(drop * PI) * 0.5;
          info.r += drop * strength;
          gl_FragColor = info;
        }
      `,
    });

    this.updateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        delta: { value: new THREE.Vector2() },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec2 delta;
        uniform vec2 poolSize;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          
          vec2 dx = vec2(delta.x, 0.0);
          vec2 dy = vec2(0.0, delta.y);
          
          float u = info.r;
          float u_right = texture2D(textureMap, coord + dx).r;
          float u_left  = texture2D(textureMap, coord - dx).r;
          float u_up    = texture2D(textureMap, coord + dy).r;
          float u_down  = texture2D(textureMap, coord - dy).r;
          
          // Weighted Laplacian for non-square aspect ratio
          // weights are proportional to 1 / physical_distance^2
          // physical_distance_x = poolSize.x * delta.x
          // physical_distance_y = poolSize.y * delta.y
          
          float fx = 1.0 / (poolSize.x * poolSize.x);
          float fy = 1.0 / (poolSize.y * poolSize.y);
          
          float spatial_average = ( (u_left + u_right) * fx + (u_up + u_down) * fy ) / (2.0 * (fx + fy));
          
          info.g += (spatial_average - u) * 2.0;
          info.g *= 0.995;
          info.r += info.g;
          gl_FragColor = info;
        }
      `,
    });

    this.normalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        textureMap: { value: null },
        delta: { value: new THREE.Vector2() },
        poolSize: { value: new THREE.Vector2(this.poolWidth, this.poolLength) },
      },
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec2 delta;
        uniform vec2 poolSize;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          
          // Physical dx and dy
          float dx_phys = poolSize.x * delta.x; 
          float dy_phys = poolSize.y * delta.y;
          
          vec3 dx = vec3(dx_phys, texture2D(textureMap, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
          vec3 dy = vec3(0.0, texture2D(textureMap, vec2(coord.x, coord.y + delta.y)).r - info.r, dy_phys);
          
          info.ba = normalize(cross(dy, dx)).xz;
          gl_FragColor = info;
        }
      `,
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
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec3 oldCenter;
        uniform vec3 newCenter;
        uniform float radius;
        uniform float strength;
        uniform vec2 poolSize;
        varying vec2 coord;
        
        float volumeInSphere(vec3 center) {
          // Convert UV to World Pos
          vec3 pos = vec3( (coord.x * 2.0 - 1.0) * poolSize.x/2.0, 0.0, (coord.y * 2.0 - 1.0) * poolSize.y/2.0 );
          
          // Convert normalized center to World Pos
          vec3 worldCenter = vec3(center.x * poolSize.x/2.0, center.y, center.z * poolSize.y/2.0);
          
          vec3 toCenter = pos - worldCenter;
          
          // radius is physical radius
          float t = length(toCenter) / radius;
          float dy = exp(-pow(t * 1.5, 6.0));
          float ymin = min(0.0, worldCenter.y - dy);
          float ymax = min(max(0.0, worldCenter.y + dy), ymin + 2.0 * dy);
          return (ymax - ymin) * strength;
        }
        
        void main() {
          vec4 info = texture2D(textureMap, coord);
          info.r += volumeInSphere(oldCenter);
          info.r -= volumeInSphere(newCenter);
          gl_FragColor = info;
        }
      `,
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
