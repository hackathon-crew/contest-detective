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
import * as THREE from 'three'

const hex = (h: string) =>
  new THREE.Vector3(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  )

// 蓝色一族；每组三档：暗、中、亮。sucker 和 skin 相同，等于不画吸盘
const PAL = {
  skin: ['#2f49b8', '#5878e6', '#8ea8f8'],
  top: ['#2a40a6', '#4d6cdc', '#7f9cf4'],
  sucker: ['#2f49b8', '#5878e6', '#8ea8f8'],
  hi: '#f4f7ff',
  ink: '#101735',
  eye: ['#121a33', '#2a3766'],
  beret: ['#1b1e27', '#363b4a'],
}

export type Mood = 'idle' | 'search' | 'read' | 'think' | 'talk' | 'happy'

export interface OctopusOptions {
  w?: number
  h?: number
  /** 画布在页面上的 CSS 宽度；放大倍数按它取整 */
  cssWidth: number
  mood?: Mood
  /** 书的封面色；read 时捧在手里那本 */
  bookColor?: string
  shadow?: boolean
  onReady?: () => void
}

export interface OctopusHandle {
  canvas: HTMLCanvasElement
  set(m: Mood): void
  poke(): void
  setBook(color: string): void
  resize(cssWidth: number): void
  stop(): void
}

// ---------- 造型 ----------
const ARMS = 8
const SEG = 22 // 每条腕足的节数
const RING = 8 // 管子一圈几个点
const BASE_Y = 0.06
const BASE_R = 0.17

const DITHER = `
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer4(vec2 a){ return bayer2(.5 * a) * .25 + bayer2(a); }`

const SKIN_VERT = `
attribute float aS; attribute float aSuck; attribute float aTop;
varying vec3 vN; varying vec3 vP; varying float vS; varying float vSuck; varying float vTop;
void main(){
  vN = normalize(normalMatrix * normal); vP = position; vS = aS; vSuck = aSuck; vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`

const SKIN_FRAG = `
uniform vec3 uL;
uniform vec3 k0, k1, k2, t0, t1, t2, c0, c1, c2, cHi;
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
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform vec3 uInk; uniform vec2 uShadowOff; uniform vec4 uShadowCol; uniform float uEdge;
varying vec2 vUv;
float A(vec2 o){ return texture2D(tColor, vUv + o / uRes).a; }
float D(vec2 o){ return texture2D(tDepth, vUv + o / uRes).x; }
void main(){
  vec4 c = texture2D(tColor, vUv);
  vec2 p = floor(vUv * uRes);
  if (c.a < .5) {
    float n = max(max(A(vec2(1., 0.)), A(vec2(-1., 0.))), max(A(vec2(0., 1.)), A(vec2(0., -1.))));
    if (n > .5) { gl_FragColor = vec4(uInk, 1.); return; }
    if (uShadowCol.a > 0. && A(-uShadowOff) > .5 && mod(p.x + p.y, 2.) < .5) { gl_FragColor = uShadowCol; return; }
    gl_FragColor = vec4(0.); return;
  }
  float d = D(vec2(0.));
  float dn = min(min(D(vec2(1., 0.)), D(vec2(-1., 0.))), min(D(vec2(0., 1.)), D(vec2(0., -1.))));
  if (d - dn > uEdge) c.rgb = mix(c.rgb, uInk, .8);
  gl_FragColor = vec4(c.rgb, 1.);
}`

