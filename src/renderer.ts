import * as THREE from "three";
import type { Water } from "./water";
import type { Cubemap } from "./cubemap";

const helperFunctions = `
  const float IOR_AIR = 1.0;
  const float IOR_WATER = 1.333;
  const vec3 abovewaterColor = vec3(0.25, 1.0, 1.25);
  const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
  uniform float poolHeight; // This is actually waterDepth
  uniform float wallHeight; // New uniform for wall height above water
  uniform vec2 poolSize; // x: halfWidth, y: halfLength
  uniform vec3 light;
  uniform vec3 sphereCenter;
  uniform float sphereRadius;
  uniform sampler2D tiles;
  uniform sampler2D causticTex;
  uniform sampler2D water;
  
  vec2 intersectCube(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {
    vec3 tMin = (cubeMin - origin) / ray;
    vec3 tMax = (cubeMax - origin) / ray;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    return vec2(tNear, tFar);
  }
  
  float intersectSphere(vec3 origin, vec3 ray, vec3 sphereCenter, float sphereRadius) {
    vec3 toSphere = origin - sphereCenter;
    float a = dot(ray, ray);
    float b = 2.0 * dot(toSphere, ray);
    float c = dot(toSphere, toSphere) - sphereRadius * sphereRadius;
    float discriminant = b*b - 4.0*a*c;
    if (discriminant > 0.0) {
      float t = (-b - sqrt(discriminant)) / (2.0 * a);
      if (t > 0.0) return t;
    }
    return 1.0e6;
  }
  
  vec3 getSphereColor(vec3 point) {
    vec3 color = vec3(0.5);
    
    /* ambient occlusion with walls */
    color *= 1.0 - 0.9 / pow((poolSize.x + sphereRadius - abs(point.x)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((poolSize.y + sphereRadius - abs(point.z)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((point.y + poolHeight + sphereRadius) / sphereRadius, 3.0);
    
    /* caustics */
    vec3 sphereNormal = (point - sphereCenter) / sphereRadius;
    vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    float diffuse = max(0.0, dot(-refractedLight, sphereNormal)) * 0.5;
    vec4 info = texture2D(water, point.xz * 0.5 + 0.5); // NOTE: This assumes point.xz is [-1,1]. If pool is larger, we need to map correctly.
    // If texture is mapped to pool surface, then UV = (point.xz / poolSize / 2.0) + 0.5 ?
    // Actually current logic: 'point.xz * 0.5 + 0.5' implies point.xz is in [-1, 1].
    // If we scale the pool, we want the texture to stretch? Or repeat?
    // Water simulation is usually 0-1 texture. If we stretch the pool, we stretch the simulation.
    // But 'point.xz' will be in [-poolSize.x, poolSize.x].
    // So we need to normalize: 'point.xz / poolSize / 2.0' (wait, poolSize is half dimension).
    // 'point.xz / (poolSize * 2.0) + 0.5' ? No.
    // 'point.xz / (2.0 * poolSize) + 0.5'. 
    // If poolSize = 1.0 (default), then point.xz / 2.0 + 0.5 = point.xz * 0.5 + 0.5. Correct.
    
    vec2 simCoord = point.xz / (poolSize * 2.0) + 0.5; // Normalized to 0-1 for water texture lookups

    // But wait, existing code logic for texture mapping:
    // 'texture2D(water, point.xz * 0.5 + 0.5)'
    // If we change pool size, we likely want the water simulation to span the whole pool.
    
    if (point.y < info.r) {
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) / poolSize.x * 0.5 + 0.5); 
      // Caustic texture mapping might also need adjustment.
      // Original: 0.75 * (pos) * 0.5 + 0.5. 
      // Let's stick to simple mapping for now: map physical pool range to 0-1 texture range.
      
      diffuse *= caustic.r * 4.0;
    }
    color += diffuse;
    
    return color;
  }
  
  vec3 getWallColor(vec3 point) {
    float scale = 0.5;
    
    vec3 wallColor;
    vec3 normal;
    if (abs(point.x) > poolSize.x - 0.01) {
      wallColor = texture2D(tiles, point.yz * 0.5 + vec2(1.0, 0.5)).rgb;
      normal = vec3(-point.x, 0.0, 0.0);
    } else if (abs(point.z) > poolSize.y - 0.01) {
      wallColor = texture2D(tiles, point.yx * 0.5 + vec2(1.0, 0.5)).rgb;
      normal = vec3(0.0, 0.0, -point.z);
    } else {
      wallColor = texture2D(tiles, point.xz * 0.5 + 0.5).rgb;
      normal = vec3(0.0, 1.0, 0.0);
    }
    
    scale /= length(point); /* pool ambient occlusion */
    scale *= 1.0 - 0.9 / pow(length(point - sphereCenter) / sphereRadius, 4.0); /* sphere ambient occlusion */
    
    /* caustics */
    vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    float diffuse = max(0.0, dot(refractedLight, normal));
    
    // Fix water texture lookup
    vec4 info = texture2D(water, point.xz / (poolSize * 2.0) + 0.5);
    
    if (point.y < info.r) {
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) / (poolSize * 2.0) + 0.5);
      scale += diffuse * caustic.r * 2.0 * caustic.g;
    } else {
      /* shadow for the rim of the pool */
      vec2 t = intersectCube(point, refractedLight, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
      diffuse *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (point.y + refractedLight.y * t.y - 2.0 / 12.0)));
      
      scale += diffuse * 0.5;
    }
    
    return wallColor * scale;
  }
`;

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

  // Caustics rendering helper
  causticsMaterial: THREE.ShaderMaterial;
  causticsScene: THREE.Scene;
  causticsCamera: THREE.Camera;
  causticsMesh: THREE.Mesh;

  scene: THREE.Scene;

  // Dimensions
  poolWidth: number = 2;
  poolLength: number = 2;
  poolHeight: number = 1; // This is water depth
  wallHeight: number = 2; // Default existing value

  constructor() {
    this.scene = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    this.tileTexture = loader.load(
      (document.getElementById("tiles") as HTMLImageElement).src
    );
    this.tileTexture.wrapS = THREE.RepeatWrapping;
    this.tileTexture.wrapT = THREE.RepeatWrapping;
    this.tileTexture.minFilter = THREE.LinearMipMapLinearFilter;

    this.lightDir = new THREE.Vector3(2.0, 2.0, -1.0).normalize();

    this.causticTex = new THREE.WebGLRenderTarget(1024, 1024, {
      type: THREE.FloatType, // gl.FLOAT
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
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
      },
      vertexShader: `
        uniform sampler2D water;
        varying vec3 vPosition; 
        void main() {
          vec4 info = texture2D(water, uv);
          
          vec3 pos = vec3(uv.x * 2.0 - 1.0, 0.0, uv.y * 2.0 - 1.0);
          pos.y += info.r;
          
          // Compute world position (assuming modelMatrix handles scaling)
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader:
        helperFunctions +
        `
        uniform vec3 eye;
        varying vec3 vPosition;
        uniform samplerCube sky;
        
            vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {
            vec3 color;
            float q = intersectSphere(origin, ray, sphereCenter, sphereRadius);
            if (q < 1.0e6) {
              color = getSphereColor(origin + ray * q);
            } else if (ray.y < 0.0) {
              vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
              color = getWallColor(origin + ray * t.y);
            } else {
              vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
              vec3 hit = origin + ray * t.y;
              if (hit.y < 2.0 / 12.0) {
                color = getWallColor(hit);
              } else {
                color = textureCube(sky, ray).rgb;
                color += vec3(pow(max(0.0, dot(light, ray)), 5000.0)) * vec3(10.0, 8.0, 6.0);
              }
            }
            if (ray.y < 0.0) color *= waterColor;
            return color;
        }

        void main() {
          vec3 position = vPosition;
          
          // Map world pos to 0-1 for water texture
          vec2 coord = position.xz / (poolSize * 2.0) + 0.5;
          
          vec4 info = texture2D(water, coord);
          
          for (int i = 0; i < 5; i++) {
            coord += info.ba * 0.005;
            info = texture2D(water, coord);
          }
          
          vec3 normal = vec3(info.b, sqrt(1.0 - dot(info.ba, info.ba)), info.a);
          vec3 incomingRay = normalize(position - eye);
          
          vec3 reflectedRay;
          vec3 refractedRay;
          float fresnel;
          
          if (dot(incomingRay, normal) < 0.0) {
            /* above water */
            reflectedRay = reflect(incomingRay, normal);
            refractedRay = refract(incomingRay, normal, IOR_AIR / IOR_WATER);
            fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));
          } else {
            /* below water */
            normal = -normal;
            reflectedRay = reflect(incomingRay, normal);
            refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);
            fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));
          }
          
          vec3 reflectedColor = getSurfaceRayColor(position, reflectedRay, abovewaterColor);
          vec3 refractedColor = vec3(0.0);
          if (length(refractedRay) > 0.001) {
             refractedColor = getSurfaceRayColor(position, refractedRay, abovewaterColor);
          } else {
             fresnel = 1.0; // Total Internal Reflection
          }
          
          gl_FragColor = vec4(mix(refractedColor, reflectedColor, fresnel), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    this.waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);

    // --- Sphere ---
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
      vertexShader:
        helperFunctions +
        `
        varying vec3 vPosition; 
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader:
        helperFunctions +
        `
        varying vec3 vPosition; 
        void main() {
          vec3 position = vPosition;
          gl_FragColor = vec4(getSphereColor(position), 1.0);
          vec4 info = texture2D(water, position.xz / (poolSize * 2.0) + 0.5);
          if (position.y < info.r) {
            gl_FragColor.rgb *= underwaterColor * 1.2;
          }
        }
      `,
    });
    this.sphereMesh = new THREE.Mesh(sphereGeometry, this.sphereMaterial);
    this.scene.add(this.sphereMesh);

    // --- Cube (Pool) ---
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
      vertexShader:
        helperFunctions +
        `
        varying vec3 vPosition;
        void main() {
           // Standard vertex shader for box is fine, but we need world position for varying
           vec4 worldPosition = modelMatrix * vec4(position, 1.0);
           vPosition = worldPosition.xyz;
           gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader:
        helperFunctions +
        `
        varying vec3 vPosition;
        void main() {
          if (vPosition.y > wallHeight - 0.001) discard;
          
          vec3 position = vPosition;
          gl_FragColor = vec4(getWallColor(position), 1.0);
          vec4 info = texture2D(water, position.xz / (poolSize * 2.0) + 0.5);
          if (position.y < info.r) {
            gl_FragColor.rgb *= underwaterColor * 1.2;
          }
        }
      `,
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
      vertexShader:
        helperFunctions +
        `
            varying vec3 oldPos;
            varying vec3 newPos;
            varying vec3 ray;

            vec3 project(vec3 origin, vec3 ray, vec3 refractedLight) {
              vec2 tcube = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
              origin += ray * tcube.y;
              float tplane = (-origin.y - 1.0) / refractedLight.y;
              return origin + refractedLight * tplane;
            }

            void main() {
              vec4 info = texture2D(water, uv);
              info.ba *= 0.5;
              vec3 normal = vec3(info.b, sqrt(1.0 - dot(info.ba, info.ba)), info.a);

              vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
              ray = refract(-light, normal, IOR_AIR / IOR_WATER);
              
              // We need to map UV (0-1) to world pos based on poolSize
              vec3 rawPos = vec3(uv.x * 2.0 - 1.0, 0.0, uv.y * 2.0 - 1.0);
              // Scale rawPos by poolSize.x/y ?
              // But 'project' uses world coordinates.
              // The simulation (water texture) maps 0-1 to the whole pool surface.
              // So world X = (uv.x * 2.0 - 1.0) * poolSize.x
              //    world Z = (uv.y * 2.0 - 1.0) * poolSize.y
              
              // However, the original code used 'uv.x*2.0 - 1.0' directly, assuming poolSize=1 (range -1 to 1).
              // So we should multiply by poolSize.
              
              rawPos.x *= poolSize.x;
              rawPos.z *= poolSize.y;
              
              oldPos = project(rawPos, refractedLight, refractedLight);
              newPos = project(rawPos + vec3(0.0, info.r, 0.0), ray, refractedLight);
              
              // Mapping back to -1 to 1 for rendering to causticTex
              // gl_Position should correspond to the caustic texture space.
              // The caustic texture is also mapped to the pool surface.
              // So we reverse the mapping:
              // NormalizedPos = newPos / poolSize
              // gl_Position = ...
              
              gl_Position = vec4(0.75 * (newPos.xz + refractedLight.xz / refractedLight.y) / poolSize.x, 0.0, 1.0);
            }
         `,
      fragmentShader:
        helperFunctions +
        `
            varying vec3 oldPos;
            varying vec3 newPos;
            varying vec3 ray;

            void main() {
               float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));
               float newArea = length(dFdx(newPos)) * length(dFdy(newPos));
               gl_FragColor = vec4(oldArea / newArea * 0.2, 1.0, 0.0, 0.0);

               vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
               
               vec3 dir = (sphereCenter - newPos) / sphereRadius;
               vec3 area = cross(dir, refractedLight);
               float shadow = dot(area, area);
               float dist = dot(dir, -refractedLight);
               shadow = 1.0 + (shadow - 1.0) / (0.05 + dist * 0.025);
               shadow = clamp(1.0 / (1.0 + exp(-shadow)), 0.0, 1.0);
               shadow = mix(1.0, shadow, clamp(dist * 2.0, 0.0, 1.0));
               gl_FragColor.g = shadow;

               vec2 t = intersectCube(newPos, -refractedLight, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
               gl_FragColor.r *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (newPos.y - refractedLight.y * t.y - 2.0 / 12.0)));
            }
         `,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
      depthTest: false,
    });

    this.causticsMesh = new THREE.Mesh(waterGeometry, this.causticsMaterial);
    this.causticsScene.add(this.causticsMesh);
  }

  updateDimensions(
    width: number,
    length: number,
    depth: number,
    wallHeight: number
  ) {
    this.poolWidth = width;
    this.poolLength = length;
    this.poolHeight = depth;
    this.wallHeight = wallHeight;

    const poolSizeVal = new THREE.Vector2(width / 2, length / 2);

    // Update Mesh Scales
    // Water Mesh: PlaneGeometry(2,2) -> Scale to (width/2, 1, length/2) implies size (width, 1, length)
    this.waterMesh.scale.set(width / 2, 1, length / 2);

    // Cube Mesh: BoxGeometry(2,2,2) -> Scale to (width/2, (depth + wallHeight)/2, length/2)
    // Box center Y needs to be adjusted.
    // Box range: -1 to 1. Scaled: -(d+w)/2 to (d+w)/2.
    // Desired range: -depth to wallHeight.
    // Center of desired range: (wallHeight - depth) / 2.
    // Height: depth + wallHeight.

    const height = depth + wallHeight;
    this.cubeMesh.scale.set(width / 2, Math.max(height / 2, 0.01), length / 2);
    this.cubeMesh.position.y = (wallHeight - depth) / 2;

    // Update Uniforms
    const updateMaterial = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.poolHeight.value = depth;
      mat.uniforms.wallHeight.value = wallHeight;
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

  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    water: Water,
    sky: Cubemap
  ): void {
    // Update uniforms
    this.waterMaterial.uniforms["water"].value = water.textureA.texture;
    this.waterMaterial.uniforms["sky"].value = sky.texture;
    this.waterMaterial.uniforms["eye"].value = camera.position;
    this.waterMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.waterMaterial.uniforms["sphereRadius"].value = this.sphereRadius;

    this.sphereMaterial.uniforms["water"].value = water.textureA.texture;
    this.sphereMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.sphereMaterial.uniforms["sphereRadius"].value = this.sphereRadius;

    this.sphereMesh.position.copy(this.sphereCenter);
    this.sphereMesh.scale.setScalar(this.sphereRadius);
    this.sphereMesh.updateMatrixWorld();

    this.cubeMaterial.uniforms["water"].value = water.textureA.texture;
    this.cubeMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.cubeMaterial.uniforms["sphereRadius"].value = this.sphereRadius;

    renderer.render(this.scene, camera);
  }
}
