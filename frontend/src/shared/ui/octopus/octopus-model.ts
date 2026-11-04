// 两种舞台共用造型和像素材质参数；镜头、手势与卡片由各自舞台管理。
import * as THREE from 'three'

export const hex = (h: string) =>
  new THREE.Vector3(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  )

export const PAL = {
  skin: ['#2f49b8', '#5878e6', '#8ea8f8'],
  top: ['#2a40a6', '#4d6cdc', '#7f9cf4'],
  sucker: ['#2f49b8', '#5878e6', '#8ea8f8'],
  hi: '#f4f7ff',
  ink: '#101735',
  eye: ['#121a33', '#2a3766'],
  beret: ['#1b1e27', '#363b4a'],
}

export const ARMS = 8
export const SEG = 22 // 每条腕足的节数
export const RING = 8 // 管子一圈几个点
export const BASE_Y = 0.06
export const BASE_R = 0.17

export const DITHER = `
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer4(vec2 a){ return bayer2(.5 * a) * .25 + bayer2(a); }`

export const SKIN_VERT = `
attribute float aS; attribute float aSuck; attribute float aTop;
varying vec3 vN; varying vec3 vP; varying float vS; varying float vSuck; varying float vTop;
void main(){
  vN = normalize(normalMatrix * normal); vP = position; vS = aS; vSuck = aSuck; vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`

export function mantleGeometry() {
  const g = new THREE.SphereGeometry(1, 30, 22)
  const p = g.attributes.position
  const top = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i)
    top[i] = y
    // 略扁的球：下半截再压扁一点，像坐在腕足上
    x *= 0.31
    z *= 0.3
    y *= y < 0 ? 0.22 : 0.27
    p.setXYZ(i, x, y + 0.24, z)
  }
  g.computeVertexNormals()
  g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(p.count).fill(-1), 1))
  g.setAttribute('aSuck', new THREE.BufferAttribute(new Float32Array(p.count), 1))
  g.setAttribute('aTop', new THREE.BufferAttribute(top, 1))
  return g
}

export function armGeometry() {
  const n = (SEG + 1) * RING + 1 // 最后一个点封住腕尖
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  const aS = new Float32Array(n),
    aSuck = new Float32Array(n)
  for (let j = 0; j <= SEG; j++)
    for (let k = 0; k < RING; k++) {
      const i = j * RING + k
      aS[i] = j / SEG
      aSuck[i] = Math.cos((k / RING) * Math.PI * 2)
    }
  aS[n - 1] = 1
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1))
  g.setAttribute('aSuck', new THREE.BufferAttribute(aSuck, 1))
  g.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array(n), 1))
  const idx: number[] = []
  for (let j = 0; j < SEG; j++)
    for (let k = 0; k < RING; k++) {
      const a = j * RING + k,
        b = j * RING + ((k + 1) % RING),
        c = a + RING,
        d = b + RING
      idx.push(a, c, b, b, c, d)
    }
  for (let k = 0; k < RING; k++) idx.push(SEG * RING + k, n - 1, SEG * RING + ((k + 1) % RING))
  g.setIndex(idx)
  return g
}