function mantleGeometry() {
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

interface Arm {
  angle: number
  phase: number
  len: number
  geo: THREE.BufferGeometry
  tip: THREE.Vector3
  pts: THREE.Vector3[]
}

function armGeometry() {
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

export function mountOctopus(host: HTMLElement, opts: OctopusOptions): OctopusHandle | null {
  const w = opts.w ?? 120,
    h = opts.h ?? 120
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    })
  } catch {
    return null
  }
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.className = 'octo-canvas'
  canvas.style.imageRendering = 'pixelated'
  host.appendChild(canvas)

  // 放大倍数只取“乘上设备像素比是整数”的值，放大后每格边缘是锐的
  const dpr = Math.max(1, Math.round(devicePixelRatio || 1))
  const resize = (cssWidth: number) => {
    const px = Math.max(1, Math.round((cssWidth / w) * dpr) / dpr)
    canvas.style.width = w * px + 'px'
    canvas.style.height = h * px + 'px'
  }
  resize(opts.cssWidth)

  const FH = 1.2,
    FW = (FH * w) / h,
    WPX = FH / h
  const camera = new THREE.OrthographicCamera(-FW / 2, FW / 2, FH / 2, -FH / 2, 0.1, 10)
  camera.position.set(0, 0.62, 2.2)
  camera.lookAt(0, 0.05, 0)
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
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(w, h),
  })
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
      uShadowOff: { value: new THREE.Vector2(3, -5) },
      uShadowCol: { value: new THREE.Vector4(0.02, 0.03, 0.06, opts.shadow === false ? 0 : 0.32) },
      uEdge: { value: 0.006 },
    },
  })
  const postScene = new THREE.Scene()
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post))
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // ---------- 动作 ----------
  type Coef = { amp: number; w: number; curl: number; sway: number; dip: number; bob: number }
  const MOOD: Record<Mood, Coef> = {
    idle: { amp: 0.6, w: 1.5, curl: 1.55, sway: 0.24, dip: -0.82, bob: 0.024 },
    search: { amp: 0.45, w: 1.3, curl: 1.5, sway: 0.2, dip: -0.82, bob: 0.018 },
    read: { amp: 0.35, w: 1.1, curl: 1.55, sway: 0.16, dip: -0.82, bob: 0.012 },
    talk: { amp: 0.75, w: 2.4, curl: 1.5, sway: 0.28, dip: -0.78, bob: 0.03 },
    think: { amp: 0.35, w: 3.6, curl: 2.3, sway: 0.12, dip: -0.95, bob: 0.014 },
    happy: { amp: 1.1, w: 4.2, curl: 1.0, sway: 0.35, dip: -0.5, bob: 0.05 },
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
  function buildArm(arm: Arm, t: number, grip: Grip | null) {
    const base = arm.angle
    let theta = cur.dip * 0.5
    const ds = arm.len / SEG
    P.set(Math.sin(base) * BASE_R, BASE_Y, Math.cos(base) * BASE_R)
    for (let j = 0; j <= SEG; j++) {
      const s = j / SEG
      const ang = base + cur.sway * s * Math.sin(cur.w * 0.7 * t + arm.phase * 1.7 + 3 * s)
      o.set(Math.sin(ang), 0, Math.cos(ang))
      d.copy(o).multiplyScalar(Math.cos(theta)).addScaledVector(up, Math.sin(theta))
      arm.pts[j].copy(P)
      theta +=
        0.45 *
        (cur.curl * Math.pow(s, 1.3) * 5.2 +
          cur.amp * (0.35 + s) * Math.sin(cur.w * t - 5.5 * s + arm.phase)) *
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
    const k = 1 - Math.exp(-dt * 2.5)
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
    hat.position.y = 0.48 + 0.012 * fix

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
      const r = canvas.getBoundingClientRect()
      const dx = (pointer.x - (r.left + r.width / 2)) / Math.max(200, r.width)
      const dy = (pointer.y - (r.top + r.height * 0.4)) / Math.max(200, r.height)
      const w = st.book > 0.5 || st.mag > 0.5 ? 0.5 : 1
      yawT += (Math.max(-0.6, Math.min(0.6, dx * 0.9)) - yawT) * w
      pitchT += (Math.max(-0.25, Math.min(0.3, dy * 0.35)) - pitchT) * w
      look.set(Math.max(-1, Math.min(1, dx * 1.6)), Math.max(-1, Math.min(1, -dy * 1.6)))
    }
    if (st.mood === 'think') look.set(0.7, 0.8)
    // 转头用临界阻尼的弹簧：跟得上，但不回弹
    st.yawV += (24 * (yawT - st.yaw) - 2 * Math.sqrt(24) * st.yawV) * dt
    st.yaw += st.yawV * dt
    st.pitchV += (16 * (pitchT - st.pitch) - 8 * st.pitchV) * dt
    st.pitch += st.pitchV * dt

    // 戳一下：往上弹，落回来
    st.jumpV += (-60 * st.jump - 7 * st.jumpV) * dt
    st.jump += st.jumpV * dt

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
    for (let i = 0; i < ARMS; i++)
      buildArm(arms[i], t, i === 7 ? bookGripL : i === 0 ? rightGrip : i === 6 ? hatGrip : null)

    // 呼吸
    const breathe = 1 + 0.025 * Math.sin(t * (st.mood === 'talk' ? 5 : 1.6))
    mantle.scale.set(breathe, 1 / Math.sqrt(breathe), breathe)

    // 眨眼
    st.nextBlink -= dt
    if (st.nextBlink < 0) {
      st.blink = 0.14
      st.nextBlink = 2.5 + Math.random() * 4
    }
    st.blink = Math.max(0, st.blink - dt)
    const lid = st.blink > 0 ? 0.12 : 1
    for (const e of eyes) {
      e.g.scale.y = lid
      e.pupil.position.x = 0.005 * look.x
      e.pupil.position.y = 0.004 * look.y
    }

    body.rotation.set(st.pitch, st.yaw, -st.yawV * 0.05)
    const bob = cur.bob * Math.sin(t * 1.25) + st.jump
    body.position.y = Math.round(bob / WPX) * WPX
  }

  let running = true,
    visible = true,
    last = performance.now(),
    lastDraw = 0,
    first = true
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
  })
  io.observe(canvas)
  function loop(now: number) {
    if (!running) return
    requestAnimationFrame(loop)
    if (!visible || document.hidden || now - lastDraw < 1000 / 60 - 2) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lastDraw = now
    step(dt)
    renderer.setRenderTarget(rt)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(postScene, postCam)
    if (first) {
      first = false
      opts.onReady?.()
    }
  }
  requestAnimationFrame(loop)

  return {
    canvas,
    set(m) {
      st.mood = m
    },
    poke() {
      st.jumpV += 1.6
    },
    setBook(color) {
      coverMat.uniforms.cA.value = hex(darken(color, 0.62))
      coverMat.uniforms.cB.value = hex(color)
    },
    resize,
    stop() {
      running = false
      io.disconnect()
      removeEventListener('pointermove', onMove)
      renderer.dispose()
      rt.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
