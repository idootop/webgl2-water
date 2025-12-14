import { helperFunctions } from "./common";

export const causticsVertexShader =
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
 `;

export const causticsFragmentShader =
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
 `;
