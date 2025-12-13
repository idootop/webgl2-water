import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Water } from "./water";

const helperFunctions = `
  const float IOR_AIR = 1.0;
  const float IOR_WATER = 1.333;
  const vec3 abovewaterColor = vec3(0.25, 1.0, 1.25);
  const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
  uniform float poolHeight;
  uniform float wallHeight;
  uniform vec2 poolSize;
  uniform vec3 light;
  uniform vec3 sphereCenter;
  uniform float sphereRadius;
  uniform sampler2D tiles;
  uniform sampler2D causticTex;
  uniform sampler2D water;
  uniform sampler2D duckRefraction;
  uniform vec2 resolution;

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
    
    color *= 1.0 - 0.9 / pow((poolSize.x + sphereRadius - abs(point.x)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((poolSize.y + sphereRadius - abs(point.z)) / sphereRadius, 3.0);
    color *= 1.0 - 0.9 / pow((point.y + poolHeight + sphereRadius) / sphereRadius, 3.0);
    
    vec3 sphereNormal = (point - sphereCenter) / sphereRadius;
    vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    float diffuse = max(0.0, dot(-refractedLight, sphereNormal)) * 0.5;
    vec4 info = texture2D(water, point.xz / (poolSize * 2.0) + 0.5);
    
    if (point.y < info.r) {
      // Fixed aspect ratio sampling for caustics on sphere
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) / (poolSize * 2.0) + 0.5); 
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
    
    scale /= length(point); 
    scale *= 1.0 - 0.9 / pow(length(point - sphereCenter) / sphereRadius, 4.0); 
    
    vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    float diffuse = max(0.0, dot(refractedLight, normal));
    
    vec4 info = texture2D(water, point.xz / (poolSize * 2.0) + 0.5);
    
    if (point.y < info.r) {
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) / (poolSize * 2.0) + 0.5);
      scale += diffuse * caustic.r * 2.0 * caustic.g;
    } else {
      vec2 t = intersectCube(point, refractedLight, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
      diffuse *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (point.y + refractedLight.y * t.y - wallHeight)));
      
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

  causticsMaterial: THREE.ShaderMaterial;
  causticsScene: THREE.Scene;
  causticsCamera: THREE.Camera;
  causticsMesh: THREE.Mesh;

  scene: THREE.Scene;

  duckMesh: THREE.Object3D | null = null;
  dirLight: THREE.DirectionalLight | null = null;

  // 渲染纹理 Render Targets
  duckRefractionTex: THREE.WebGLRenderTarget;
  resolution: THREE.Vector2 = new THREE.Vector2();

  poolWidth: number = 2;
  poolLength: number = 2;
  poolHeight: number = 2;
  wallHeight: number = 1;

  constructor() {
    this.scene = new THREE.Scene();

    const loader = new THREE.TextureLoader();
    const tileImg = document.getElementById("tiles") as HTMLImageElement;
    this.tileTexture = loader.load(tileImg ? tileImg.src : "");
    this.tileTexture.wrapS = THREE.RepeatWrapping;
    this.tileTexture.wrapT = THREE.RepeatWrapping;
    this.tileTexture.minFilter = THREE.LinearMipMapLinearFilter;

    this.lightDir = new THREE.Vector3(-1, 1, 1).normalize();

    this.causticTex = new THREE.WebGLRenderTarget(1024, 1024, {
      type: THREE.FloatType,
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
      vertexShader: `
        uniform sampler2D water;
        varying vec3 vPosition; 
        void main() {
          vec4 info = texture2D(water, uv);
          
          vec3 pos = vec3(uv.x * 2.0 - 1.0, 0.0, uv.y * 2.0 - 1.0);
          pos.y += info.r;
          
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
        
        vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {
            vec3 color;
            if (ray.y < 0.0) {
              vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
              color = getWallColor(origin + ray * t.y);
            } else {
              vec2 t = intersectCube(origin, ray, vec3(-poolSize.x, -poolHeight, -poolSize.y), vec3(poolSize.x, wallHeight, poolSize.y));
              vec3 hit = origin + ray * t.y;
              if (hit.y < wallHeight - 0.001) {
                color = getWallColor(hit);
              } else {
                vec2 uv = ray.xz * 0.5 + 0.5;
                color = texture2D(sky, uv).rgb;
                color += vec3(pow(max(0.0, dot(light, ray)), 5000.0)) * vec3(10.0, 8.0, 6.0);
              }
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
            /* 水面上方 (Above Water) */
            reflectedRay = reflect(incomingRay, normal);
            refractedRay = refract(incomingRay, normal, IOR_AIR / IOR_WATER);
            fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));
          } else {
            /* 水面下方 (Below Water) */
            normal = -normal;
            reflectedRay = reflect(incomingRay, normal);
            refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);
            fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));
          }
          
          vec3 reflectedColor = getSurfaceRayColor(position, reflectedRay, abovewaterColor);
          vec3 refractedColor = vec3(0.0);
          
          if (length(refractedRay) > 0.001) {
             refractedColor = getSurfaceRayColor(position, refractedRay, abovewaterColor);

             // --- 鸭子折射 (Refraction) ---
             // 只有当存在折射光线时才计算
             // 1. 计算当前像素的屏幕坐标 (0-1)
             vec2 screenUV = gl_FragCoord.xy / resolution;
             
             // 2. 根据法线进行偏移 (Screen Space Refraction)
             // Use aspect-correct offset strength
             vec2 refractionUV = screenUV - (normal.xz * vec2(0.05, 0.05 * resolution.x / resolution.y)); 
             
             // 3. 采样之前渲染好的鸭子纹理
             vec4 duckSample = texture2D(duckRefraction, refractionUV);
             
             // 4. 混合：如果纹理有内容 (alpha > 0)，则覆盖射线追踪的墙壁颜色
             // 这样我们就能看到被水扭曲的鸭子身体
             refractedColor = mix(refractedColor, duckSample.rgb, duckSample.a);
             
          } else {
             fresnel = 1.0; // 全反射
          }
          
          gl_FragColor = vec4(mix(refractedColor, reflectedColor, fresnel), 1.0);
        }
      `,
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
              
              // Correct projection to cover full texture regardless of aspect ratio
              gl_Position = vec4(0.75 * (newPos.xz + refractedLight.xz / refractedLight.y) / poolSize, 0.0, 1.0);
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
               
               // Shadow calculation (based on Sphere math)
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
               gl_FragColor.r *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (newPos.y - refractedLight.y * t.y - wallHeight)));
            }
         `,
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

  // 新增：渲染折射纹理 (从主相机视角渲染鸭子)
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
      this.duckMesh.position.copy(this.sphereCenter);
      // 让鸭子相对小球的位置向下来一点
      this.duckMesh.position.y -= 0.2;

      // 鸭子上下起伏
      const time = Date.now() * 0.004;
      const bobbingAmount = Math.sin(time) * 0.1;
      this.duckMesh.position.y += bobbingAmount;

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
