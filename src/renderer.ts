import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Water } from "./water";

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
    vec4 info = texture2D(water, point.xz / (poolSize * 2.0) + 0.5);
    
    if (point.y < info.r) {
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) / poolSize.x * 0.5 + 0.5); 
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

  // Duck related
  duckMesh: THREE.Object3D | null = null;
  duckReflectionTex: THREE.WebGLRenderTarget;
  reflectionCamera: THREE.PerspectiveCamera;
  textureMatrix: THREE.Matrix4 = new THREE.Matrix4();

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

    this.duckReflectionTex = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });

    this.reflectionCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

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
        duckReflection: { value: this.duckReflectionTex.texture },
        textureMatrix: { value: new THREE.Matrix4() },
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
        uniform sampler2D sky;
        uniform sampler2D duckReflection;
        uniform mat4 textureMatrix;
        
            vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {
            vec3 color;
            float q = intersectSphere(origin, ray, sphereCenter, sphereRadius);
            
            // NOTE: We keep sphere intersection for 'underwater' look if needed, 
            // but for reflection above water, we prefer the texture if available.
            // Actually, let's keep the logic: checks sphere first. 
            // If the sphere is hidden, we shouldn't see it? 
            // But we use the sphere for physics visualization fallback?
            // Let's remove sphere rendering from reflection if duck is present.
            // Since we can't easily toggle in shader, we'll assume the texture covers the duck.
            
            bool hitSphere = false;
            if (q < 1.0e6) {
               // color = getSphereColor(origin + ray * q);
               // hitSphere = true;
               // Hiding sphere reflection to show duck
            } 
            
            if (!hitSphere) {
              if (ray.y < 0.0) {
                vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
                color = getWallColor(origin + ray * t.y);
              } else {
                vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
                vec3 hit = origin + ray * t.y;
                if (hit.y < 2.0 / 12.0) {
                  color = getWallColor(hit);
                } else {
                  // Sky Dome Mapping
                  vec2 uv = ray.xz * 0.5 + 0.5;
                  color = texture2D(sky, uv).rgb;
                  color += vec3(pow(max(0.0, dot(light, ray)), 5000.0)) * vec3(10.0, 8.0, 6.0);
                }
              }
            }
            
            // Apply Duck Reflection (Planar)
            // We project the origin (surface point) to reflection texture space
            // Ideally we should project 'origin + ray * dist', but planar reflection works on surface.
            // Simple Projective Texture Mapping
            vec4 clipPos = textureMatrix * vec4(origin, 1.0);
            vec3 clipPos3 = clipPos.xyz / clipPos.w;
            if (clipPos3.z > 0.0 && clipPos3.z < 1.0) { // Check if in front of camera
                 vec2 reflectionUV = clipPos3.xy * 0.5 + 0.5;
                 // Simple perturbation by normal could happen in caller, but here 'origin' is on water.
                 // We can use the 'normal' available in main to perturb UV? 
                 // Not available in this function.
                 
                 vec4 duckCol = texture2D(duckReflection, reflectionUV);
                 // Blend based on alpha
                 color = mix(color, duckCol.rgb, duckCol.a);
            }

            if (ray.y < 0.0) color *= waterColor;
            return color;
        }

        void main() {
          vec3 position = vPosition;
          
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
          
          // Pass normal-perturbed coordinate to getSurfaceRayColor? 
          // For now, simple planar reflection in getSurfaceRayColor uses exact surface pos.
          
          vec3 reflectedColor = getSurfaceRayColor(position, reflectedRay, abovewaterColor);
          
          if (length(refractedRay) <= 0.001) {
             fresnel = 1.0; // Total Internal Reflection
          }
          
          gl_FragColor = vec4(reflectedColor, fresnel);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
    });
    this.waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.waterMesh.frustumCulled = false;
    this.scene.add(this.waterMesh);

    // --- Sphere ---
    // Keep sphere mesh for visual debugging or if duck fails to load, but hide it by default?
    // User wants to REPLACE sphere.
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
    this.sphereMesh.visible = false; // Hide sphere
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
              
              vec3 rawPos = vec3(uv.x * 2.0 - 1.0, 0.0, uv.y * 2.0 - 1.0);
              rawPos.x *= poolSize.x;
              rawPos.z *= poolSize.y;
              
              oldPos = project(rawPos, refractedLight, refractedLight);
              newPos = project(rawPos + vec3(0.0, info.r, 0.0), ray, refractedLight);
              
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

  loadDuck(url: string) {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      this.duckMesh = gltf.scene;

      // Center and scale duck if needed
      const box = new THREE.Box3().setFromObject(this.duckMesh);
      const size = box.getSize(new THREE.Vector3());

      // Assuming we want the duck to be roughly size of sphere (radius 0.25 -> diameter 0.5)
      const targetSize = 0.5;
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = targetSize / maxDim;
      this.duckMesh.scale.setScalar(scale);

      // Adjust position so it sits on origin (y=0 is water level)
      // The model origin might be at feet.

      // Add lighting for the duck
      // We can add lights to the scene, or the gltf might have lights (usually not).
      // We'll add some lights to the main scene.

      // Ensure materials are MeshStandardMaterial or similar
      this.duckMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // Ensure material is reactive to light
          if (child.material) {
            child.material.needsUpdate = true;
          }
        }
      });

      this.scene.add(this.duckMesh);
    });

    // Add lighting to scene for Duck
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.copy(this.lightDir).multiplyScalar(10);
    this.scene.add(dirLight);
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

    this.waterMesh.scale.set(width / 2, 1, length / 2);

    const height = depth + wallHeight;
    this.cubeMesh.scale.set(width / 2, Math.max(height / 2, 0.01), length / 2);
    this.cubeMesh.position.y = (wallHeight - depth) / 2;

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

  renderDuckReflection(
    renderer: THREE.WebGLRenderer,
    mainCamera: THREE.Camera
  ) {
    if (!this.duckMesh) return;

    // Setup Reflection Camera
    // Reflect camera position across Y=0 plane (Water surface at rest)
    // Actually water surface fluctuates, but planar reflection usually assumes flat plane.

    this.reflectionCamera.copy(mainCamera as THREE.PerspectiveCamera);

    // Reflect position
    this.reflectionCamera.position.y = -mainCamera.position.y;

    // Reflect view direction?
    // LookAt logic: Camera looks at target.
    // If main camera looks at (0, 0.5, 0), reflection camera looks at (0, -0.5, 0).
    // We can just construct the matrix.
    // Or simpler: Scale world by (1, -1, 1).

    // Let's use scale approach on a Group containing the Duck.
    // But Duck is in main scene.
    // We'll move Duck to a position/scale for reflection rendering?
    // Or just use the camera technique:
    // A camera at (x, -y, z) looking at (tx, -ty, tz) produces the reflection image.
    // But we also need to invert the up vector?

    const p = mainCamera.position;
    const t = new THREE.Vector3(0, 0.5, 0); // Approx lookat target

    this.reflectionCamera.position.set(p.x, -p.y, p.z);
    this.reflectionCamera.lookAt(t.x, -t.y, t.z);
    // We also need to flip the image horizontally?
    // A mirror reflection flips the image.
    // Rendering with scale(1, -1, 1) on camera is tricky in Three.js (projection matrix).

    // Standard Planar Reflection in Three.js often uses a separate Scene or "virtual" object.

    // Let's try: Hide everything except Duck.
    this.waterMesh.visible = false;
    this.cubeMesh.visible = false; // Walls reflection handled by raytracing, so we don't need them in texture?
    this.sphereMesh.visible = false;

    // If we only render the Duck, we get a texture with just the duck.
    // We need to clear with alpha=0.

    // Camera Up vector needs to be flipped?
    // Main camera up is usually (0,1,0).
    // Reflection camera up should be (0,-1,0)?
    // this.reflectionCamera.up.set(0, -1, 0); // Wait, if we flip Y, up flips too.
    // But three.js lookAt recomputes matrix.

    // Let's use the GL matrix approach for reflection matrix.
    // Reflect across Y=0: Scale(1, -1, 1).
    // If we apply this to the Scene, we can use the Main Camera!
    // But we can't easily apply to Scene without affecting Main render.
    // We can apply to Duck Mesh temporarily.

    const oldScale = this.duckMesh.scale.clone();
    const oldPos = this.duckMesh.position.clone();

    // Reflect the object across water plane.
    // Duck is at (x, y, z). Reflected duck is at (x, -y, z).
    // And we need to wind triangles correctly? (Culling)
    // If we scale Y by -1, faces invert. We need to invert culling or use DoubleSide.

    this.duckMesh.position.y = -oldPos.y;
    this.duckMesh.scale.y = -oldScale.y;

    // Render
    renderer.setRenderTarget(this.duckReflectionTex);
    renderer.setClearColor(0x000000, 0); // Transparent background
    renderer.clear();

    // We need to render the duck faces that are usually hidden?

    // If we just change camera position to (x, -y, z) and look at (tx, -ty, tz),
    // we are looking UP at the duck from below.
    // This is what the water "sees" (reflection).
    // So we don't need to invert the Duck model. We just move the camera.

    // Reset Duck changes (we won't apply them)
    this.duckMesh.position.copy(oldPos);
    this.duckMesh.scale.copy(oldScale);

    // Correct approach: Mirror Camera
    // Main Camera: (x, y, z).
    // Mirror Camera: (x, -y, z).
    // LookAt: (0, 0.5, 0) -> (0, -0.5, 0).
    // Up: (0, 1, 0) -> (0, -1, 0).
    // And we need to render the Duck (which is at +y).

    this.reflectionCamera.position.set(p.x, -p.y, p.z);
    this.reflectionCamera.up.set(0, -1, 0);
    this.reflectionCamera.lookAt(0, -0.5, 0); // Rough approximation
    this.reflectionCamera.updateMatrixWorld();

    // Calculate Texture Matrix for Shader
    // We need to map World Position -> Texture UV.
    // TexMatrix = Bias * Projection * View
    const textureMatrix = new THREE.Matrix4();
    textureMatrix.set(
      0.5,
      0.0,
      0.0,
      0.5,
      0.0,
      0.5,
      0.0,
      0.5,
      0.0,
      0.0,
      0.5,
      0.5,
      0.0,
      0.0,
      0.0,
      1.0
    );
    textureMatrix.multiply(this.reflectionCamera.projectionMatrix);
    textureMatrix.multiply(this.reflectionCamera.matrixWorldInverse);
    this.textureMatrix.copy(textureMatrix);

    renderer.render(this.scene, this.reflectionCamera);

    renderer.setRenderTarget(null);

    // Restore visibility
    this.waterMesh.visible = true;
    this.cubeMesh.visible = true;
    // this.sphereMesh.visible = true;
  }

  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    water: Water,
    sky: THREE.Texture
  ): void {
    // 1. Update Duck Position from Physics (represented by sphereCenter)
    if (this.duckMesh) {
      this.duckMesh.position.copy(this.sphereCenter);
      // Maybe add some wobbling or rotation based on velocity?

      // Render Reflection Pass
      this.renderDuckReflection(renderer, camera);
    }

    // Update uniforms
    this.waterMaterial.uniforms["water"].value = water.textureA.texture;
    this.waterMaterial.uniforms["sky"].value = sky;
    this.waterMaterial.uniforms["eye"].value = camera.position;
    this.waterMaterial.uniforms["sphereCenter"].value = this.sphereCenter;
    this.waterMaterial.uniforms["sphereRadius"].value = this.sphereRadius;
    this.waterMaterial.uniforms["textureMatrix"].value = this.textureMatrix;

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
