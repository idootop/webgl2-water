import { helperFunctions } from "./common";

export const waterVertexShader = `
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
`;

export const waterFragmentShader =
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
`;

export const sphereVertexShader =
  helperFunctions +
  `
  varying vec3 vPosition; 
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const sphereFragmentShader =
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
`;

export const cubeVertexShader =
  helperFunctions +
  `
  varying vec3 vPosition;
  void main() {
     vec4 worldPosition = modelMatrix * vec4(position, 1.0);
     vPosition = worldPosition.xyz;
     gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const cubeFragmentShader =
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
`;
