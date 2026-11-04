// Inkpaw 的吉祥物：一只戴贝雷帽的蓝色 3D 像素八爪鱼。做法沿用 read-together 的读伴八爪鱼：
// 真 3D 模型，故意渲染到很小的离屏图上，再一格一格最近邻放大。
//
//   造型：可爱比例。头（外套膜）是一颗略扁的球，不后仰、不收脖子；八条腕足短而粗、末端圆头，从头底下一圈往外摊开。
//         每条腕足只是一根中心线：起点、初始朝向，加一个沿长度分布的弯曲量，逐段积分出形状，再套一圈管子。
//         眼睛是脸正面偏下的两颗深藏青豆豆眼，各带一个高光；头顶歪戴一顶黑贝雷帽。不画吸盘和头上的斑点，那是写实画法。
//   动作：弯曲量 = 静态卷曲（越靠尖越卷）+ 一道从根传到尖的正弦波；另有绕竖轴的摆动。不同心情只是换这几个系数。
//         search（默认）时右前腕足拿放大镜四处照；read 时两只前腕足捧着书自己看。节拍见 step() 上面那段；
//         握东西的腕足按权重拉向一条贝塞尔曲线。
//   渲染：画到 w×h 的离屏图（光照三档 + 4×4 点阵抖动），后处理补一像素外轮廓、描腕足交叠处的内边，
//         再把剪影往右下偏几格当作点阵影子，最后最近邻放大。
//
// 颜色直接按十六进制传进着色器，不走 three 的色彩空间换算。
//
// Live 舞台保留已确认的镜头、手势、递卡和像素网格。
import * as THREE from 'three'
import {
  hex,
  PAL,
  ARMS,
  SEG,
  RING,
  BASE_Y,
  BASE_R,
  DITHER,
  SKIN_VERT,
  mantleGeometry,
  armGeometry,
} from './octopus-model'

// 蓝色一族；每组三档：暗、中、亮。sucker 和 skin 相同，等于不画吸盘

export type Mood =
  | 'idle'
  | 'search'
  | 'read'
  | 'think'
  | 'talk'
  | 'happy'
  | 'listen'
  | 'rummage'
  | 'sad'
  | 'warn'
  | 'sleep'
  | 'hold'

export interface StageOptions {
  mood?: Mood
  bookColor?: string
  reduce?: boolean
  dark?: boolean
  /** 主角胸口在视口高度上的比例：平时、手上有牌时 */
  focusY?: () => { rest: number; lift: number }
  /** 只有一张牌时镜头要不要也抬（手机上要） */
  liftOne?: () => boolean
  /** 焦点卡停在哪：视口坐标的中心和高度（CSS 像素） */
  cardRest?: () => {
    cx: number
    cy: number
    h: number
    gap: number
    carousel?: boolean
    inspectH?: number
    inspectX?: number
    inspectY?: number
  }
  onReady?: () => void
}

// ---------- 造型 ----------

const SKIN_FRAG = `
uniform vec3 uL;
uniform vec3 k0, k1, k2, t0, t1, t2, c0, c1, c2, cHi, f0, f1, f2; uniform float uFlush;
varying vec3 vN; varying vec3 vP; varying float vS; varying float vSuck; varying float vTop;
${DITHER}
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float d = bayer4(gl_FragCoord.xy) - .5;
  float lit = dot(N, uL) + d * .18;
  vec3 a0 = k0, a1 = k1, a2 = k2;
  if (vS < 0. && vTop > .35) { a0 = t0; a1 = t1; a2 = t2; }
  bool suck = vS > .07 && vSuck > .45;
  if (suck) { a0 = c0; a1 = c1; a2 = c2; }
  // 变色：uFlush 是漫到多高，边缘用同一张抖动表，看起来是一格格染上去的
  if (uFlush > .01 && (vP.y + .16) / .9 + d * .22 < uFlush) { a0 = f0; a1 = f1; a2 = f2; }
  vec3 col = lit > .42 ? a2 : (lit > -.12 ? a1 : a0);
  if (suck && fract(vS * 26.) < .38) col = mix(col, a0, .6);                 // 一颗颗吸盘
  if (vS < 0.) {
    float sp = pow(max(dot(N, normalize(uL + vec3(0., 0., 1.))), 0.), 60.);
    if (sp + d * .1 > .78) col = cHi;
  }
  gl_FragColor = vec4(col, 1.);
}`

const FLAT_VERT = `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
const FLAT_FRAG = `
uniform vec3 uL; uniform vec3 cA; uniform vec3 cB; uniform float uCut; varying vec3 vN;
${DITHER}
void main(){
  float d = bayer4(gl_FragCoord.xy) - .5;
  float lit = dot(normalize(vN), uL) + d * .15;
  gl_FragColor = vec4(lit > uCut ? cB : cA, 1.);
}`

const UV_VERT = `varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
const PAGE_FRAG = `
uniform vec3 uL; uniform vec3 cA; uniform vec3 cB; uniform vec3 cLine; uniform float uLines; uniform float uText; uniform float uRound; uniform float uEye; uniform vec3 cEye; uniform vec3 cHi;
varying vec3 vN; varying vec2 vUv;
${DITHER}
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float d = bayer4(gl_FragCoord.xy) - .5;
  float lit = dot(N, uL) + d * .15;
  vec3 col = lit > -.2 ? cB : cA;
  bool inside = uRound > .5 ? length(vUv - .5) < .36 : (vUv.x > .14 && vUv.x < .86 && vUv.y > .12 && vUv.y < .88);
  if (uText > .5 && inside && fract(vUv.y * uLines) < .3) col = mix(col, cLine, .8);
  // 放大镜举到眼前时，镜片里是一只放大的豆豆眼
  if (uEye > .5) {
    if (length((vUv - vec2(.5, .47)) * vec2(1., .86)) < .27) col = cEye;
    if (length(vUv - vec2(.41, .58)) < .075) col = cHi;
  }
  gl_FragColor = vec4(col, 1.);
}`

