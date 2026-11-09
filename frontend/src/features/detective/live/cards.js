// 卡面用 Canvas 2D 画在 240×336 的设计网格上，放大 3 倍成 720×1008 的贴图。
// 字号只用 12、16：乘 3 后是 36、48，正好是 12 格像素字的整数倍，放大后每格边缘是锐的。
// 卡是实物，深色模式下也还是白纸；产品不变量落在这里：每个字段都有来源，核实等级如实写，只有拦人的结论用 danger 色。
import { MARK } from './mark.data.js'
import { defaultLocale, translate } from '@/shared/i18n'

const S = 3,
  W = 240,
  H = 336
const INK = '#101735',
  SOFT = '#303030',
  MUTED = '#6c6c6c',
  RULE = '#dfe2ea',
  PAPER = '#ffffff'
const ACCENT = '#3f5fd6',
  DEEP = '#2f49b8',
  DANGER = '#98434b'
const FONT = (s) => `${s}px FusionPixel, "PingFang SC", sans-serif`
import { loadImage } from './images.js'

function surface() {
  const c = document.createElement('canvas')
  c.width = W * S
  c.height = H * S
  const x = c.getContext('2d')
  x.scale(S, S)
  x.imageSmoothingEnabled = true
  x.textBaseline = 'top'
  return [c, x]
}
// 卡边的墨线：纸面按几何的两级台阶内缩，圆角处的墨线才连续（舞台里台阶 0.012 = 6.5 格）
function frame(x, color = PAPER) {
  x.fillStyle = INK
  x.fillRect(0, 0, W, H)
  const i = 4,
    s = 7,
    r = W - i,
    b = H - i
  const p = [
    [i + 2 * s, i],
    [r - 2 * s, i],
    [r - 2 * s, i + s],
    [r - s, i + s],
    [r - s, i + 2 * s],
    [r, i + 2 * s],
    [r, b - 2 * s],
    [r - s, b - 2 * s],
    [r - s, b - s],
    [r - 2 * s, b - s],
    [r - 2 * s, b],
    [i + 2 * s, b],
    [i + 2 * s, b - s],
    [i + s, b - s],
    [i + s, b - 2 * s],
    [i, b - 2 * s],
    [i, i + 2 * s],
    [i + s, i + 2 * s],
    [i + s, i + s],
    [i + 2 * s, i + s],
  ]
  x.fillStyle = color
  x.beginPath()
  p.forEach(([a, c], k) => (k ? x.lineTo(a, c) : x.moveTo(a, c)))
  x.closePath()
  x.fill()
}
// 按字宽折行，超出行数用省略号收尾
function wrap(x, text, maxW, maxLines) {
  const lines = []
  let cur = ''
  // 拉丁词整词换行，中文逐字
  for (const tok of text.match(/[A-Za-z0-9$,.'’-]+\s*|./gu) ?? []) {
    if (x.measureText((cur + tok).trimEnd()).width > maxW && cur) {
      lines.push(cur.trimEnd())
      cur = tok
    } else cur += tok
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  else if (lines.length === maxLines && [...lines.join('')].length < [...text].length) {
    let l = lines[maxLines - 1]
    while (x.measureText(l + '…').width > maxW) l = l.slice(0, -1)
    lines[maxLines - 1] = l + '…'
  }
  return lines
}
function text(x, s, px, py, size, color) {
  x.font = FONT(size)
  x.fillStyle = color
  x.fillText(s, px, py)
}
function block(x, s, px, py, size, color, maxW, maxLines, lh) {
  x.font = FONT(size)
  x.fillStyle = color
  const ls = wrap(x, s, maxW, maxLines)
  ls.forEach((l, i) => x.fillText(l, px, py + i * lh))
  return py + ls.length * lh
}
// 盖章：方框里两到四个字，歪一点，边缘一格格缺口，像真印
function seal(x, label, color, cx, cy) {
  x.save()
  x.translate(cx, cy)
  x.rotate(-0.2)
  x.font = FONT(16)
  const tw = x.measureText(label).width
  const bw = tw + 16,
    bh = 28
  x.fillStyle = PAPER
  x.fillRect(-bw / 2 - 3, -bh / 2 - 3, bw + 6, bh + 6) // 章常压在封面上，垫一层纸才认得出字
  x.strokeStyle = color
  x.lineWidth = 2
  x.strokeRect(-bw / 2, -bh / 2, bw, bh)
  x.fillStyle = color
  x.textAlign = 'center'
  x.fillText(label, 0, -8)
  x.fillStyle = PAPER
  for (const [a, b] of [
    [-bw / 2 + 8, -bh / 2 - 1],
    [bw / 2 - 18, bh / 2 - 1],
    [bw / 2 - 1, -3],
  ])
    x.fillRect(a, b, 4, 2)
  x.restore()
}

export async function drawContest(c, o = {}) {
  const t = translate.bind(null, o.locale ?? defaultLocale)
  const [cv, x] = surface()
  frame(x)
  // 顶行：核实等级（中性）和剩余天数
  text(x, c.grade, 22, 12, 12, c.conflict ? DANGER : MUTED)
  x.font = FONT(12)
  const left = c.left
  text(x, left, W - 22 - x.measureText(left).width, 12, 12, c.urgent ? ACCENT : SOFT)
  // 封面：真实海报，占卡面上半，颜色都交给它
  const im = await loadImage(c.img)
  x.fillStyle = INK
  x.fillRect(12, 30, W - 24, 128)
  if (im) {
    const bw = W - 28,
      bh = 124,
      r = Math.max(bw / im.width, bh / im.height)
    const sw = bw / r,
      sh = bh / r
    x.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 14, 32, bw, bh)
  }
  let y = block(x, c.name, 14, 166, 16, INK, W - 28, 2, 20) + 4
  if (c.note) y = block(x, c.note, 14, y, 12, ACCENT, W - 28, 2, 16)
  // 字段：标签和值分两栏，分隔靠行距
  const rows = c.rows.slice(0, 3)
  x.font = FONT(12)
  const labelWidth = Math.max(40, ...rows.map(([label]) => x.measureText(label).width + 8))
  let ry = H - 14 - rows.length * 19 - 18
  x.fillStyle = RULE
  x.fillRect(14, ry - 6, W - 28, 1)
  for (const [k, v] of rows) {
    text(x, k, 14, ry, 12, MUTED)
    x.font = FONT(12)
    x.fillStyle = INK
    x.fillText(wrap(x, v, W - 28 - labelWidth, 1)[0] ?? '', 14 + labelWidth, ry)
    ry += 19
  }
  text(x, t('{count} 条来源，翻面看原文', { count: c.sources.length }), 14, H - 27, 12, MUTED)
  if (o.watching) seal(x, t('盯着'), ACCENT, W - 52, 132)
  if (c.blocked) seal(x, c.blocked, DANGER, W - 62, 132)
  return cv
}

export async function drawBack(c, locale = defaultLocale) {
  const t = translate.bind(null, locale)
  const [cv, x] = surface()
  frame(x, ACCENT)
  // 上沿的点阵过渡：蓝一格格落到纸面
  x.fillStyle = DEEP
  for (let i = 4; i < 236; i += 2)
    for (let j = 4; j < 52; j += 2)
      if (((i + j) / 2) % 2 === 0 && j > 4 + (i % 12)) x.fillRect(i, j, 2, 2)
  const mark = await loadImage(MARK)
  if (mark) {
    x.imageSmoothingEnabled = false
    x.drawImage(mark, 14, 14, 28, 28)
    x.imageSmoothingEnabled = true
  }
  text(x, t('来源'), 50, 19, 16, '#ffffff')
  x.fillStyle = PAPER
  x.fillRect(4, 54, W - 8, H - 58)
  const links = []
  let y = 64
  for (const s of c.sources) {
    y = block(x, s.who, 14, y, 12, MUTED, W - 28, 2, 15) + 2
    const q = s.quote
    const end = block(x, q, 14, y, 12, s.old ? MUTED : INK, W - 28, 3, 16)
    if (s.old) {
      x.fillStyle = MUTED
      for (let l = y + 7; l < end; l += 16) x.fillRect(14, l, W - 28, 1)
    }
    y = end + 1
    if (s.url) {
      const label = t('打开原文')
      text(x, label, 14, y, 12, ACCENT)
      const width = x.measureText(label).width
      x.fillStyle = ACCENT
      x.fillRect(14, y + 14, width, 1)
      links.push({ x: 10 / W, y: (y - 2) / H, w: (width + 12) / W, h: 20 / H, url: s.url })
      y += 22
    }
    y += 6
    if (y > H - 76) break
  }
  if (c.verdict) {
    x.fillStyle = RULE
    x.fillRect(14, y, W - 28, 1)
    y += 8
    block(x, c.verdict, 14, y, 12, c.blocked ? DANGER : INK, W - 28, 3, 16)
  }
  text(x, c.checked, 14, H - 26, 12, MUTED)
  cv.links = links
  return cv
}

// 非比赛的卡：登录、连 GitHub。同一副牌背，卡面只有一件事
export async function drawTicket(t) {
  const [cv, x] = surface()
  frame(x)
  x.fillStyle = ACCENT
  x.fillRect(12, 18, W - 24, 112)
  x.fillStyle = DEEP
  for (let i = 12; i < 228; i += 2)
    for (let j = 18; j < 130; j += 2)
      if (((i + j) / 2) % 2 === 0 && j > 70 + ((i * 7) % 26)) x.fillRect(i, j, 2, 2)
  const mark = await loadImage(MARK)
  if (mark) {
    x.imageSmoothingEnabled = false
    x.drawImage(mark, 92, 42, 56, 56)
    x.imageSmoothingEnabled = true
  }
  let y = block(x, t.title, 14, 146, 16, INK, W - 28, 2, 22) + 8
  for (const l of t.lines) {
    y = block(x, l, 14, y, 12, SOFT, W - 28, 3, 17) + 7
  }
  return cv
}
export async function drawTicketBack() {
  const [cv, x] = surface()
  frame(x, ACCENT)
  const mark = await loadImage(MARK)
  if (mark) {
    x.imageSmoothingEnabled = false
    x.drawImage(mark, 78, 126, 84, 84)
  }
  return cv
}
