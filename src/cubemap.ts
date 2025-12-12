import * as THREE from "three";

interface CubemapImages {
  xneg: HTMLImageElement;
  xpos: HTMLImageElement;
  yneg: HTMLImageElement;
  ypos: HTMLImageElement;
  zneg: HTMLImageElement;
  zpos: HTMLImageElement;
}

export class Cubemap {
  texture: THREE.CubeTexture;

  constructor(images: CubemapImages) {
    const imgs = [
      images.xpos,
      images.xneg,
      images.ypos,
      images.yneg,
      images.zpos,
      images.zneg,
    ];

    // Check if any image is missing
    if (imgs.some((img) => !img)) {
      console.error("Cubemap: Some images are missing", images);
      throw new Error("Cubemap: Some images are missing");
    }

    this.texture = new THREE.CubeTexture(imgs);
    this.texture.format = THREE.RGBAFormat; // Typically images are RGBA
    this.texture.type = THREE.UnsignedByteType;
    this.texture.needsUpdate = true;
  }
}
