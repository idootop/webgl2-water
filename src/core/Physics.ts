import * as THREE from "three";
import type { Water } from "./Water";
import { InputManager, MODE_MOVE_SPHERE } from "./InputManager";

export class PhysicsEngine {
  center: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  oldCenter: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  velocity: THREE.Vector3 = new THREE.Vector3();
  gravity: THREE.Vector3 = new THREE.Vector3(0, -4, 0);

  radius: number = 0.25;

  // Environment dimensions
  poolWidth: number = 2;
  poolLength: number = 2;
  poolDepth: number = 0;

  // Physics parameters
  sphereFloatRatio: number = 0.7;
  sphereImpactStrength: number = 0.04;
  useSpherePhysics: boolean = true;

  update(
    seconds: number,
    water: Water,
    inputManager: InputManager,
    renderer: THREE.WebGLRenderer
  ) {
    if (inputManager.mode === MODE_MOVE_SPHERE) {
      this.velocity.set(0, 0, 0);
    } else if (this.useSpherePhysics) {
      // Get water info at current position for buoyancy
      const waterInfo = water.getWaterAt(
        renderer,
        this.center.x,
        this.center.z
      );
      const waterHeight = waterInfo.height;

      const percentUnderWater = Math.max(
        0,
        Math.min(
          1,
          (waterHeight + this.radius - this.center.y) / (2 * this.radius)
        )
      );

      const buoyancyFactor = 1.0 / (1.0 - this.sphereFloatRatio);

      // Gravity and Buoyancy (Vertical)
      const gTerm = this.gravity
        .clone()
        .multiplyScalar(seconds - buoyancyFactor * seconds * percentUnderWater);
      this.velocity.add(gTerm);

      // Mouse Interaction (Repulsion)
      if (inputManager.mousePoint) {
        const distVec = this.center.clone().sub(inputManager.mousePoint);
        distVec.y = 0; // Horizontal only
        const dist = distVec.length();
        const influenceRadius = 1;

        if (dist < influenceRadius) {
          const pushStrength = 2.0;
          // Closer = stronger push
          const force = distVec
            .normalize()
            .multiplyScalar(
              pushStrength * (1.0 - dist / influenceRadius) * seconds
            );
          this.velocity.add(force);
        }
      }

      if (this.velocity.lengthSq() > 0) {
        const drag = this.velocity
          .clone()
          .normalize()
          .multiplyScalar(
            percentUnderWater * seconds * this.velocity.dot(this.velocity)
          );
        this.velocity.sub(drag);
      }

      this.center.add(this.velocity.clone().multiplyScalar(seconds));

      // Wall collision (X)
      if (this.center.x < this.radius - this.poolWidth / 2) {
        this.center.x = this.radius - this.poolWidth / 2;
        this.velocity.x = Math.abs(this.velocity.x) * 0.5;
      } else if (this.center.x > this.poolWidth / 2 - this.radius) {
        this.center.x = this.poolWidth / 2 - this.radius;
        this.velocity.x = -Math.abs(this.velocity.x) * 0.5;
      }

      // Wall collision (Z)
      if (this.center.z < this.radius - this.poolLength / 2) {
        this.center.z = this.radius - this.poolLength / 2;
        this.velocity.z = Math.abs(this.velocity.z) * 0.5;
      } else if (this.center.z > this.poolLength / 2 - this.radius) {
        this.center.z = this.poolLength / 2 - this.radius;
        this.velocity.z = -Math.abs(this.velocity.z) * 0.5;
      }

      // Floor collision
      if (this.center.y < this.radius - this.poolDepth) {
        this.center.y = this.radius - this.poolDepth;
        this.velocity.y = Math.abs(this.velocity.y) * 0.7;
      }
    }

    // Water Interaction
    water.moveSphere(
      renderer,
      this.oldCenter,
      this.center,
      this.radius,
      this.sphereImpactStrength
    );
    this.oldCenter.copy(this.center);
  }
}