const POST_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`
const POST_FRAG = `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform vec3 uInk; uniform float uEdge; uniform vec2 uNF;
uniform vec3 cWall, cWall2, cFloor, cFloor2, cBase, cLight, cDim;
uniform float uHorizon, uDim, uShA; uniform vec4 uWin; uniform vec4 uSh[3];
varying vec2 vUv;
${DITHER}
float A(vec2 o){ return texture2D(tColor, vUv + o / uRes).a; }
float lin(float d){ float z = d * 2. - 1.; return 2. * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
float D(vec2 o){ return lin(texture2D(tDepth, vUv + o / uRes).x); }
// 房间：墙和地各两色，靠抖动过渡；窗光是墙上一块斜的亮斑，方向和模型的光一致
vec3 room(vec2 p){
  float b = bayer4(p);
  vec3 col;
  if (p.y >= uHorizon + 3.) {
    float t = clamp((p.y - uHorizon) / 46., 0., 1.);
    col = t + (b - .5) * .55 < .5 ? cWall2 : cWall;
    vec2 q = p - uWin.xy; q.x -= q.y * .42;
    if (abs(q.x) < uWin.z && abs(q.y) < uWin.w && abs(q.x) > 1. && abs(q.y) > 1.) col = cLight;
  } else if (p.y >= uHorizon) {
    col = cBase;
  } else {
    float t = clamp((uHorizon - p.y) / 70., 0., 1.);
    col = t + (b - .5) * .6 < .5 ? cFloor2 : cFloor;
  }
  for (int i = 0; i < 3; i++) {
    vec4 s = uSh[i];
    if (s.z > 0.) {
      float dd = length((p - s.xy) / s.zw);
      if (dd < 1. && b < (1. - dd) * 2.1) col = mix(col, uInk, uShA);
    }
  }
  return col;
}
void main(){
  vec4 c = texture2D(tColor, vUv);
  vec2 p = floor(vUv * uRes);
  vec3 o;
  if (c.a < .05) {
    float n = max(max(A(vec2(1., 0.)), A(vec2(-1., 0.))), max(A(vec2(0., 1.)), A(vec2(0., -1.))));
    o = n > .5 ? uInk : room(p);
  } else if (c.a < .5) {
    o = c.rgb;                                        // 粒子：不描边
  } else {
    float d = D(vec2(0.));
    float dn = min(min(D(vec2(1., 0.)), D(vec2(-1., 0.))), min(D(vec2(0., 1.)), D(vec2(0., -1.))));
    o = d - dn > uEdge ? mix(c.rgb, uInk, .8) : c.rgb;
  }
  if (uDim > 0. && bayer4(p) < uDim) o = cDim;        // 看卡时身后整体退一层，用点阵不用半透明
  gl_FragColor = vec4(o, 1.);
}`

interface Arm {
  angle: number
  phase: number
  len: number
  geo: THREE.BufferGeometry
  tip: THREE.Vector3
  pts: THREE.Vector3[]
}

export function mountStage(host: HTMLElement, opts: StageOptions) {
  const reduce = !!opts.reduce
  let renderer: THREE.WebGLRenderer
  let hiR: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    hiR = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return null
  }
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.className = 'stage-px'
  canvas.style.imageRendering = 'pixelated'
  host.appendChild(canvas)
  hiR.setClearColor(0x000000, 0)
  hiR.domElement.className = 'stage-hi'
  host.appendChild(hiR.domElement)

  // 世界单位和像素的换算：z=0 平面上 1 个世界单位 = Z 个逻辑像素，和原来 120 格对 1.2 单位一致
  const Z = 100
  const CAM_D = 6
  const NEAR = 0.3,
    FAR = 16
  const FLOOR = -0.1
  const camDir = new THREE.Vector3(0, 0.57, 2.2).normalize()
  const camera = new THREE.PerspectiveCamera(20, 1, NEAR, FAR)
  let w = 320,
    h = 240,
    px = 3,
    cssW = 960,
    cssH = 720,
    WPX = 1 / Z
  const scene = new THREE.Scene()
  const body = new THREE.Group()
  body.rotation.order = 'YXZ'
  scene.add(body)

  const uL = new THREE.Vector3(-0.42, 0.8, 0.5).normalize()
  const skin = new THREE.ShaderMaterial({
    vertexShader: SKIN_VERT,
    fragmentShader: SKIN_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uL: { value: uL },
      k0: { value: hex(PAL.skin[0]) },
      k1: { value: hex(PAL.skin[1]) },
      k2: { value: hex(PAL.skin[2]) },
      t0: { value: hex(PAL.top[0]) },
      t1: { value: hex(PAL.top[1]) },
      t2: { value: hex(PAL.top[2]) },
      c0: { value: hex(PAL.sucker[0]) },
      c1: { value: hex(PAL.sucker[1]) },
      c2: { value: hex(PAL.sucker[2]) },
      cHi: { value: hex(PAL.hi) },
      f0: { value: hex('#a8485f') },
      f1: { value: hex('#d9748a') },
      f2: { value: hex('#f2a7b5') },
      uFlush: { value: 0 },
    },
  })
  const flat = (a: string, b: string, cut = 0.1) =>
    new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: FLAT_FRAG,
      uniforms: {
        uL: { value: uL },
        cA: { value: hex(a) },
        cB: { value: hex(b) },
        uCut: { value: cut },
      },
    })

  const mantle = new THREE.Mesh(mantleGeometry(), skin)
  body.add(mantle)

  // 眼睛：豆豆眼，深藏青两档明暗，左上一个高光，长在脸正面偏下
  const eyes: { g: THREE.Group; pupil: THREE.Object3D; side: number }[] = []
  const ER = 0.047,
    EX = 0.092,
    EY = 0.19
  const ballMat = flat(PAL.eye[0], PAL.eye[1], 0.5)
  const glintMat = flat(PAL.hi, PAL.hi)
  for (const side of [-1, 1]) {
    const g = new THREE.Group()
    g.position.set(side * EX, EY, 0.265)
    g.rotation.y = side * 0.18
    const pupil = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(ER, 12, 8), ballMat)
    ball.scale.set(0.9, 1.15, 0.7)
    pupil.add(ball)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(ER * 0.36, 6, 4), glintMat)
    glint.position.set(-ER * 0.3, ER * 0.42, ER * 0.62)
    pupil.add(glint)
    g.add(pupil)
    body.add(g)
    eyes.push({ g, pupil, side })
  }

  // 贝雷帽：压扁的球盖在头顶、往一侧歪，顶上一根小柄
  const beretMat = flat(PAL.beret[0], PAL.beret[1], 0.3)
  const hat = new THREE.Group()
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.245, 24, 12), beretMat)
  cap.scale.set(1.05, 0.33, 1)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.06, 6), beretMat)
  stem.position.set(0.015, 0.09, 0)
  hat.add(cap, stem)
  hat.position.set(0.02, 0.48, -0.01)
  hat.rotation.set(-0.12, 0, -0.28)
  body.add(hat)

  // 腕足：0 和 7 是最前面那一对（角度 ±22.5°），抱书的就是它们
  const arms: Arm[] = []
  for (let i = 0; i < ARMS; i++) {
    const geo = armGeometry()
    const m = new THREE.Mesh(geo, skin)
    m.frustumCulled = false
    body.add(m)
    arms.push({
      angle: ((i + 0.5) / ARMS) * Math.PI * 2,
      phase: i * 1.37 + (i % 2) * 0.9,
      len: 0.34 + 0.02 * Math.sin(i * 2.1),
      geo,
      tip: new THREE.Vector3(),
      pts: Array.from({ length: SEG + 1 }, () => new THREE.Vector3()),
    })
  }

  // ---------- 道具：书和放大镜 ----------
  // 两件道具分开用：read 时两只前腕足捧住书的两个下角，书页朝自己、封面朝外；search 时右前腕足捏着放大镜的柄四处照。
  // 道具都挂在 body 上，跟着身体一起转、一起起伏；腕足只负责把尖端送到握点。
  const darken = (c: string, k: number) =>
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(c.slice(i, i + 2), 16) * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  const paperMat = (a: string, b: string, line: string, lines: number, round: number) =>
    new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: PAGE_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uL: { value: uL },
        cA: { value: hex(a) },
        cB: { value: hex(b) },
        cLine: { value: hex(line) },
        uLines: { value: lines },
        uText: { value: 1 },
        uRound: { value: round },
        uEye: { value: 0 },
        cEye: { value: hex(PAL.eye[0]) },
        cHi: { value: hex(PAL.hi) },
      },
    })
  const bookColor = opts.bookColor ?? '#b8503f'
  const coverMat = flat(darken(bookColor, 0.7), bookColor, -0.35) // 封面朝镜头，大半落在亮部
  const pageMat = paperMat('#ddd3c6', '#fbf6ef', '#b9ae9f', 7, 0)
  const LW = 0.15,
    LH = 0.2 // 一页的宽和高
  const book = new THREE.Group() // 原点在书脊底端；书页朝 -z（朝八爪鱼自己），封面朝 +z（朝镜头）
  const leaves: THREE.Group[] = []
  for (const side of [1, -1]) {
    const leaf = new THREE.Group()
    leaf.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(LW, LH, 0.012).translate((side * LW) / 2, LH / 2, 0.008),
        coverMat,
      ),
      new THREE.Mesh(
        new THREE.PlaneGeometry(LW * 0.94, LH * 0.94).translate(side * LW * 0.49, LH / 2, 0),
        pageMat,
      ),
    )
    leaf.rotation.y = side * 0.24 // 外沿往八爪鱼那边收，书摊成浅 V 字
    book.add(leaf)
    leaves.push(leaf)
  }
  // 封面上一条浅色书名签，让外面看得出这是一本书
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(LW * 0.56, LH * 0.14).translate(-LW * 0.5, LH * 0.68, 0.0145),
    flat('#e9dfcf', '#f6efe3', -0.5),
  )
  leaves[1].add(label)

  const MR = 0.058,
    HL = 0.095 // 镜片半径、柄长
  const magDark = flat(PAL.beret[0], PAL.beret[1], 0.2)
  const glassMat = paperMat('#a9c0f5', '#dbe6ff', '#8396cc', 3.2, 1)
  glassMat.uniforms.uText.value = 0
  const mag = new THREE.Group() // 原点在柄的末端，也就是腕尖捏着的地方；+y 指向镜片
  const glass = new THREE.Mesh(new THREE.CircleGeometry(MR * 0.96, 22), glassMat)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(MR, 0.012, 6, 22), magDark)
  const shine = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.045), flat(PAL.hi, PAL.hi))
  glass.position.y = rim.position.y = HL + MR
  shine.position.set(-0.022, HL + MR + 0.016, 0.003)
  shine.rotation.z = -0.6
  mag.add(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.017, HL, 8).translate(0, HL / 2, 0),
      magDark,
    ),
    rim,
    glass,
    shine,
  )
  book.visible = mag.visible = false
  body.add(book, mag)

  // ---------- 后处理 ----------
  const makeRT = (a: number, b: number) =>
    new THREE.WebGLRenderTarget(a, b, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(a, b),
    })
  let rt = makeRT(w, h)
  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: rt.texture },
      tDepth: { value: rt.depthTexture },
      uRes: { value: new THREE.Vector2(w, h) },
      uInk: { value: hex(PAL.ink) },
      uEdge: { value: 0.13 },
      uNF: { value: new THREE.Vector2(NEAR, FAR) },
      cWall: { value: new THREE.Vector3() },
      cWall2: { value: new THREE.Vector3() },
      cFloor: { value: new THREE.Vector3() },
      cFloor2: { value: new THREE.Vector3() },
      cBase: { value: new THREE.Vector3() },
      cLight: { value: new THREE.Vector3() },
      cDim: { value: new THREE.Vector3() },
      uHorizon: { value: 80 },
      uDim: { value: 0 },
      uShA: { value: 0.3 },
      uWin: { value: new THREE.Vector4() },
      uSh: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    },
  })
  const postScene = new THREE.Scene()
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post))
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // 房间只有四种颜色的高调底，主角和卡片的颜色才站得出来；深色模式是同一间屋子关了灯，不反色
  const ROOM = {
    light: {
      wall: '#f4f6fb',
      wall2: '#e9edf6',
      floor: '#dde3f0',
      floor2: '#e6ebf5',
      base: '#c9d1e4',
      win: '#fdfdff',
      dim: '#f7f8fc',
      sh: 0.3,
    },
    dark: {
      wall: '#25282f',
      wall2: '#2b2f38',
      floor: '#1e2026',
      floor2: '#23262d',
      base: '#3a3f4b',
      win: '#333845',
      dim: '#1b1d22',
      sh: 0.55,
    },
  }
  function setTheme(dark: boolean) {
    const c = dark ? ROOM.dark : ROOM.light,
      u = post.uniforms
    u.cWall.value = hex(c.wall)
    u.cWall2.value = hex(c.wall2)
    u.cFloor.value = hex(c.floor)
    u.cFloor2.value = hex(c.floor2)
    u.cBase.value = hex(c.base)
    u.cLight.value = hex(c.win)
    u.cDim.value = hex(c.dim)
    u.uShA.value = c.sh
    if (metal) {
      const m = dark
        ? ['#4a5062', '#6c7388', '#5c6377', '#7c8398']
        : ['#b4bcd2', '#e4e8f3', '#8f99b5', '#ccd3e4']
      metal.uniforms.cA.value = hex(m[0])
      metal.uniforms.cB.value = hex(m[1])
      metalDark.uniforms.cA.value = hex(m[2])
      metalDark.uniforms.cB.value = hex(m[3])
    }
  }

  // ---------- 档案柜：卡片的来处 ----------
  const cabinet = new THREE.Group()
  const CABW = 0.46,
    CABH = 0.74,
    CABD = 0.42
  const metal = flat('#b4bcd2', '#e4e8f3', -0.1)
  const metalDark = flat('#8f99b5', '#ccd3e4', -0.4)
  cabinet.add(
    new THREE.Mesh(new THREE.BoxGeometry(CABW, CABH, CABD).translate(0, CABH / 2, 0), metal),
  )
  const drawers: { g: THREE.Group; open: number; target: number; y: number }[] = []
  const labelMat = flat('#e7e3da', '#fbfaf6', -0.5)
  const sheetMat = flat('#d9dce6', '#ffffff', 0.1)
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group()
    const y = 0.135 + i * 0.235
    g.position.set(0, y, CABD / 2)
    const front = new THREE.Mesh(new THREE.BoxGeometry(CABW - 0.05, 0.2, 0.03), metalDark)
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.018, 0.03).translate(0, -0.04, 0.03),
      magDarkShared(),
    )
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.05, 0.004).translate(0, 0.04, 0.017),
      labelMat,
    )
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(CABW - 0.07, 0.15, 0.38).translate(0, -0.02, -0.2),
      metal,
    )
    g.add(front, handle, label, tray)
    for (let k = 0; k < 5; k++) {
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(CABW - 0.12, 0.012, 0.006), sheetMat)
      sheet.position.set(0, 0.062 + (k % 2) * 0.008, -0.05 - k * 0.06)
      g.add(sheet)
    }
    cabinet.add(g)
    drawers.push({ g, open: 0, target: 0, y })
  }
  function magDarkShared() {
    return flat(PAL.beret[0], PAL.beret[1], 0.2)
  }
  scene.add(cabinet)
  setTheme(!!opts.dark)
  const cabPos = new THREE.Vector3(-0.8, FLOOR, -0.6)

  // ---------- 表情零件：原模型没有的只在需要的时候才露出来 ----------
  for (const e of eyes) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.011, 5, 10, Math.PI), ballMat)
    arc.position.set(0, -0.012, 0.02)
    arc.visible = false
    e.g.add(arc)
    ;(e as any).arc = arc
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.02), ballMat)
    lid.position.set(0, 0.052, 0.03)
    lid.rotation.z = -e.side * 0.42
    lid.visible = false
    e.g.add(lid)
    ;(e as any).lid = lid
  }
  const blushMat = flat('#e38fa3', '#f0aebb', 0.9)
  const blushes = [-1, 1].map((sd) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 5), blushMat)
    b.scale.set(1.3, 0.6, 0.3)
    b.position.set(sd * 0.165, 0.128, 0.255)
    b.visible = false
    body.add(b)
    return b
  })
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), ballMat)
  mouth.position.set(0, 0.1, 0.283)
  mouth.visible = false
  body.add(mouth)

  // 纸条：用户发出去的话，飞到八爪鱼手里、塞进贝雷帽
  const noteMat = flat('#d9dce6', '#ffffff', -0.3)
  const note = new THREE.Group()
  note.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.064, 0.008), noteMat))
  const noteLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.056, 0.008, 0.01),
    flat('#5878e6', '#5878e6'),
  )
  noteLine.position.y = 0.008
  const noteLine2 = noteLine.clone()
  noteLine2.position.y = -0.012
  noteLine2.scale.x = 0.66
  note.add(noteLine, noteLine2)
  note.visible = false
  scene.add(note)

  // ---------- 粒子：8×8 点阵图，走同一个像素网格 ----------
  const TILES: Record<string, string> = {
    bang: '...##...|...##...|...##...|...##...|...##...|........|...##...|...##...',
    quest: '..####..|.##..##.|.....##.|....##..|...##...|........|...##...|...##...',
    z: '.######.|.....##.|....##..|...##...|..##....|.##.....|.######.|........',
    heart: '.##..##.|########|########|########|.######.|..####..|...##...|........',
    plus: '...##...|...##...|...##...|########|########|...##...|...##...|...##...',
    spark: '........|...#....|...#....|.#####..|...#....|...#....|........|........',
    ink: '..####..|.######.|########|########|########|########|.######.|..####..',
    dot: '........|........|..###...|.#####..|.#####..|..###...|........|........',
    paper: '.######.|.#....#.|.#.##.#.|.#....#.|.#.##.#.|.#....#.|.######.|........',
  }
  const TILE_KEYS = Object.keys(TILES)
  const atlasData = new Uint8Array(TILE_KEYS.length * 8 * 8 * 4)
  TILE_KEYS.forEach((k, ti) => {
    TILES[k].split('|').forEach((row, y) => {
      for (let x = 0; x < 8; x++) {
        const i = ((7 - y) * TILE_KEYS.length * 8 + ti * 8 + x) * 4
        atlasData[i] = atlasData[i + 1] = atlasData[i + 2] = 255
        atlasData[i + 3] = row[x] === '#' ? 255 : 0
      }
    })
  })
  const atlas = new THREE.DataTexture(atlasData, TILE_KEYS.length * 8, 8)
  atlas.minFilter = atlas.magFilter = THREE.NearestFilter
  atlas.needsUpdate = true
  const FX_FRAG = `
uniform sampler2D tA; uniform vec3 uC; uniform float uT, uN, uOut; varying vec2 vUv;
void main(){
  vec4 a = texture2D(tA, vec2((uT + vUv.x) / uN, vUv.y));
  if (a.a < .5) discard;
  gl_FragColor = vec4(uC, uOut);
}`
  type P = {
    m: THREE.Mesh
    u: any
    v: THREE.Vector3
    life: number
    age: number
    g: number
    size: number
    on: boolean
  }
  const parts: P[] = []
  for (let i = 0; i < 56; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: FX_FRAG,
      uniforms: {
        tA: { value: atlas },
        uC: { value: new THREE.Vector3(1, 1, 1) },
        uT: { value: 0 },
        uN: { value: TILE_KEYS.length },
        uOut: { value: 1 },
      },
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    m.visible = false
    m.frustumCulled = false
    scene.add(m)
    parts.push({
      m,
      u: mat.uniforms,
      v: new THREE.Vector3(),
      life: 1,
      age: 0,
      g: 0,
      size: 0.08,
      on: false,
    })
  }
  function fx(
    kind: string,
    at: THREE.Vector3,
    o: {
      v?: [number, number, number]
      life?: number
      g?: number
      size?: number
      color?: string
      outline?: boolean
    } = {},
  ) {
    const p = parts.find((q) => !q.on)
    if (!p) return
    p.on = true
    p.age = 0
    p.life = o.life ?? 0.9
    p.g = o.g ?? 0
    p.size = o.size ?? 0.08
    p.v.set(...(o.v ?? [0, 0, 0]))
    p.m.position.copy(at)
    p.m.visible = true
    p.u.uT.value = TILE_KEYS.indexOf(kind)
    p.u.uC.value = hex(o.color ?? PAL.ink)
    p.u.uOut.value = o.outline ? 1 : 0.4
  }
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const dust = (x: number, z: number, n = 6) => {
    for (let i = 0; i < n; i++) {
      const sd = i % 2 ? 1 : -1
      fx('dot', V(x + sd * (0.2 + Math.random() * 0.18), FLOOR + 0.02, z + 0.1), {
        v: [sd * (0.25 + Math.random() * 0.3), 0.14 + Math.random() * 0.12, 0],
        life: 0.42,
        g: -0.5,
        size: 0.05,
        color: '#b8c1d8',
      })
    }
  }

  // ---------- 时间线：所有编排都走舞台自己的时钟，切到后台就一起停 ----------
  type Tw = { t: number; d: number; fn: (p: number, dt: number) => void; r: () => void }
  const tweens: Tw[] = []
  const anim = (d: number, fn: (p: number, dt: number) => void = () => {}) =>
    new Promise<void>((r) => tweens.push({ t: 0, d: reduce ? Math.min(d, 0.06) : d, fn, r }))
  const pause = (s: number) => anim(s)
  const outCubic = (x: number) => 1 - Math.pow(1 - x, 3)
  const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

  // ---------- 动作 ----------
  type Coef = { amp: number; w: number; curl: number; sway: number; dip: number; bob: number }
  const MOOD: Record<Mood, Coef> = {
    idle: { amp: 0.6, w: 1.5, curl: 1.55, sway: 0.24, dip: -0.82, bob: 0.024 },
    search: { amp: 0.45, w: 1.3, curl: 1.5, sway: 0.2, dip: -0.82, bob: 0.018 },
    read: { amp: 0.35, w: 1.1, curl: 1.55, sway: 0.16, dip: -0.82, bob: 0.012 },
    talk: { amp: 0.75, w: 2.4, curl: 1.5, sway: 0.28, dip: -0.78, bob: 0.03 },
    think: { amp: 0.35, w: 3.6, curl: 2.3, sway: 0.12, dip: -0.95, bob: 0.014 },
    happy: { amp: 1.1, w: 4.2, curl: 1.0, sway: 0.35, dip: -0.5, bob: 0.05 },
    // Live 新增的心情：同一组系数，只是换了数值
    listen: { amp: 0.4, w: 1.6, curl: 1.6, sway: 0.16, dip: -0.85, bob: 0.014 },
    rummage: { amp: 0.9, w: 5, curl: 1.3, sway: 0.3, dip: -0.7, bob: 0.02 },
    sad: { amp: 0.2, w: 0.9, curl: 1.2, sway: 0.1, dip: -1.05, bob: 0.008 },
    warn: { amp: 0.5, w: 3, curl: 1.6, sway: 0.18, dip: -0.85, bob: 0.01 },
    sleep: { amp: 0.16, w: 0.7, curl: 1.9, sway: 0.08, dip: -0.95, bob: 0.01 },
    hold: { amp: 0.5, w: 1.8, curl: 1.5, sway: 0.2, dip: -0.8, bob: 0.02 },
  }
  const cur: Coef = { ...MOOD.idle }
  const st = {
    mood: (opts.mood ?? 'search') as Mood,
    t: 0,
    yaw: 0,
    yawV: 0,
    pitch: 0,
    pitchV: 0,
    jump: 0,
    jumpV: 0,
    blink: 0,
    nextBlink: 2.5,
    book: 0,
    mag: 0,
    sq: 0,
    sqV: 0,
    wave: 0,
    breath: 0,
    breathRate: 1.6,
    rum: 0,
    rumClose: false,
    dx: 0,
    dz: 0,
    roll: 0,
    lid: 1,
    eyeWas: 0,
    hatO: 0,
    hatV: 0,
    hatLift: 0,
    rumDrawer: 1,
    rumT: 0,
    tapL: 0,
    tapR: 0,
    tapSide: 0,
    listen: 0,
    flush: 0,
    flushT: 0,
    pet: 0,
    petCool: 0,
    pokes: 0,
    pokeAt: 0,
    annoyed: 0,
    nextIdle: 7,
    zT: 0,
    dim: 0,
    dimT: 0,
    enter: reduce ? 1 : 0,
  }
  let pointer: { x: number; y: number } | null = null,
    pointerAt = 0
  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY }
    pointerAt = performance.now()
  }
  addEventListener('pointermove', onMove, { passive: true })

  const up = new THREE.Vector3(0, 1, 0)
  const o = new THREE.Vector3(),
    d = new THREE.Vector3(),
    P = new THREE.Vector3(),
    tmp = new THREE.Vector3()
  const T = new THREE.Vector3(),
    U = new THREE.Vector3(),
    W = new THREE.Vector3(),
    Bz = new THREE.Vector3(),
    C1 = new THREE.Vector3(),
    C2 = new THREE.Vector3()
  const look = new THREE.Vector2()
  const radius = (s: number) => 0.06 * Math.pow(1 - s, 0.5) + 0.026
  // smootherstep：起止速度都是 0，所有节拍的过渡都用它，动作才不会一下子起步或刹住
  const sm = (x: number) => {
    x = Math.min(1, Math.max(0, x))
    return x * x * x * (x * (6 * x - 15) + 10)
  }
  // 起-停-落的包络：从 start 开始用 rise 秒升到 1，停 hold 秒，再用 fall 秒落回 0
  const env = (x: number, start: number, rise: number, hold: number, fall: number) =>
    sm((x - start) / rise) * (1 - sm((x - start - rise - hold) / fall))

  type Grip = { w: number; at: THREE.Vector3; dir: THREE.Vector3 }
  // 一条腕足：先按弯曲量逐段积分出自由摆动的中心线；要握东西时，再按权重把中心线拉向一条
  // 从根部到握点的三次贝塞尔曲线（dir 是腕尖到达握点时的朝向）。管子的截面用平行移动的标架，沿途不扭。
  function buildArm(arm: Arm, grip: Grip | null) {
    const base = arm.angle
    let theta = cur.dip * 0.5
    const ds = arm.len / SEG
    P.set(Math.sin(base) * BASE_R, BASE_Y, Math.cos(base) * BASE_R)
    for (let j = 0; j <= SEG; j++) {
      const s = j / SEG
      const ang = base + cur.sway * s * Math.sin(st.wave * 0.7 + arm.phase * 1.7 + 3 * s)
      o.set(Math.sin(ang), 0, Math.cos(ang))
      d.copy(o).multiplyScalar(Math.cos(theta)).addScaledVector(up, Math.sin(theta))
      arm.pts[j].copy(P)
      theta +=
        0.45 *
        (cur.curl * Math.pow(s, 1.3) * 5.2 +
          cur.amp * (0.35 + s) * Math.sin(st.wave - 5.5 * s + arm.phase)) *
        ds
      P.addScaledVector(d, ds)
    }
    o.set(Math.sin(base), 0, Math.cos(base))
    if (grip && grip.w > 0.001) {
      const R = arm.pts[0]
      C1.copy(R).addScaledVector(o, 0.12).addScaledVector(up, -0.02)
      C2.copy(grip.at).addScaledVector(grip.dir, -0.12)
      for (let j = 1; j <= SEG; j++) {
        const s = j / SEG,
          u = 1 - s
        Bz.copy(R)
          .multiplyScalar(u * u * u)
          .addScaledVector(C1, 3 * u * u * s)
          .addScaledVector(C2, 3 * u * s * s)
          .addScaledVector(grip.at, s * s * s)
        arm.pts[j].lerp(Bz, grip.w)
      }
    }
    const pos = arm.geo.attributes.position.array as Float32Array
    const nor = arm.geo.attributes.normal.array as Float32Array
    for (let j = 0; j <= SEG; j++) {
      T.subVectors(arm.pts[Math.min(SEG, j + 1)], arm.pts[Math.max(0, j - 1)]).normalize()
      if (j === 0) U.crossVectors(o, up).cross(T)
      U.addScaledVector(T, -U.dot(T)).normalize()
      W.crossVectors(T, U)
      const p = arm.pts[j],
        r = radius(j / SEG) * (1 - 0.22 * (grip?.w ?? 0)) // 拿东西的腕足伸长了，也细一点
      for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2
        tmp.copy(U).multiplyScalar(Math.cos(a)).addScaledVector(W, Math.sin(a))
        const idx = (j * RING + k) * 3
        pos[idx] = p.x + tmp.x * r
        pos[idx + 1] = p.y + tmp.y * r
        pos[idx + 2] = p.z + tmp.z * r
        nor[idx] = tmp.x
        nor[idx + 1] = tmp.y
        nor[idx + 2] = tmp.z
      }
    }
    const n = (SEG + 1) * RING,
      end = arm.pts[SEG],
      cap = radius(1) * 0.9
    pos[n * 3] = end.x + T.x * cap
    pos[n * 3 + 1] = end.y + T.y * cap
    pos[n * 3 + 2] = end.z + T.z * cap
    nor[n * 3] = T.x
    nor[n * 3 + 1] = T.y
    nor[n * 3 + 2] = T.z
    arm.tip.copy(end)
    arm.geo.attributes.position.needsUpdate = true
    arm.geo.attributes.normal.needsUpdate = true
  }

  // ---------- 手势层 ----------
  // 每帧先清空 pose，当前在放的手势往里写：要朝哪看、身子怎么靠、哪条腕足伸到哪。写完的 pose 叠在心情动作上。
  // 腕足编号：0、7 是最前面一对，1、6 在两侧，2~5 在身后基本不动。
  const pose = {
    yaw: NaN,
    pitch: 0,
    roll: 0,
    dx: 0,
    dz: 0,
    lookX: NaN,
    lookY: NaN,
    eye: 0, // 0 平常 1 瞪大 2 闭眼 3 笑眯眯 4 不高兴
    mouth: 0,
    blush: 0,
  }
  const slots: Grip[] = Array.from({ length: ARMS }, () => ({
    w: 0,
    at: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 1, 0),
  }))
  const reach = (
    i: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    wt: number,
  ) => {
    const g = slots[i]
    if (wt <= g.w) return
    g.w = wt
    g.at.set(x, y, z)
    g.dir.set(dx, dy, dz).normalize()
  }
  const armOut: Grip[] = Array.from({ length: ARMS }, () => ({
    w: 0,
    at: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 1, 0),
  }))
  type Act = {
    name: string
    t: number
    d: number
    run: (p: number, t: number, dt: number) => void
    r: () => void
  }
  const acts: Act[] = []
  const play = (name: string, d: number, run: Act['run']) =>
    new Promise<void>((r) => {
      const dup = acts.findIndex((a) => a.name === name)
      if (dup >= 0) acts.splice(dup, 1)[0].r()
      acts.push({ name, t: 0, d: reduce ? Math.min(d, 0.2) : d, run, r })
    })
  // 起落包络：头尾 a 秒淡入淡出，手势抢占腕足时不会一下跳过去
  const inout = (t: number, d: number, a = 0.24) => sm(t / a) * (1 - sm((t - d + a) / a))

  function hop(v = 1.9) {
    if (reduce) return
    st.sqV -= 1.7 // 先下蹲蓄力
    anim(0.09).then(() => {
      st.jumpV = v
      st.sqV += 3.4
    })
  }

  const GEST: Record<string, () => Promise<void>> = {
    wave: () =>
      play('wave', 1.7, (_p, t) => {
        const e = inout(t, 1.7, 0.3)
        reach(
          0,
          0.42 + 0.08 * Math.sin(t * 11),
          0.5 + 0.02 * Math.cos(t * 11),
          0.22,
          0.5 * Math.sin(t * 11),
          1,
          0.1,
          e,
        )
        pose.roll = -0.06 * e * Math.sin(t * 11)
        pose.eye = 3
      }),
    shrug: () =>
      play('shrug', 1.4, (_p, t) => {
        const e = inout(t, 1.4, 0.28)
        reach(7, -0.44, 0.26 + 0.03 * Math.sin(t * 5), 0.28, -0.8, 0.5, 0.3, e)
        reach(0, 0.44, 0.26 + 0.03 * Math.sin(t * 5), 0.28, 0.8, 0.5, 0.3, e)
        pose.pitch = -0.05 * e
        pose.lookX = 0
        pose.lookY = 0.5
      }),
    nod: () =>
      play('nod', 0.8, (p) => {
        pose.pitch = 0.2 * Math.sin(p * Math.PI * 2) * (1 - p * 0.4)
      }),
    shake: () =>
      play('shake', 1.1, (p, t) => {
        pose.yaw = 0.34 * Math.sin(t * 13) * (1 - p)
        pose.eye = 4
        const e = inout(t, 1.1, 0.2)
        reach(0, 0.3, 0.42, 0.52, 0, 0.7, 0.7, e) // 抬一只腕足挡在前面
      }),
    stretch: () =>
      play('stretch', 2.2, (_p, t) => {
        const e = inout(t, 2.2, 0.55)
        reach(6, -0.5, 0.62, 0, -0.5, 1, 0, e)
        reach(1, 0.5, 0.62, 0, 0.5, 1, 0, e)
        pose.pitch = -0.1 * e
        st.sq += (0.06 * e - st.sq) * 0.08
        pose.eye = e > 0.6 ? 2 : 0
      }),
    yawn: () =>
      play('yawn', 2, (_p, t) => {
        const e = inout(t, 2, 0.5)
        pose.mouth = e
        pose.pitch = -0.14 * e
        pose.eye = e > 0.5 ? 2 : 0
        reach(7, -0.09, 0.09, 0.4, 0.3, 0.8, -0.2, e * 0.9)
      }),
    lookAround: () =>
      play('lookAround', 2.6, (p, t) => {
        const e = inout(t, 2.6, 0.4)
        const dir = p < 0.5 ? -1 : 1
        pose.yaw = 0.55 * dir * e
        pose.lookX = dir
        pose.lookY = 0.2
      }),
    chin: () =>
      play('chin', 2.4, (_p, t) => {
        const e = inout(t, 2.4, 0.3)
        reach(0, 0.1, 0.11 + 0.012 * Math.sin(t * 9), 0.36, -0.3, 0.8, -0.3, e)
        pose.roll = 0.06 * e
      }),
    eureka: () => {
      const top = V(0.3, 0.78, 0.12)
      fx('bang', top, { size: 0.13, life: 0.8, color: '#3f5fd6', outline: true, v: [0, 0.12, 0] })
      for (let i = 0; i < 5; i++) {
        const a = -0.6 + i * 0.5
        fx('spark', V(0.3, 0.74, 0.12), {
          v: [Math.sin(a) * 0.7, 0.6 * Math.cos(a), 0],
          life: 0.42,
          size: 0.09,
          color: '#5878e6',
        })
      }
      hop(2.1)
      return play('eureka', 0.75, () => {
        pose.eye = 1
      })
    },
    bow: () =>
      play('bow', 1, (p) => {
        pose.pitch = 0.3 * Math.sin(p * Math.PI)
        pose.eye = 3
      }),
    cheer: () => {
      hop(2.4)
      for (let i = 0; i < 7; i++)
        fx(i % 2 ? 'plus' : 'heart', V(-0.28 + i * 0.09, 0.55, 0.2), {
          v: [(i - 3) * 0.2, 0.9 + (i % 3) * 0.2, 0],
          life: 0.8,
          g: -1.8,
          size: 0.08,
          color: i % 2 ? '#5878e6' : '#d9748a',
          outline: true,
        })
      return play('cheer', 1.2, (_p, t) => {
        const e = inout(t, 1.2, 0.2)
        reach(7, -0.4, 0.5, 0.2, -0.3, 1, 0, e)
        reach(0, 0.4, 0.5, 0.2, 0.3, 1, 0, e)
        pose.eye = 3
      })
    },
  }

  // 翻柜子：转身、拉开抽屉、腕足伸进去掏，纸片往外飞。到点不收手，等 stopRummage 或 deal 接着用
  let rummaging = false
  function startRummage(i = 1) {
    rummaging = true
    drawers.forEach((d, k) => (d.target = k === i ? 1 : 0))
    st.rumDrawer = i
    st.rumT = 0
  }
  function stopRummage() {
    rummaging = false
    st.rumClose = true
  }

  // 用户发出去的话：折成纸条从输入框飞上来，一条腕足接住，掀起帽子塞进去
  function catchNote(fromX: number, fromY: number) {
    const from = screenToPlane(fromX, fromY, 1)
    const catchAt = V(-0.34, 0.24, 0.5)
    note.visible = true
    note.position.copy(from)
    note.scale.setScalar(1.5)
    return play('note', 1.45, (_p, t) => {
      const fly = clamp01(t / 0.5)
      const e = outCubic(fly)
      if (t <= 0.5) {
        note.position.lerpVectors(from, catchAt, e)
        note.position.y += Math.sin(fly * Math.PI) * 0.22
        note.rotation.z = (1 - e) * 5
        note.scale.setScalar(1.5 - 0.5 * e)
      }
      const carry = sm((t - 0.55) / 0.5)
      const tip = tmpA.copy(catchAt).lerp(tmpB.set(-0.2, 0.47, 0.1), carry)
      const hold = sm((t - 0.28) / 0.22) * (1 - sm((t - 1.15) / 0.28))
      reach(7, tip.x, tip.y, tip.z, 0.2, 1, -0.1, hold)
      if (t > 0.5) {
        note.position.copy(tip)
        note.rotation.z = 0
      }
      // 帽子跟着掀一下，纸条进去后落回
      st.hatLift = 0.05 * sm((t - 0.8) / 0.2) * (1 - sm((t - 1.08) / 0.16))
      if (t > 1.08) note.visible = false
      pose.lookX = tip.x * 2.4
      pose.lookY = (tip.y - 0.2) * 3
    }).then(() => {
      note.visible = false
      st.hatLift = 0
      st.hatV -= 0.5
    })
  }

  // ---------- 卡片 ----------
  // 比例 5:7，四角是两级像素台阶，有真实厚度。低清网格走像素管线，高清网格画在上一层画布。
  const CARD_W = 0.44,
    CARD_H = 0.616,
    CARD_T = 0.02
  const cardShape = () => {
    const a = CARD_W / 2,
      b = CARD_H / 2,
      s = 0.012
    const pts = [
      [-a + 2 * s, -b],
      [a - 2 * s, -b],
      [a - 2 * s, -b + s],
      [a - s, -b + s],
      [a - s, -b + 2 * s],
      [a, -b + 2 * s],
      [a, b - 2 * s],
      [a - s, b - 2 * s],
      [a - s, b - s],
      [a - 2 * s, b - s],
      [a - 2 * s, b],
      [-a + 2 * s, b],
      [-a + 2 * s, b - s],
      [-a + s, b - s],
      [-a + s, b - 2 * s],
      [-a, b - 2 * s],
      [-a, -b + 2 * s],
      [-a + s, -b + 2 * s],
      [-a + s, -b + s],
      [-a + 2 * s, -b + s],
    ]
    return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  }
  const faceGeo = new THREE.ShapeGeometry(cardShape())
  {
    const p = faceGeo.attributes.position,
      uv = faceGeo.attributes.uv
    for (let i = 0; i < p.count; i++)
      uv.setXY(i, p.getX(i) / CARD_W + 0.5, p.getY(i) / CARD_H + 0.5)
  }
  const sideGeo = new THREE.ExtrudeGeometry(cardShape(), {
    depth: CARD_T,
    bevelEnabled: false,
  }).translate(0, 0, -CARD_T / 2)
  const LO_FRAG = `
uniform sampler2D tMap; uniform vec3 uL; varying vec3 vN; varying vec2 vUv;
${DITHER}
void main(){
  vec3 c = texture2D(tMap, vUv).rgb;
  float lit = dot(normalize(vN), uL) + (bayer4(gl_FragCoord.xy) - .5) * .2;
  if (lit < .05) c *= .84;
  gl_FragColor = vec4(c, 1.);
}`
  const HI_FRAG = `
uniform sampler2D tMap; uniform float uN, uSheen, uShade, uLod; varying vec2 vUv;
void main(){
  vec2 uv = vUv; vec3 c;
  if (uN > 0.) {
    vec2 g = vec2(uN, uN * 1.4);
    uv = (floor(uv * g) + .5) / g;
    c = textureLod(tMap, uv, uLod).rgb;
  } else c = texture2D(tMap, uv).rgb;
  // 高光：一道两级的硬边光带，随卡片倾斜滑动，不做柔光
  float b = abs(uv.x * .8 + uv.y * .55 - uSheen);
  if (b < .035) c += .11; else if (b < .075) c += .05;
  gl_FragColor = vec4(c * uShade, 1.);
}`
  const SIDE_FRAG = `uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, 1.); }`
  const SHADOW_FRAG = `uniform vec3 uC; uniform float uA; void main(){ gl_FragColor = vec4(uC, uA); }`
  const PLAIN_VERT = `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
  const hiScene = new THREE.Scene()
  const sideLo = flat('#2f49b8', '#5878e6', 0)

  const texOf = (c: HTMLCanvasElement, hi: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.NoColorSpace
    if (hi) {
      t.generateMipmaps = true
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.anisotropy = hiR.capabilities.getMaxAnisotropy()
    } else {
      t.generateMipmaps = false
      t.minFilter = t.magFilter = THREE.NearestFilter
    }
    return t
  }
  const shrink = (src: HTMLCanvasElement, into?: HTMLCanvasElement) => {
    const c = into ?? document.createElement('canvas')
    c.width = 96
    c.height = 134
    const x = c.getContext('2d')!
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = 'high'
    x.drawImage(src, 0, 0, 96, 134)
    return c
  }

  type CardState = 'deal' | 'fly' | 'rest' | 'pile' | 'gone'
  interface Card {
    id: string
    lo: THREE.Group
    hi: THREE.Group
    shadow: THREE.Mesh
    hiF: THREE.ShaderMaterial
    hiB: THREE.ShaderMaterial
    faceSrc: HTMLCanvasElement
    faceLoC: HTMLCanvasElement
    tex: THREE.Texture[]
    pos: THREE.Vector3
    q: THREE.Quaternion
    scale: number
    state: CardState
    showHi: boolean
    mosaic: number
    flip: number
    flipV: number
    flipT: number
    tiltX: number
    tiltY: number
    tiltTX: number
    tiltTY: number
    punch: number
    punchV: number
    arms: number[]
    hold: number
    pileIdx: number
  }
  const cards = new Map<string, Card>()
  let hand: Card[] = []
  let focus = 0
  let inspecting = false
  const pile: Card[] = []

  function makeCard(spec: { id: string; face: HTMLCanvasElement; back: HTMLCanvasElement }): Card {
    const old = cards.get(spec.id)
    if (old) dropCard(old)
    const faceLoC = shrink(spec.face),
      backLoC = shrink(spec.back)
    const tLoF = texOf(faceLoC, false),
      tLoB = texOf(backLoC, false),
      tHiF = texOf(spec.face, true),
      tHiB = texOf(spec.back, true)
    const loMat = (t: THREE.Texture) =>
      new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: LO_FRAG,
        uniforms: { tMap: { value: t }, uL: { value: uL } },
      })
    const hiMat = (t: THREE.Texture) =>
      new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: HI_FRAG,
        uniforms: {
          tMap: { value: t },
          uN: { value: 0 },
          uSheen: { value: -1 },
          uShade: { value: 1 },
          uLod: { value: 0 },
        },
      })
    const lo = new THREE.Group()
    const hi = new THREE.Group()
    const off = CARD_T / 2 + 0.0004
    const mkFaces = (
      g: THREE.Group,
      f: THREE.Material,
      b: THREE.Material,
      side: THREE.Material,
    ) => {
      const mf = new THREE.Mesh(faceGeo, f)
      mf.position.z = off
      const mb = new THREE.Mesh(faceGeo, b)
      mb.position.z = -off
      mb.rotation.y = Math.PI
      g.add(mf, mb, new THREE.Mesh(sideGeo, side))
    }
    const hiF = hiMat(tHiF),
      hiB = hiMat(tHiB)
    mkFaces(lo, loMat(tLoF), loMat(tLoB), sideLo)
    mkFaces(
      hi,
      hiF,
      hiB,
      new THREE.ShaderMaterial({
        vertexShader: PLAIN_VERT,
        fragmentShader: SIDE_FRAG,
        uniforms: { uC: { value: hex('#2f49b8') } },
      }),
    )
    const shadow = new THREE.Mesh(
      faceGeo,
      new THREE.ShaderMaterial({
        vertexShader: PLAIN_VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uC: { value: hex(PAL.ink) }, uA: { value: 0.16 } },
      }),
    )
    lo.visible = hi.visible = shadow.visible = false
    scene.add(lo)
    hiScene.add(shadow, hi)
    const c: Card = {
      id: spec.id,
      lo,
      hi,
      shadow,
      hiF,
      hiB,
      faceSrc: spec.face,
      faceLoC,
      tex: [tLoF, tLoB, tHiF, tHiB],
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      scale: 1,
      state: 'deal',
      showHi: false,
      mosaic: 0,
      flip: 1,
      flipV: 0,
      flipT: 1,
      tiltX: 0,
      tiltY: 0,
      tiltTX: 0,
      tiltTY: 0,
      punch: 0,
      punchV: 0,
      arms: [],
      hold: 0,
      pileIdx: -1,
    }
    cards.set(spec.id, c)
    return c
  }
  function dropCard(c: Card) {
    c.state = 'gone'
    scene.remove(c.lo)
    hiScene.remove(c.hi, c.shadow)
    c.tex.forEach((t) => t.dispose())
    cards.delete(c.id)
    hand = hand.filter((x) => x !== c)
    const at = pile.indexOf(c)
    if (at >= 0) {
      pile.splice(at, 1)
      pile.forEach((k, i) => {
        // 抽走中间一张，上面的往下落一层，序号和位置跟着改
        k.pileIdx = i
        if (k.state === 'pile') {
          const sp = pileSpot(Math.min(i, 9))
          k.pos.copy(sp.p)
          k.q.copy(sp.q)
        }
      })
    }
  }

  const tanH = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const fwd = new THREE.Vector3()
  const ray = new THREE.Vector3()
  function rayAt(x: number, y: number) {
    ray
      .set((x / cssW) * 2 - 1, 1 - (y / cssH) * 2, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize()
    return ray
  }
  // 视口上一点打到世界 z 平面的位置
  function screenToPlane(x: number, y: number, z: number) {
    const r = rayAt(x, y)
    return camera.position.clone().addScaledVector(r, (z - camera.position.z) / r.z)
  }
  function project(v: THREE.Vector3) {
    tmpC.copy(v).project(camera)
    return { x: ((tmpC.x + 1) / 2) * cssW, y: ((1 - tmpC.y) / 2) * cssH }
  }
  const qTmp = new THREE.Quaternion(),
    eTmp = new THREE.Euler()
  // 焦点卡正对人，两侧的牌往后退、往外转，形成一把扇子
  function restOf(c: Card, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    const r = opts.cardRest!()
    const i = hand.indexOf(c)
    const rel = i - focus
    const slot = r.carousel ? rel : i - (hand.length - 1) / 2
    const hgt = (inspecting ? (r.inspectH ?? r.h) : r.h) * (rel ? 0.84 : 1)
    const cx = (inspecting ? (r.inspectX ?? r.cx) : r.cx) + slot * r.gap
    const cy = (inspecting ? (r.inspectY ?? r.cy) : r.cy) + (rel ? r.h * 0.05 : 0)
    const d = (CARD_H * cssH) / (2 * tanH() * hgt)
    camera.getWorldDirection(fwd)
    const v = rayAt(cx, cy)
    outP.copy(camera.position).addScaledVector(v, d / v.dot(fwd))
    eTmp.set(0, -slot * 0.3 * (rel ? 1 : 0.35), -slot * 0.1 * (rel ? 1 : 0.35))
    outQ.copy(camera.quaternion).multiply(qTmp.setFromEuler(eTmp))
  }

  function mosaicAt(c: Card, n: number) {
    c.mosaic = n
    for (const m of [c.hiF, c.hiB]) {
      m.uniforms.uN.value = n
      m.uniforms.uLod.value = n > 0 ? Math.max(0, Math.log2(720 / n) - 0.5) : 0
    }
  }

  // 递卡：腕足从抽屉里抽出来举到身前（低清、背面朝人）→ 身子后仰蓄力 → 往人这边一送，
  // 卡片翻到正面、飞到眼前，途中从像素一档档解开。腕足送一程就松开收回。
  async function deal(specs: { id: string; face: HTMLCanvasElement; back: HTMLCanvasElement }[]) {
    const list = specs.map(makeCard)
    hand = list
    focus = list.length === 3 ? 1 : 0
    inspecting = false
    const n = list.length
    const armsOf = n === 1 ? [[7, 0]] : n === 2 ? [[6], [1]] : [[6], [0], [1]]
    const xs = n === 1 ? [0] : n === 2 ? [-0.28, 0.28] : [-0.52, 0, 0.52]
    const dr = drawers[st.rumDrawer]
    dr.g.updateMatrixWorld()
    const src = new THREE.Vector3(0, 0.1, -0.1).applyMatrix4(dr.g.matrixWorld)
    await Promise.all(
      list.map(async (c, i) => {
        c.arms = armsOf[i % armsOf.length]
        c.lo.visible = true
        c.q.copy(camera.quaternion)
        c.flip = c.flipT = 1
        c.pos.copy(src)
        c.scale = 0.12
        await pause(i * 0.16)
        const to = V(xs[i % xs.length], 0.2 + (n === 3 && i === 1 ? 0.05 : 0), 0.62)
        const fromP = c.pos.clone()
        await anim(0.62, (p) => {
          const e = inOut(p)
          c.pos.lerpVectors(fromP, to, e)
          c.pos.y += Math.sin(p * Math.PI) * 0.16
          c.scale = 0.12 + 0.88 * e
          c.hold = sm(p * 1.6)
        })
      }),
    )
    stopRummage()
    st.sqV -= 0.9
    await play('windup', 0.42, (p) => {
      pose.pitch = -0.26 * sm(p * 1.8)
      pose.eye = 1
    })
    // 送出去
    st.sqV += 2.4
    play('thrust', 0.66, (p) => {
      pose.pitch = 0.2 * Math.sin(p * Math.PI)
      pose.dz = 0.12 * Math.sin(p * Math.PI)
    })
    await Promise.all(
      list.map(async (c, i) => {
        await pause(Math.abs(i - focus) * 0.07)
        c.state = 'fly'
        const fromP = c.pos.clone()
        const fromQ = c.q.clone()
        const toP = new THREE.Vector3(),
          toQ = new THREE.Quaternion()
        restOf(c, toP, toQ)
        let swapped = false
        c.flipT = 0
        await anim(0.72, (p) => {
          const e = outCubic(p)
          c.pos.lerpVectors(fromP, toP, e)
          c.pos.y += Math.sin(p * Math.PI) * 0.05
          c.q.slerpQuaternions(fromQ, toQ, e)
          if (!swapped && p > 0.14) {
            swapped = true
            c.lo.visible = false
            c.showHi = true
          }
          // 一格格解开：每档翻一倍，到清晰前有三四次可见的跳变
          mosaicAt(c, p > 0.8 ? 0 : p > 0.64 ? 192 : p > 0.46 ? 96 : p > 0.3 ? 48 : 32)
          // 牌离手：腕足只送一程，到正常长度就松开收回，不跟着牌拉长
          c.hold = 1 - sm((p - 0.12) / 0.4)
        })
        mosaicAt(c, 0)
        c.hold = 0
        c.state = 'rest'
      }),
    )
  }

  // 那一摞的位置：桌面在八爪鱼右边，窄屏收到它右前方，保证看得见
  const pileAt = new THREE.Vector3(0.74, FLOOR, 0.1)
  function clearHand() {
    hand = []
    inspecting = false
    focus = 0
  }
  function pileSpot(i: number) {
    const a = Math.sin(i * 12.9) * 0.5
    return {
      p: V(
        pileAt.x + 0.05 * Math.sin(i * 3.1),
        FLOOR + 0.012 + i * 0.022,
        pileAt.z + 0.04 * Math.cos(i * 2.3),
      ),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, a)),
    }
  }
  // 收下：卡片飞回房间、落到右边那一摞上。摞会一直留着，这是这次聊天攒下来的东西
  async function takeCard(id: string) {
    const c = cards.get(id)
    if (!c) return
    hand = hand.filter((x) => x !== c)
    focus = Math.min(focus, Math.max(0, hand.length - 1))
    c.state = 'fly'
    c.flipT = 0
    const i = pile.length
    pile.push(c)
    c.pileIdx = i
    const spot = pileSpot(Math.min(i, 9))
    const s = 0.62
    const fromP = c.pos.clone(),
      fromQ = c.q.clone()
    const fromH = c.hold
    await anim(0.6, (p) => {
      const e = inOut(p)
      c.pos.lerpVectors(fromP, spot.p, e)
      c.pos.y += Math.sin(p * Math.PI) * 0.22
      c.q.slerpQuaternions(fromQ, spot.q, e)
      c.scale = 1 + (s - 1) * e
      c.hold = fromH * (1 - clamp01(p * 2.4))
      mosaicAt(c, p > 0.8 ? 32 : p > 0.62 ? 64 : p > 0.42 ? 128 : 0)
    })
    c.showHi = false
    mosaicAt(c, 0)
    c.lo.visible = i < 10
    c.state = 'pile'
    const tp = project(spot.p)
    void tp
    fx('dot', V(spot.p.x - 0.1, spot.p.y + 0.03, spot.p.z + 0.05), {
      v: [-0.3, 0.2, 0],
      life: 0.3,
      g: -0.6,
      size: 0.05,
      color: '#b8c1d8',
    })
    fx('dot', V(spot.p.x + 0.1, spot.p.y + 0.03, spot.p.z + 0.05), {
      v: [0.3, 0.2, 0],
      life: 0.3,
      g: -0.6,
      size: 0.05,
      color: '#b8c1d8',
    })
  }
  // 放回：飞进抽屉，抽屉合上
  async function fileCard(id: string) {
    const c = cards.get(id)
    if (!c) return
    hand = hand.filter((x) => x !== c)
    focus = Math.min(focus, Math.max(0, hand.length - 1))
    c.state = 'fly'
    drawers[2].target = 1
    await pause(0.16)
    drawers[2].g.updateMatrixWorld()
    const to = new THREE.Vector3(0, 0.12, -0.1).applyMatrix4(drawers[2].g.matrixWorld)
    const fromP = c.pos.clone(),
      fromQ = c.q.clone()
    const fromH = c.hold
    c.flipT = 1
    await anim(0.6, (p) => {
      const e = inOut(p)
      c.pos.lerpVectors(fromP, to, e)
      c.q.slerpQuaternions(fromQ, camera.quaternion, e)
      c.scale = 1 - 0.65 * e
      c.hold = fromH * (1 - clamp01(p * 2.4))
      mosaicAt(c, p > 0.72 ? 32 : p > 0.5 ? 64 : p > 0.3 ? 128 : 0)
      if (p > 0.55 && c.showHi) {
        c.showHi = false
        c.lo.visible = true
      }
    })
    dropCard(c)
    drawers[2].target = 0
  }
  // 从那一摞或卡册里重新拿起一张
  async function reopen(
    id: string,
    spec?: { id: string; face: HTMLCanvasElement; back: HTMLCanvasElement },
  ) {
    let c = cards.get(id)
    if (!c && spec) {
      c = makeCard(spec)
      c.pos.copy(pileSpot(Math.min(pile.length, 9)).p)
      c.q.copy(camera.quaternion)
      c.scale = 0.5
      c.flip = c.flipT = 0
      c.pileIdx = pile.length
      pile.push(c)
    }
    if (!c) return
    hand = [c]
    focus = 0
    inspecting = true
    c.arms = []
    c.hold = 0
    c.lo.visible = false
    c.showHi = true
    c.state = 'fly'
    c.flipT = 0
    const fromP = c.pos.clone(),
      fromQ = c.q.clone(),
      fromS = c.scale
    const toP = new THREE.Vector3(),
      toQ = new THREE.Quaternion()
    restOf(c, toP, toQ)
    await anim(0.5, (p) => {
      const e = outCubic(p)
      c!.pos.lerpVectors(fromP, toP, e)
      c!.q.slerpQuaternions(fromQ, toQ, e)
      c!.scale = fromS + (1 - fromS) * e
      mosaicAt(c!, p > 0.6 ? 0 : p > 0.4 ? 128 : p > 0.2 ? 64 : 32)
    })
    mosaicAt(c, 0)
    c.state = 'rest'
  }
  // 把看完的牌放回那一摞原位
  async function repile(id: string) {
    const c = cards.get(id)
    if (!c || c.pileIdx < 0) return
    hand = hand.filter((x) => x !== c)
    inspecting = false
    c.state = 'fly'
    c.flipT = 0
    const spot = pileSpot(Math.min(c.pileIdx, 9))
    const fromP = c.pos.clone(),
      fromQ = c.q.clone()
    await anim(0.5, (p) => {
      const e = inOut(p)
      c.pos.lerpVectors(fromP, spot.p, e)
      c.q.slerpQuaternions(fromQ, spot.q, e)
      c.scale = 1 - 0.38 * e
      mosaicAt(c, p > 0.75 ? 32 : p > 0.55 ? 64 : p > 0.35 ? 128 : 0)
    })
    c.showHi = false
    mosaicAt(c, 0)
    c.lo.visible = c.pileIdx < 10
    c.state = 'pile'
  }

  // 卡片每帧：扇形归位、弹簧翻面、指针倾斜，再把同一个位姿写给低清和高清两份网格
  // 腕足能伸多远：约为静止时长度的两倍，再长就成了拉面
  const ARM_REACH = 0.72
  const cP = new THREE.Vector3(),
    cQ = new THREE.Quaternion(),
    armAt = new THREE.Vector3()
  function stepCards(dt: number) {
    for (const c of cards.values()) {
      if (c.state === 'rest') {
        restOf(c, cP, cQ)
        const k = 1 - Math.exp(-dt * 11)
        c.pos.lerp(cP, k)
        c.q.slerp(cQ, k)
      }
      c.flipV += (70 * (c.flipT - c.flip) - 11 * c.flipV) * dt
      c.flip += c.flipV * dt
      const kt = 1 - Math.exp(-dt * 9)
      c.tiltX += (c.tiltTX - c.tiltX) * kt
      c.tiltY += (c.tiltTY - c.tiltY) * kt
      c.punchV += (-300 * c.punch - 22 * c.punchV) * dt
      c.punch += c.punchV * dt
      eTmp.set(c.tiltX, c.flip * Math.PI + c.tiltY, 0)
      qTmp.setFromEuler(eTmp).premultiply(c.q)
      const sc = c.scale * (1 + c.punch)
      c.lo.position.copy(c.pos)
      c.lo.quaternion.copy(qTmp)
      c.lo.scale.setScalar(sc)
      c.hi.visible = c.showHi
      c.shadow.visible = c.showHi && Math.abs(Math.cos(c.flip * Math.PI)) > 0.3
      if (c.showHi) {
        c.hi.position.copy(c.pos)
        c.hi.quaternion.copy(qTmp)
        c.hi.scale.setScalar(sc)
        c.shadow.position.copy(c.pos)
        c.shadow.quaternion.copy(qTmp)
        c.shadow.scale.setScalar(sc)
        // 影子贴着卡往右下错开，距离按屏幕尺寸定
        tmpC.set(0.016, -0.022, -0.02).applyQuaternion(c.q)
        c.shadow.position.add(tmpC)
        const face = Math.cos(c.flip * Math.PI)
        const sheen = 0.65 + c.tiltY * 2.2 - c.tiltX * 1.4 + (1 - Math.abs(face)) * 0.9
        const shade = 0.9 + 0.1 * Math.abs(face)
        c.hiF.uniforms.uSheen.value = c.hiB.uniforms.uSheen.value = sheen
        c.hiF.uniforms.uShade.value = c.hiB.uniforms.uShade.value = shade
      }
      // 托着卡的腕足：把卡底的点投到身前的平面上，从屏幕上看正好接在卡的下沿
      if (c.hold > 0.001 && c.arms.length) {
        c.arms.forEach((a, k) => {
          const sd = c.arms.length === 2 ? (k === 0 ? -1 : 1) : 0
          armAt
            .set(sd * CARD_W * 0.34 * sc, -CARD_H * 0.47 * sc, 0)
            .applyQuaternion(c.q)
            .add(c.pos)
          if (c.showHi) {
            const pt = project(armAt)
            armAt.copy(screenToPlane(pt.x, pt.y - 6, 0.66))
          } else armAt.z += 0.03
          body.worldToLocal(armAt)
          const len = armAt.length()
          if (len > ARM_REACH) armAt.multiplyScalar(ARM_REACH / len)
          reach(a, armAt.x, armAt.y, armAt.z, sd * 0.2, 0.7, 0.5, c.hold)
        })
      }
    }
  }

  // 节拍，一轮 CYCLE 秒：
  //   search：放大镜在身前慢慢游走，脑袋和眼睛跟着镜片；7 秒左右把放大镜举到右眼前，镜片里是一只放大的眼睛，停一会儿再拿开。
  //   read：低头看书，脑袋跟着一行行字左右慢慢移；8 秒左右把书放低一点，抬眼从书上沿看人。
  //   idle：不拿道具；6 秒左右 6 号腕足沿着脑袋左侧伸上去扶一下贝雷帽。
  const CYCLE = 12
  const bookGripL: Grip = { w: 0, at: new THREE.Vector3(), dir: new THREE.Vector3() }
  const bookGripR: Grip = { w: 0, at: new THREE.Vector3(), dir: new THREE.Vector3() }
  const magGrip: Grip = { w: 0, at: new THREE.Vector3(), dir: new THREE.Vector3() }
  const rightGrip: Grip = { w: 0, at: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0) }
  const hatGrip: Grip = {
    w: 0,
    at: new THREE.Vector3(-0.27, 0.43, 0.03),
    dir: new THREE.Vector3(0.25, 1, -0.05).normalize(),
  }
  const lens = new THREE.Vector3(),
    atEye = new THREE.Vector3(EX, EY, 0.37)

  function step(dt: number) {
    st.t += dt
    const t = st.t
    const target = MOOD[st.mood]
    const ease = 1 - Math.exp(-dt * 3)
    ;(Object.keys(cur) as (keyof Coef)[]).forEach((k) => {
      cur[k] += (target[k] - cur[k]) * ease
    })
    // 波形和呼吸都按相位累加：直接写 频率×总时间 的话，频率一变相位就被放大，页面开得越久切动作时抖得越狠
    st.wave += cur.w * dt
    st.breathRate += ((st.mood === 'talk' ? 5 : 1.6) - st.breathRate) * (1 - Math.exp(-dt * 4))
    st.breath += st.breathRate * dt
    const k = 1 - Math.exp(-dt * 5)
    st.book += ((st.mood === 'read' ? 1 : 0) - st.book) * k
    st.mag += ((st.mood === 'search' ? 1 : 0) - st.mag) * k
    // 腕足先伸过去，道具随后长出来；收的时候反过来
    const grow = (v: number) => sm((v - 0.3) / 0.6)
    const ct = t % CYCLE

    // 书：捧在脸前偏低，书页朝自己；看人那一下书放低一点
    const peek = st.book * env(ct, 8, 0.6, 1.4, 0.7)
    book.position.set(0, -0.07 - 0.06 * peek + 0.005 * Math.sin(t * 1.6), 0.42)
    book.rotation.set(0.22 + 0.03 * Math.sin(t * 0.9), 0, 0.03 * Math.sin(t * 0.7))
    book.scale.setScalar(grow(st.book))
    book.visible = st.book > 0.3
    book.updateMatrix()
    for (const [g, leaf, sd] of [
      [bookGripL, leaves[1], -1],
      [bookGripR, leaves[0], 1],
    ] as const) {
      leaf.updateMatrix()
      g.at
        .set(sd * LW * 0.86, 0.025, 0.008)
        .applyMatrix4(leaf.matrix)
        .applyMatrix4(book.matrix)
      g.dir.set(sd * 0.4, 0.5, 0.75).normalize() // 从书后下方伸上来捏住两个下角
      g.w = sm(st.book * 1.25)
    }

    // 放大镜：在身前游走；举到眼前那一下镜片转正、画出放大的眼睛
    const peer = st.mag * env(ct, 7, 0.7, 1.4, 0.7)
    lens
      .set(
        0.11 + 0.2 * Math.sin(t * 0.55),
        0.12 + 0.1 * Math.sin(t * 0.83 + 1),
        0.46 + 0.04 * Math.sin(t * 0.4),
      )
      .lerp(atEye, peer)
    const rot = 0.5 + 0.15 * Math.sin(t * 0.9) - 0.2 * peer // 柄朝右下
    magGrip.dir.set(-Math.sin(rot), Math.cos(rot), 0)
    mag.position.copy(lens).addScaledVector(magGrip.dir, -(HL + MR))
    mag.rotation.set(0, 0, rot)
    mag.scale.setScalar(grow(st.mag))
    mag.visible = st.mag > 0.3
    glassMat.uniforms.uEye.value = peer > 0.6 ? 1 : 0
    magGrip.w = sm(st.mag * 1.25)
    magGrip.at.copy(mag.position)

    // 待机时扶帽子：6 号腕足沿着脑袋左侧伸到帽檐，帽子跟着歪一下
    const fix = (1 - Math.max(st.book, st.mag)) * env(ct, 6, 0.7, 0.8, 0.7)
    hatGrip.w = fix
    hat.rotation.set(-0.12, 0, -0.28 + 0.1 * fix * Math.sin(ct * 5))
    hat.position.y = 0.48 + 0.012 * fix + st.hatO + st.hatLift
    hat.rotation.z += st.hatO * 2.2
    if (st.mood === 'sleep') hat.rotation.x += 0.1

    // 手势层：先清零，再让每个在放的手势写一遍
    pose.yaw = pose.lookX = pose.lookY = NaN
    pose.pitch = pose.roll = pose.dx = pose.dz = pose.mouth = pose.blush = 0
    pose.eye = st.mood === 'sleep' ? 2 : st.mood === 'happy' ? 3 : st.mood === 'warn' ? 4 : 0
    for (const g of slots) g.w = 0
    for (let i = tweens.length - 1; i >= 0; i--) {
      const a = tweens[i]
      a.t += dt
      const p = Math.min(1, a.t / a.d)
      a.fn(p, dt)
      if (p >= 1) {
        tweens.splice(i, 1)
        a.r()
      }
    }
    for (let i = acts.length - 1; i >= 0; i--) {
      const a = acts[i]
      a.t += dt
      a.run(Math.min(1, a.t / a.d), a.t, dt)
      if (a.t >= a.d) {
        acts.splice(i, 1)
        a.r()
      }
    }
    stepWorld(dt, t)

    // 朝向：看书时低头、跟着字行左右移，抬眼时看人；查的时候跟着镜片；鼠标最近动过就瞟过去
    let yawT = 0.18 * Math.sin(t * 0.23),
      pitchT = 0.03 * Math.sin(t * 0.31)
    look.set(0.15 * Math.sin(t * 0.4), 0)
    if (st.book > 0.5) {
      const line = (t * 0.45) % 1 // 读一行：从左慢慢移到右，再快速回到行首
      const sweep = line < 0.85 ? sm(line / 0.85) : 1 - sm((line - 0.85) / 0.15)
      yawT = (0.1 * sweep - 0.05) * (1 - peek)
      pitchT = 0.14 * (1 - peek) - 0.04 * peek
      look.set((sweep - 0.5) * (1 - peek), -0.8 * (1 - peek) + 0.2 * peek)
    } else if (st.mag > 0.5) {
      yawT = 0.8 * (lens.x - 0.05) * (1 - peer)
      pitchT = -0.5 * (lens.y - 0.15) * (1 - peer)
      look.set(3 * (lens.x - 0.05) * (1 - peer), 3 * (lens.y - 0.15) * (1 - peer))
    }
    if (pointer && performance.now() - pointerAt < 6000) {
      const hd = headScreen()
      const dx = (pointer.x - hd.x) / 380
      const dy = (pointer.y - hd.y) / 380
      const w = st.book > 0.5 || st.mag > 0.5 ? 0.5 : 1
      yawT += (Math.max(-0.6, Math.min(0.6, dx * 0.9)) - yawT) * w
      pitchT += (Math.max(-0.25, Math.min(0.3, dy * 0.35)) - pitchT) * w
      look.set(Math.max(-1, Math.min(1, dx * 1.6)), Math.max(-1, Math.min(1, -dy * 1.6)))
    }
    if (st.mood === 'think') look.set(0.7, 0.8)
    if (st.mood === 'listen') {
      pitchT += 0.15
      look.set(look.x * 0.4, -0.9)
    }
    if (st.mood === 'sad') {
      pitchT += 0.16
      look.set(0, -0.8)
    }
    if (st.mood === 'sleep') {
      pitchT = 0.2
      yawT = 0
    }
    if (hand.length) {
      // 手上有牌时盯着焦点卡，看人收不收
      const fc = hand[focus]
      if (fc) {
        const pt = project(fc.pos)
        const hd = headScreen()
        const gx = Math.max(-1, Math.min(1, (pt.x - hd.x) / 320))
        yawT = 0.5 * gx
        look.set(gx, -0.3)
      }
    }
    if (!Number.isNaN(pose.yaw)) yawT = pose.yaw
    if (!Number.isNaN(pose.lookX)) look.set(pose.lookX, pose.lookY)
    pitchT += pose.pitch
    // 转头用临界阻尼的弹簧：跟得上，但不回弹
    st.yawV += (24 * (yawT - st.yaw) - 2 * Math.sqrt(24) * st.yawV) * dt
    st.yaw += st.yawV * dt
    st.pitchV += (16 * (pitchT - st.pitch) - 8 * st.pitchV) * dt
    st.pitch += st.pitchV * dt

    // 跳：抛物线，落地时蹲一下、扬点灰、帽子晚半拍才落下来
    if (st.jump > 0 || st.jumpV > 0) {
      st.jumpV -= 9.5 * dt
      st.jump += st.jumpV * dt
      st.hatV += st.jumpV > 0 ? -0.9 * dt : 2.6 * dt
      if (st.jump <= 0) {
        const hit = -st.jumpV
        st.jump = st.jumpV = 0
        st.sqV -= hit * 1.5
        st.hatV -= hit * 0.3
        dust(body.position.x, body.position.z, hit > 1.5 ? 6 : 3)
      }
    }
    st.sqV += (-190 * st.sq - 15 * st.sqV) * dt
    st.sq += st.sqV * dt
    st.hatV += (-110 * st.hatO - 10 * st.hatV) * dt
    st.hatO += st.hatV * dt

    // 0 号腕足看书时捏右下角、查的时候拿放大镜；两种状态之间按权重混合握点，切换时平滑地从一处移到另一处
    const wb = bookGripR.w,
      wm = magGrip.w,
      sum = wb + wm
    if (sum > 0.001) {
      rightGrip.at
        .copy(bookGripR.at)
        .multiplyScalar(wb / sum)
        .addScaledVector(magGrip.at, wm / sum)
      rightGrip.dir
        .copy(bookGripR.dir)
        .multiplyScalar(wb / sum)
        .addScaledVector(magGrip.dir, wm / sum)
        .normalize()
    }
    rightGrip.w = Math.max(wb, wm)
    stepCards(dt)
    // 听人打字：两只前腕足跟着按键一上一下，像在一起敲
    st.listen += ((st.mood === 'listen' ? 1 : 0) - st.listen) * k
    st.tapL = Math.max(0, st.tapL - dt * 7)
    st.tapR = Math.max(0, st.tapR - dt * 7)
    if (st.listen > 0.02) {
      reach(7, -0.17, 0.03 + 0.035 * st.tapL, 0.5, -0.1, -0.2, 1, st.listen * 0.95)
      reach(0, 0.17, 0.03 + 0.035 * st.tapR, 0.5, 0.1, -0.2, 1, st.listen * 0.95)
    }
    // 同一条腕足常有两个来源在抢（放大镜和手势、听打字和接纸条），权重交叉那一帧目标会跳；
    // 这里统一再过一道低通，谁抢到都是从当前位置走过去。60/s 够快，不会让腕尖脱开道具
    const kg = 1 - Math.exp(-dt * 60)
    const kw = 1 - Math.exp(-dt * 16)
    for (let i = 0; i < ARMS; i++) {
      const base = i === 7 ? bookGripL : i === 0 ? rightGrip : i === 6 ? hatGrip : null
      const want = slots[i].w > (base?.w ?? 0) ? slots[i] : base
      const g = armOut[i]
      if (want && want.w > 0.001) {
        if (g.w < 0.01) {
          g.at.copy(want.at)
          g.dir.copy(want.dir)
        } else {
          g.at.lerp(want.at, Math.min(kg, kw * 1.6))
          g.dir.lerp(want.dir, kw).normalize()
        }
        g.w += (want.w - g.w) * kw
      } else g.w = g.w < 0.004 ? 0 : g.w * (1 - kw)
      buildArm(arms[i], g.w > 0.001 ? g : null)
    }

    // 呼吸
    const breathe = 1 + 0.025 * Math.sin(st.breath)
    mantle.scale.set(breathe, 1 / Math.sqrt(breathe), breathe)

    // 眨眼
    st.nextBlink -= dt
    if (st.nextBlink < 0) {
      st.blink = 0.14
      st.nextBlink = 2.5 + Math.random() * 4
    }
    st.blink = Math.max(0, st.blink - dt)
    // 换表情时先眨一下，眼型在闭眼的那一瞬换掉，看不出切换
    if (pose.eye !== st.eyeWas) {
      st.eyeWas = pose.eye
      st.blink = Math.max(st.blink, 0.09)
    }
    const lidT =
      pose.eye === 2 || st.blink > 0 ? 0.12 : pose.eye === 1 ? 1.28 : pose.eye === 4 ? 0.74 : 1
    st.lid += (lidT - st.lid) * (1 - Math.exp(-dt * 34))
    const lid = st.lid
    for (const e of eyes as any[]) {
      e.g.scale.y = pose.eye === 3 ? 1 : lid
      e.g.scale.x = pose.eye === 1 ? 1.16 : 1
      e.pupil.visible = pose.eye !== 3
      e.arc.visible = pose.eye === 3
      e.lid.visible = pose.eye === 4
      e.pupil.position.x = 0.005 * look.x
      e.pupil.position.y = 0.004 * look.y
    }

    blushes[0].visible = blushes[1].visible = pose.blush > 0.4
    mouth.visible = pose.mouth > 0.08
    mouth.scale.set(0.5 + 0.5 * pose.mouth, 0.3 + pose.mouth, 0.3)

    const kb = 1 - Math.exp(-dt * 12)
    st.dx += (pose.dx - st.dx) * kb
    st.dz += (pose.dz - st.dz) * kb
    st.roll += (pose.roll - st.roll) * kb
    body.rotation.set(st.pitch, st.yaw, -st.yawV * 0.05 + st.roll)
    // 登场：从天上掉下来，落地全靠上面的跳跃逻辑
    const bob = cur.bob * Math.sin(t * 1.25) + st.jump
    body.position.set(st.dx, Math.round(bob / WPX) * WPX, st.dz)
    body.scale.set(1 - st.sq * 0.7, 1 + st.sq, 1 - st.sq * 0.7)
    body.updateMatrixWorld()
    skin.uniforms.uFlush.value = st.flush
    post.uniforms.uDim.value = st.dim
    updateShadows()
  }

  const tmpA = new THREE.Vector3(),
    tmpB = new THREE.Vector3(),
    tmpC = new THREE.Vector3()
  function headScreen() {
    tmpC.set(0, 0.34, 0.1)
    body.localToWorld(tmpC)
    return project(tmpC)
  }
  // 贝雷帽顶：气泡尾巴指的地方
  function topScreen() {
    tmpC.set(0.05, 0.62, 0)
    body.localToWorld(tmpC)
    return project(tmpC)
  }
  // 落地影：跳得越高越小，贴着地面的那个点投到逻辑像素
  function updateShadows() {
    const u = post.uniforms.uSh.value as THREE.Vector4[]
    const pt = project(tmpA.set(body.position.x, FLOOR, body.position.z))
    const k = 1 - Math.min(0.55, st.jump * 1.3)
    u[0].set(pt.x / px, (cssH - pt.y) / px, 46 * k, 13 * k)
    const pc = project(tmpA.set(cabPos.x, FLOOR, cabPos.z + 0.2))
    u[1].set(pc.x / px, (cssH - pc.y) / px, 30, 7)
    if (pile.length) {
      const pp = project(tmpA.copy(pileAt))
      u[2].set(pp.x / px, (cssH - pp.y) / px, 22, 7)
    } else u[2].set(0, 0, 0, 0)
  }
  // 世界里其余会动的东西：抽屉、翻柜子、粒子、变色、待机小动作、摸头
  function stepWorld(dt: number, t: number) {
    const k = 1 - Math.exp(-dt * 9)
    for (const d of drawers) {
      d.open += (d.target - d.open) * k
      d.g.position.z = CABD / 2 + 0.26 * d.open
    }
    st.rum += ((rummaging ? 1 : 0) - st.rum) * (1 - Math.exp(-dt * (rummaging ? 9 : 6)))
    if (st.rumClose && st.rum < 0.3) {
      st.rumClose = false
      drawers[st.rumDrawer].target = 0
    }
    if (st.rum > 0.01) {
      st.rumT += dt
      const dr = drawers[st.rumDrawer]
      dr.g.updateMatrixWorld()
      tmpB
        .set(0.04 * Math.sin(t * 9), 0.1, -0.08 + 0.05 * Math.sin(t * 6))
        .applyMatrix4(dr.g.matrixWorld)
      body.worldToLocal(tmpB)
      const e = st.rum
      pose.yaw = -0.72 * e
      pose.dx = -0.14 * e
      if (rummaging) {
        pose.lookX = -1
        pose.lookY = -0.3
      }
      reach(6, tmpB.x, tmpB.y, tmpB.z, -0.6, -0.5, -0.3, e)
      tmpB.set(-0.08 + 0.05 * Math.cos(t * 7), 0.08, -0.14).applyMatrix4(dr.g.matrixWorld)
      body.worldToLocal(tmpB)
      reach(5, tmpB.x, tmpB.y, tmpB.z, -0.6, -0.5, -0.1, e)
      if (rummaging && st.rumT > 0.4 && Math.random() < dt * 5) {
        tmpC.set(0, 0.12, -0.04).applyMatrix4(dr.g.matrixWorld)
        fx('paper', tmpC.clone(), {
          v: [0.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.2],
          life: 0.75,
          g: -2.6,
          size: 0.075,
          color: '#a9b4d0',
          outline: true,
        })
      }
    }
    for (const p of parts) {
      if (!p.on) continue
      p.age += dt
      if (p.age >= p.life) {
        p.on = false
        p.m.visible = false
        continue
      }
      p.v.y += p.g * dt
      p.m.position.addScaledVector(p.v, dt)
      p.m.quaternion.copy(camera.quaternion)
      p.m.scale.setScalar(p.size * (p.age > p.life * 0.7 ? 0.7 : 1))
    }
    camKT = hand.length > 1 || (hand.length && opts.liftOne?.()) ? 1 : 0
    if (Math.abs(camKT - camK) > 0.002) {
      camK += (camKT - camK) * (1 - Math.exp(-dt * (reduce ? 60 : 5)))
      placeCamera()
    }
    st.flush += (st.flushT - st.flush) * (1 - Math.exp(-dt * 2.6))
    st.dim += (st.dimT - st.dim) * (1 - Math.exp(-dt * 10))
    if (st.dimT === 0 && st.dim < 0.04) st.dim = 0 // 指数逼近到不了零，留着就是一层稀疏的点
    if (st.annoyed > 0) {
      st.annoyed -= dt
      pose.eye = 4
      if (st.annoyed <= 0) st.flushT = moodFlush()
    }
    // 摸头：指针在帽子附近来回动，先是舒服地眯眼，够久了脸红
    st.pet = Math.max(0, st.pet - dt * 0.6)
    st.petCool = Math.max(0, st.petCool - dt)
    if (st.pet > 0.7 && st.mood !== 'sleep') {
      pose.eye = 3
      pose.blush = 1
      if (st.petCool <= 0) {
        st.petCool = 0.5
        fx('heart', tmpA.set(-0.2 + Math.random() * 0.4, 0.68, 0.1).clone(), {
          v: [0, 0.4, 0],
          life: 0.7,
          size: 0.075,
          color: '#d9748a',
          outline: true,
        })
      }
    }
    if (st.mood === 'sleep') {
      st.zT -= dt
      if (st.zT < 0) {
        st.zT = 1.5
        fx('z', V(0.32, 0.62, 0.1), {
          v: [0.1, 0.17, 0],
          life: 1.7,
          size: 0.085,
          color: '#5878e6',
          outline: true,
        })
      }
    }
    // 待机别只呼吸：隔一阵随机做点小事，和原有的扶帽子错开
    if (st.mood === 'idle' && !acts.length && !hand.length) {
      st.nextIdle -= dt
      if (st.nextIdle < 0) {
        st.nextIdle = 7 + Math.random() * 6
        const pick = ['lookAround', 'stretch', 'yawn', 'chin'][Math.floor(Math.random() * 4)]
        GEST[pick]()
      }
    }
  }
  const moodFlush = () => (st.mood === 'sad' ? 1.2 : 0)
  const FLUSH = {
    rose: ['#a8485f', '#d9748a', '#f2a7b5'],
    ash: ['#4f5874', '#7a84a3', '#a9b1c9'],
  }
  function setFlush(name: keyof typeof FLUSH) {
    const f = FLUSH[name],
      u = skin.uniforms
    u.f0.value = hex(f[0])
    u.f1.value = hex(f[1])
    u.f2.value = hex(f[2])
  }
  function setMood(m: Mood) {
    st.mood = m
    if (m === 'sad') setFlush('ash')
    st.flushT = moodFlush()
  }

  // 戳：一下弹一下；连着戳就不高兴，戳到第五下喷一团墨。返回连戳次数，台词归外层
  function poke() {
    const now = performance.now()
    st.pokes = now - st.pokeAt < 1600 ? st.pokes + 1 : 1
    st.pokeAt = now
    hop(1.5 + Math.min(0.8, st.pokes * 0.15))
    if (st.pokes === 3) {
      setFlush('rose')
      st.flushT = 1.2
      st.annoyed = 2.6
    }
    if (st.pokes === 5) {
      st.annoyed = 3
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        fx(i % 3 ? 'ink' : 'dot', V(0, 0.1, 0.42), {
          v: [Math.cos(a) * (0.5 + Math.random() * 0.8), 0.5 + Math.sin(a) * 0.6, 0.4],
          life: 0.95,
          g: -1.8,
          size: 0.09 + Math.random() * 0.1,
          color: PAL.ink,
          outline: false,
        })
      }
    }
    return st.pokes
  }

  function layout() {
    cssW = host.clientWidth || innerWidth
    cssH = host.clientHeight || innerHeight
    const dpr = Math.max(1, Math.round(devicePixelRatio || 1))
    // 一格多大：竖向约 235 格，再保证窄屏横向至少 120 格；只取乘上设备像素比是整数的值，方块才锐
    const want = Math.min(cssH / 235, cssW / 120)
    px = Math.max(2, Math.round(want * dpr) / dpr)
    w = Math.ceil(cssW / px)
    h = Math.ceil(cssH / px)
    renderer.setSize(w, h, false)
    canvas.style.width = w * px + 'px'
    canvas.style.height = h * px + 'px'
    hiR.setPixelRatio(Math.min(2, devicePixelRatio || 1))
    hiR.setSize(cssW, cssH)
    rt.dispose()
    rt.depthTexture?.dispose()
    rt = makeRT(w, h)
    post.uniforms.tColor.value = rt.texture
    post.uniforms.tDepth.value = rt.depthTexture
    post.uniforms.uRes.value.set(w, h)
    const visH = h / Z
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(visH / (2 * CAM_D)))
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    placeCamera()
    // 柜子贴着画面左边：窄屏往里收，躲到八爪鱼身后半截
    const halfW = w / Z / 2
    cabPos.x = -Math.min(0.82, halfW - 0.1)
    cabinet.position.copy(cabPos)
    pileAt.x = Math.min(0.74, halfW - 0.2)
    pileAt.z = halfW < 0.8 ? 0.5 : 0.1
  }
  // 机位只在竖直方向平移，移动量吸附到整格：画面整体一格格走，抖动花纹不会游动
  let camK = 0,
    camKT = 0
  function placeCamera() {
    const fy = opts.focusY?.() ?? { rest: 0.45, lift: 0.3 }
    const focusY = (fy.rest + (fy.lift - fy.rest) * camK) * cssH
    const raw = 0.2 - (cssH / 2 - focusY) / (Z * px * 0.968)
    const ty = Math.round(raw / WPX) * WPX
    camera.position.set(0, ty, 0).addScaledVector(camDir, CAM_D)
    camera.lookAt(0, ty, 0)
    camera.updateMatrixWorld()
    const hp = project(tmpA.set(0, FLOOR, -0.92))
    const hz = Math.round((cssH - hp.y) / px)
    post.uniforms.uHorizon.value = hz
    post.uniforms.uWin.value.set(Math.round(w * 0.73), Math.round(hz + 96), 21, 27)
  }
  layout()

  let running = true,
    visible = true,
    last = performance.now(),
    lastDraw = 0,
    first = true,
    hiDirty = false
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
  })
  io.observe(canvas)
  function draw() {
    renderer.setRenderTarget(rt)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    renderer.render(postScene, postCam)
    let any = false
    for (const c of cards.values()) if (c.showHi) any = true
    if (any || hiDirty) {
      hiR.render(hiScene, camera)
      hiDirty = any
    }
  }
  function loop(now: number) {
    if (!running) return
    if (!visible || document.hidden || now - lastDraw < 1000 / 60 - 2) {
      requestAnimationFrame(loop)
      return
    }
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lastDraw = now
    step(dt)
    draw()
    if (first) {
      first = false
      opts.onReady?.()
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  const ro = new ResizeObserver(() => layout())
  ro.observe(host)

  return {
    canvas,
    get px() {
      return px
    },
    set: setMood,
    get mood() {
      return st.mood
    },
    poke,
    gesture: (n: string) => (GEST[n] ? GEST[n]() : Promise.resolve()),
    hop,
    tapKey() {
      st.tapSide ^= 1
      if (st.tapSide) st.tapL = 1
      else st.tapR = 1
    },
    petMove(x: number, y: number, dist: number) {
      const hd = topScreen()
      if (Math.hypot(x - hd.x, y - hd.y - 40) < 120 * (px / 3.5))
        st.pet = Math.min(1.6, st.pet + dist * 0.0028)
    },
    catchNote,
    startRummage,
    stopRummage,
    wake() {
      st.nextIdle = 7 + Math.random() * 6
      hop(1.6)
      play('wake', 0.7, () => {
        pose.eye = 1
      })
    },
    // 登场：从画面上方落下来
    enter() {
      if (reduce) return Promise.resolve()
      st.jump = 2.3
      st.jumpV = -0.6
      return pause(0.9)
    },
    stopAll() {
      for (const a of acts.splice(0)) a.r()
      stopRummage()
    },
    head: topScreen,
    octoHit(x: number, y: number) {
      const hd = headScreen()
      return Math.hypot(x - hd.x, y - hd.y - 10 * px) < 42 * px
    },
    pileHit(x: number, y: number) {
      if (!pile.length) return false
      const pt = project(tmpA.copy(pileAt).setY(FLOOR + 0.05))
      return Math.hypot(x - pt.x, y - pt.y) < 24 * px
    },
    deal,
    takeCard,
    fileCard,
    reopen,
    repile,
    clearHand,
    get handIds() {
      return hand.map((c) => c.id)
    },
    get focusId() {
      return hand[focus]?.id ?? null
    },
    setFocus(i: number) {
      if (hand[i]) focus = i
    },
    focusIndex: () => focus,
    setInspect(v: boolean) {
      inspecting = v
    },
    flip(id: string, back: boolean) {
      const c = cards.get(id)
      if (c) c.flipT = back ? 1 : 0
    },
    punch(id: string) {
      const c = cards.get(id)
      if (c) c.punchV = -2.4
    },
    updateFace(id: string, face: HTMLCanvasElement) {
      const c = cards.get(id)
      if (!c) return
      shrink(face, c.faceLoC)
      c.tex[0].needsUpdate = true
      c.faceSrc = face
      c.tex[2].needsUpdate = true
    },
    // 指针在哪张卡上：返回手牌下标，顺便给焦点卡设倾斜
    hitCard(x: number, y: number) {
      let hit = -1
      let best = Infinity
      hand.forEach((c, i) => {
        if (c.state !== 'rest') return
        const inv = tmpA
        const r = rayAt(x, y)
        // 卡面是平的：先把射线换到卡的局部坐标，再和矩形比
        const nrm = tmpB.set(0, 0, 1).applyQuaternion(c.q)
        const den = r.dot(nrm)
        if (Math.abs(den) < 1e-4) return
        const dist = tmpC.copy(c.pos).sub(camera.position).dot(nrm) / den
        inv
          .copy(camera.position)
          .addScaledVector(r, dist)
          .sub(c.pos)
          .applyQuaternion(qTmp.copy(c.q).invert())
        const inside = Math.abs(inv.x) < CARD_W / 2 && Math.abs(inv.y) < CARD_H / 2
        c.tiltTX = c.tiltTY = 0
        if (inside && dist < best) {
          best = dist
          hit = i
          if (i === focus) {
            c.tiltTY = (inv.x / (CARD_W / 2)) * 0.2
            c.tiltTX = (-inv.y / (CARD_H / 2)) * 0.15
          }
        }
      })
      return hit
    },
    // 卡面局部坐标 0..1，给翻到背面时点来源链接用
    cardRect(id: string) {
      const c = cards.get(id)
      if (!c) return null
      const a = project(
        tmpA
          .set(0, CARD_H / 2, 0)
          .applyQuaternion(c.q)
          .add(c.pos),
      )
      const b = project(
        tmpB
          .set(0, -CARD_H / 2, 0)
          .applyQuaternion(c.q)
          .add(c.pos),
      )
      const l = project(
        tmpB
          .set(-CARD_W / 2, 0, 0)
          .applyQuaternion(c.q)
          .add(c.pos),
      )
      const r = project(
        tmpB
          .set(CARD_W / 2, 0, 0)
          .applyQuaternion(c.q)
          .add(c.pos),
      )
      return { top: a.y, bottom: b.y, left: l.x, right: r.x }
    },
    dim(v: number) {
      st.dimT = v
    },
    setTheme,
    layout,
    stop() {
      running = false
      for (const a of acts.splice(0)) a.r()
      for (const card of [...cards.values()]) dropCard(card)
      for (const tree of [scene, hiScene, postScene])
        tree.traverse((object) => {
          const mesh = object as THREE.Mesh
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) material?.dispose()
        })
      io.disconnect()
      ro.disconnect()
      removeEventListener('pointermove', onMove)
      renderer.dispose()
      hiR.dispose()
      rt.dispose()
      rt.depthTexture?.dispose()
      hiR.forceContextLoss()
      hiR.domElement.remove()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
