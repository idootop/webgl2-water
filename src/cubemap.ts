import { gl } from "./main";

interface CubemapImages {
  xneg: HTMLImageElement;
  xpos: HTMLImageElement;
  yneg: HTMLImageElement;
  ypos: HTMLImageElement;
  zneg: HTMLImageElement;
  zpos: HTMLImageElement;
}

export class Cubemap {
  id: WebGLTexture;

  constructor(images: CubemapImages) {
    this.id = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.id);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // WebGL 2.0 uses sized internal formats
    const internalFormat = gl.RGB8;

    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.xneg
    );
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.xpos
    );
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.yneg
    );
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.ypos
    );
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.zneg
    );
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      0,
      internalFormat,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      images.zpos
    );
  }

  bind(unit?: number): void {
    gl.activeTexture(gl.TEXTURE0 + (unit || 0));
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.id);
  }

  unbind(unit?: number): void {
    gl.activeTexture(gl.TEXTURE0 + (unit || 0));
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }
}
