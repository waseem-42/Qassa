import type { Clip, Grade, Picture } from '@edit/shared';

// Live grade preview. The shader mirrors the ffmpeg chain the renderer uses —
// lut3d (trilinear) → eq (on limited-range luma, like vf_eq) → colortemperature —
// so the preview matches the exported file.

const VS = `#version 300 es
in vec2 pos;
out vec2 uv;
uniform vec2 uvOffset, uvScale;
void main() {
  vec2 o = pos * 0.5 + 0.5;
  uv = uvOffset + vec2(o.x, 1.0 - o.y) * uvScale;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler2D frame;
uniform sampler3D lut;
uniform float lutSize, lutMix, useLut;
uniform float brightness, contrast, saturation, gamma, useEq;
uniform vec3 temp;
uniform float useTemp;

vec3 toYuv(vec3 c) { // BT.709, limited range, 0..1 code values
  float y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return vec3(16.0/255.0 + y * 219.0/255.0, (c.b - y) / 1.8556 * 224.0/255.0, (c.r - y) / 1.5748 * 224.0/255.0);
}
vec3 toRgb(vec3 v) {
  float y = (v.x - 16.0/255.0) * 255.0/219.0;
  float u = v.y * 255.0/224.0 * 1.8556, w = v.z * 255.0/224.0 * 1.5748;
  float r = y + w, b = y + u;
  float g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}

void main() {
  vec3 c = texture(frame, uv).rgb;
  if (useLut > 0.5) {
    vec3 k = c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
    c = mix(c, texture(lut, k).rgb, lutMix);
  }
  if (useEq > 0.5) {
    vec3 v = toYuv(clamp(c, 0.0, 1.0));
    float y = contrast * (v.x - 0.5) + 0.5 + brightness;
    y = y <= 0.0 ? 0.0 : min(1.0, pow(y, 1.0 / gamma));
    c = toRgb(vec3(y, v.y * saturation, v.z * saturation));
  }
  if (useTemp > 0.5) c *= temp;
  color = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** ffmpeg vf_colortemperature kelvin2rgb */
export function kelvinToRgb(k: number): [number, number, number] {
  const kelvin = k / 100;
  let r: number, g: number, b: number;
  if (kelvin <= 66) {
    r = 1;
    g = (99.4708025861 * Math.log(kelvin) - 161.1195681661) / 255;
  } else {
    r = (329.698727446 * Math.pow(kelvin - 60, -0.1332047592)) / 255;
    g = (288.1221695283 * Math.pow(kelvin - 60, -0.0755148492)) / 255;
  }
  if (kelvin >= 66) b = 1;
  else if (kelvin <= 19) b = 0;
  else b = (138.5177312231 * Math.log(kelvin - 10) - 305.0447927307) / 255;
  const c = (x: number) => Math.min(1, Math.max(0, x));
  return [c(r), c(g), c(b)];
}

export function parseCube(text: string): { size: number; data: Float32Array } {
  let size = 0;
  const vals: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1]);
    else if (/^[-\d.]/.test(line)) {
      const [r, g, b] = line.split(/\s+/).map(Number);
      vals.push(r, g, b);
    }
  }
  if (!size || vals.length !== size ** 3 * 3) throw new Error('invalid .cube file');
  return { size, data: new Float32Array(vals) };
}

export interface View { uvOffset: [number, number]; uvScale: [number, number] }

/** Cover-fit + zoom around a focus point, matching framingFilters() in the renderer. */
export function framing(iw: number, ih: number, W: number, H: number, scale: number, fx: number, fy: number): View {
  const s = Math.max(W / iw, H / ih) * scale;
  const sw = iw * s, sh = ih * s;
  const x = Math.min(Math.max(sw * fx - W / 2, 0), sw - W);
  const y = Math.min(Math.max(sh * fy - H / 2, 0), sh - H);
  return { uvOffset: [x / sw, y / sh], uvScale: [W / sw, H / sh] };
}

/**
 * A clip's picture settings for the preview canvas: the view into the (cropped) source, and the box
 * the canvas takes in the frame (the whole frame, or the fitted picture's rectangle) as [x, y, w, h] fractions.
 * Flip and rotation are CSS on the canvas; the render does the same with ffmpeg.
 */
export function pictureView(iw: number, ih: number, W: number, H: number, tr: { scale: number; x: number; y: number }, pic?: Picture): { view: View; box: [number, number, number, number] } {
  const c = pic?.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const kx = 1 - c.l - c.r, ky = 1 - c.t - c.b;
  const cw = iw * kx, ch = ih * ky;
  let v: View = { uvOffset: [0, 0], uvScale: [1, 1] }, box: [number, number, number, number] = [0, 0, 1, 1];
  if (pic?.fit === 'fit') {
    const s = Math.min(W / cw, H / ch), bw = (cw * s) / W, bh = (ch * s) / H;
    box = [(1 - bw) / 2, (1 - bh) / 2, bw, bh];
  } else v = framing(cw, ch, W, H, tr.scale, tr.x, tr.y);
  return { view: { uvOffset: [c.l + v.uvOffset[0] * kx, c.t + v.uvOffset[1] * ky], uvScale: [v.uvScale[0] * kx, v.uvScale[1] * ky] }, box };
}

/** The sound level a clip's own fades give at timeline time t (1 outside them). */
export function fadeGain(c: Pick<Clip, 'start' | 'in' | 'out' | 'speed' | 'fadeIn' | 'fadeOut'>, t: number, fallback = 0): number {
  const len = (c.out - c.in) / c.speed, a = t - c.start, b = c.start + len - t;
  const fin = c.fadeIn ?? fallback, fout = c.fadeOut ?? fallback;
  return Math.max(0, Math.min(1, fin > 0 ? a / fin : 1, fout > 0 ? b / fout : 1));
}

export class GradeRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private frameTex: WebGLTexture;
  private luts = new Map<string, { tex: WebGLTexture; size: number } | 'loading' | 'failed'>();
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    this.prog = prog;
    gl.useProgram(prog);
    for (const n of ['uvOffset', 'uvScale', 'frame', 'lut', 'lutSize', 'lutMix', 'useLut', 'brightness', 'contrast', 'saturation', 'gamma', 'useEq', 'temp', 'useTemp'])
      this.u[n] = gl.getUniformLocation(prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.frameTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(this.u.frame, 0);
    gl.uniform1i(this.u.lut, 1);
  }

  /** Starts loading a LUT; returns it once ready. */
  lut(url: string) {
    const have = this.luts.get(url);
    if (have && have !== 'loading' && have !== 'failed') return have;
    if (!have) {
      this.luts.set(url, 'loading');
      fetch(url)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
        .then((txt) => {
          const { size, data } = parseCube(txt);
          const gl = this.gl;
          const tex = gl.createTexture()!;
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_3D, tex);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
          for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]])
            gl.texParameteri(gl.TEXTURE_3D, k, v);
          gl.activeTexture(gl.TEXTURE0);
          this.luts.set(url, { tex, size });
        })
        .catch(() => this.luts.set(url, 'failed'));
    }
    return undefined;
  }

  /** mix < 1 blends this frame over what is already drawn (transitions in the preview). */
  draw(video: HTMLVideoElement | HTMLImageElement, grade: Grade | undefined, lutUrl: string | undefined, view: View, mix = 1) {
    const gl = this.gl;
    const { canvas } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (video instanceof HTMLImageElement ? !video.complete || !video.naturalWidth : video.readyState < 2) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    gl.uniform2f(this.u.uvOffset, ...view.uvOffset);
    gl.uniform2f(this.u.uvScale, ...view.uvScale);

    const lut = lutUrl && grade?.lut ? this.lut(lutUrl) : undefined;
    gl.uniform1f(this.u.useLut, lut && (grade?.lutMix ?? 1) > 0.001 ? 1 : 0);
    if (lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lut.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(this.u.lutSize, lut.size);
      gl.uniform1f(this.u.lutMix, grade?.lutMix ?? 1);
    }
    const g = grade;
    const eq = !!g && (g.exposure !== 0 || g.contrast !== 1 || g.saturation !== 1 || g.gamma !== 1);
    gl.uniform1f(this.u.useEq, eq ? 1 : 0);
    if (g) {
      gl.uniform1f(this.u.brightness, g.exposure);
      gl.uniform1f(this.u.contrast, g.contrast);
      gl.uniform1f(this.u.saturation, g.saturation);
      gl.uniform1f(this.u.gamma, g.gamma);
    }
    const warm = !!g && Math.abs(g.temperature - 6500) > 1;
    gl.uniform1f(this.u.useTemp, warm ? 1 : 0);
    if (warm) gl.uniform3f(this.u.temp, ...kelvinToRgb(g!.temperature));
    if (mix < 1) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, mix);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (mix < 1) gl.disable(gl.BLEND);
  }

  clear() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
