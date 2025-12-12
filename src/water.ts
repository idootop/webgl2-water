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

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.camera.position.z = 0.5; // Ensure camera is backed off to see the mesh at Z=0
    this.scene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(2, 2);

    this.textureA = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.FloatType, // Equivalent to gl.FLOAT
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
      },
      vertexShader: vertexShader,
      fragmentShader: `
        const float PI = 3.141592653589793;
        uniform sampler2D textureMap;
        uniform vec2 center;
        uniform float radius;
        uniform float strength;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          // center is normalized -1 to 1. coord is 0 to 1.
          // center * 0.5 + 0.5 transforms center to 0-1 space.
          float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
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
      },
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec2 delta;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          vec2 dx = vec2(delta.x, 0.0);
          vec2 dy = vec2(0.0, delta.y);
          float average = (
            texture2D(textureMap, coord - dx).r +
            texture2D(textureMap, coord - dy).r +
            texture2D(textureMap, coord + dx).r +
            texture2D(textureMap, coord + dy).r
          ) * 0.25;
          info.g += (average - info.r) * 2.0;
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
      },
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec2 delta;
        varying vec2 coord;
        void main() {
          vec4 info = texture2D(textureMap, coord);
          vec3 dx = vec3(delta.x, texture2D(textureMap, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
          vec3 dy = vec3(0.0, texture2D(textureMap, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);
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
      },
      vertexShader: vertexShader,
      fragmentShader: `
        uniform sampler2D textureMap;
        uniform vec3 oldCenter;
        uniform vec3 newCenter;
        uniform float radius;
        varying vec2 coord;
        
        float volumeInSphere(vec3 center) {
          vec3 toCenter = vec3(coord.x * 2.0 - 1.0, 0.0, coord.y * 2.0 - 1.0) - center;
          float t = length(toCenter) / radius;
          float dy = exp(-pow(t * 1.5, 6.0));
          float ymin = min(0.0, center.y - dy);
          float ymax = min(max(0.0, center.y + dy), ymin + 2.0 * dy);
          return (ymax - ymin) * 0.1;
        }
        
        void main() {
          vec4 info = texture2D(textureMap, coord);
          /* 
             The logic is:
             Current Water Height += Volume Removed by OLD sphere position
             Current Water Height -= Volume Added by NEW sphere position
             
             Basically: Water flows back in where sphere WAS, and flows out where sphere IS.
          */
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
    // Normalize coordinates to -1..1
    const nx = x / (this.poolWidth / 2);
    const ny = y / (this.poolLength / 2);

    // Normalize radius (approximation)
    const nRadius = radius / ((this.poolWidth + this.poolLength) / 4);

    this.renderTo(renderer, this.dropMaterial, {
      center: new THREE.Vector2(nx, ny),
      radius: nRadius,
      strength,
    });
  }

  moveSphere(
    renderer: THREE.WebGLRenderer,
    oldCenter: THREE.Vector3,
    newCenter: THREE.Vector3,
    radius: number
  ): void {
    // Normalize coordinates
    const scaleX = this.poolWidth / 2;
    const scaleZ = this.poolLength / 2;

    const nOld = oldCenter.clone();
    nOld.x /= scaleX;
    nOld.z /= scaleZ;

    const nNew = newCenter.clone();
    nNew.x /= scaleX;
    nNew.z /= scaleZ;

    const nRadius = radius / ((scaleX + scaleZ) / 2);

    this.renderTo(renderer, this.sphereMaterial, {
      oldCenter: nOld,
      newCenter: nNew,
      radius: nRadius,
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
}
