// 已确认 Live 原型的编排；数据、权限和持久化由页面提供。
import { translate, translateSystemText } from '@/shared/i18n'
import { mountStage } from '@/shared/ui/octopus/live-stage'
import { drawContest, drawBack, drawTicket, drawTicketBack } from './cards.js'
import { speechLines, turnMood } from './model'
import hatFrame from '@/shared/assets/mascot/octo-hat.png'
import searchFrame from '@/shared/assets/mascot/octo-search.png'
import readFrame from '@/shared/assets/mascot/octo-read.png'
import happyFrame from '@/shared/assets/mascot/octo-happy.png'
import peerFrame from '@/shared/assets/mascot/octo-peer.png'
const FIRST_CHIPS = ['两周内截止、线上能参加的 AI 比赛']
import { makeSound } from './sound.js'

export function mountLive(root, callbacks, initial) {
  let disposed = false
  let snapshot = initial
  let renderedLocale
  const t = (message, values) => translate(snapshot.locale, message, values)
  const systemText = (text) => translateSystemText(snapshot.locale, text)
  const frames = new Set(),
    timers = new Set(),
    intervals = new Set()
  const globalEvents = new AbortController()
  const requestAnimationFrame = (fn) => {
    const id = window.requestAnimationFrame((time) => {
      frames.delete(id)
      if (!disposed) fn(time)
    })
    frames.add(id)
    return id
  }
  const setTimeout = (fn, ms) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      if (!disposed) fn()
    }, ms)
    timers.add(id)
    return id
  }
  const setInterval = (fn, ms) => {
    const id = window.setInterval(fn, ms)
    intervals.add(id)
    return id
  }
  const on = (target, name, fn, options = {}) =>
    target.addEventListener(name, fn, { ...options, signal: globalEvents.signal })
  const addEventListener = (name, fn) => on(window, name, fn)
  const $ = (s) => root.querySelector(s)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const phone = () => innerWidth <= 760
  const store = {
    get(k) {
      try {
        return localStorage.getItem('inkpaw-live:' + k)
      } catch {
        return null
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('inkpaw-live:' + k, v)
      } catch {}
    },
  }
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    )
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  const plain = (s) => s.replace(/\*\*/g, '')
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 30) : ms))

  // ---- 主题和字号 ----
  const savedTheme = store.get('theme')
  let dark = savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches

  root.dataset.theme = dark ? 'dark' : 'light'
  const dpr = devicePixelRatio || 1
  const applyFs = () =>
    root.style.setProperty('--fs', dpr >= 2 ? '18px' : phone() ? '12px' : '24px')
  applyFs()

  // ---- 舞台 ----
  const sound = makeSound()
  const host = $('#stage')
  // 牌停在哪：多张时在画面下半、八爪鱼从牌顶探头；桌面单张放到它右手边，两边都看得见
  const cardRest = () => {
    const W = innerWidth,
      H = innerHeight
    const inspectH = phone() ? Math.min(H * 0.62, (W - 40) * 1.4) : Math.min(H * 0.74, 640)
    const base = { inspectH, inspectX: W / 2, inspectY: phone() ? H * 0.44 : H * 0.45 }
    if (phone()) {
      const h = Math.min(H * 0.46, (W - 84) * 1.4)
      return { ...base, cx: W / 2, cy: H - 152 - h / 2, h, gap: W * 0.74, carousel: true }
    }
    if (stage.handIds.length > 1) {
      const h = Math.min(H * 0.47, 440, ((W - 120) / 3) * 1.4 * 1.1)
      return {
        ...base,
        cx: W / 2,
        cy: H - 168 - h / 2,
        h,
        gap: Math.min(h * 0.78, (W - 80) / 3),
        carousel: stage.handIds.length > 3,
      }
    }
    const h = Math.min(H * 0.6, 540)
    return {
      ...base,
      cx: Math.min(W - h * 0.42, W / 2 + Math.max(250, W * 0.235)),
      cy: Math.max(72 + h / 2, H * 0.46),
      h,
      gap: 0,
    }
  }
  const realStage = mountStage(host, {
    reduce,
    dark,
    mood: 'idle',
    focusY: () => (phone() ? { rest: 0.4, lift: 0.27 } : { rest: 0.46, lift: 0.28 }),
    liftOne: () => phone(),
    cardRest: () => cardRest(),
    onReady: () => boot(),
  })
  const stage = realStage ?? stillStage()
  function syncUnit() {
    root.style.setProperty('--u', Math.max(2, Math.round(stage.px)) + 'px')
  }
  syncUnit()
  addEventListener('resize', () => {
    applyFs()
    syncUnit()
  })

  // WebGL 不可用时：换成现成的静态八爪鱼，卡片用同一张 Canvas 卡面直接摆出来，所有流程照常走完
  function stillStage() {
    const im = new Image()
    im.className = 'still'
    im.alt = ''
    im.src = hatFrame
    host.appendChild(im)
    const pic = {
      search: searchFrame,
      read: readFrame,
      think: peerFrame,
      happy: happyFrame,
      talk: happyFrame,
    }
    let hand = [],
      focus = 0
    const noop = () => {}
    const shown = (c) => {
      host.querySelectorAll('.still-card').forEach((n) => n.remove())
      if (!c) return
      c.className = 'still-card'
      Object.assign(
        c.style,
        phone()
          ? {
              position: 'absolute',
              left: '50%',
              top: '60%',
              height: '46vh',
              width: 'auto',
              transform: 'translate(-50%,-50%)',
            }
          : {
              position: 'absolute',
              left: '68%',
              top: '46%',
              height: '60vh',
              width: 'auto',
              transform: 'translate(-50%,-50%)',
            },
      )
      host.appendChild(c)
    }
    setTimeout(() => boot(), 0)
    return {
      px: 3,
      handIds: [],
      focusId: null,
      mood: 'idle',
      set(m) {
        this.mood = m
        im.src = pic[m] ?? hatFrame
      },
      poke: () => 1,
      gesture: async () => {},
      hop: noop,
      tapKey: noop,
      petMove: noop,
      catchNote: async () => {},
      startRummage: noop,
      stopRummage: noop,
      wake: noop,
      enter: async () => {},
      stopAll: noop,
      head: () =>
        phone()
          ? { x: innerWidth / 2, y: innerHeight * 0.2 }
          : { x: innerWidth * 0.3, y: innerHeight * 0.26 },
      octoHit: () => false,
      pileHit: () => false,
      async deal(l) {
        hand = l
        focus = 0
        this.handIds = l.map((c) => c.id)
        this.focusId = hand[0].id
        shown(hand[0].face)
      },
      async takeCard(id) {
        hand = hand.filter((c) => c.id !== id)
        this.handIds = hand.map((c) => c.id)
        this.focusId = hand[0]?.id ?? null
        shown(hand[0]?.face)
      },
      async fileCard(id) {
        return this.takeCard(id)
      },
      async reopen(id, sp) {
        hand = [sp]
        this.handIds = [id]
        this.focusId = id
        shown(sp.face)
      },
      async repile(id) {
        return this.takeCard(id)
      },
      clearHand() {
        hand = []
        this.handIds = []
        this.focusId = null
        shown()
      },
      setFocus(i) {
        if (!hand[i]) return
        focus = i
        this.focusId = hand[i].id
        shown(hand[i].face)
      },
      focusIndex: () => focus,
      setInspect: noop,
      flip(id, b) {
        const c = hand.find((x) => x.id === id)
        if (c) shown(b ? c.back : c.face)
      },
      punch: noop,
      updateFace(id, face, reverse) {
        const card = hand.find((item) => item.id === id)
        if (!card) return
        card.face = face
        if (reverse) card.back = reverse
        if (this.focusId === id) shown(back ? card.back : card.face)
      },
      hitCard: () => -1,
      cardRect: () => {
        const c = host.querySelector('.still-card')?.getBoundingClientRect()
        return c ? { top: c.top, bottom: c.bottom, left: c.left, right: c.right } : null
      },
      dim: noop,
      setTheme: noop,
      stop() {
        im.remove()
        host.querySelectorAll('.still-card').forEach((node) => node.remove())
      },
    }
  }

  // ---- 气泡 ----
  const bubble = $('#bubble'),
    btext = $('#btext'),
    live = $('#live')
  let sayToken = 0,
    typing = null,
    bx = null,
    by = null,
    bAt = 0
  function placeBubble() {
    requestAnimationFrame(placeBubble)
    if (!bubble.classList.contains('show')) return
    const u = Math.max(1, stage.px)
    const hd = stage.head()
    const r = bubble.getBoundingClientRect()
    const W = innerWidth
    const top = phone() ? 60 : 72
    let x, y, tx
    if (phone()) {
      x = Math.max(16, Math.min(W - r.width - 16, hd.x - r.width / 2))
      y = Math.max(top, hd.y - r.height - 16)
      tx = hd.x - x - 8
    } else {
      // 手上有卡时卡占右边，气泡就让到左边
      const left = stage.handIds.length === 1 && !inspect
      x = left ? hd.x - r.width - 30 : hd.x + 26
      y = Math.max(top, hd.y - r.height + 8)
      x = Math.max(16, Math.min(W - r.width - 16, x))
      tx = left ? r.width - 40 : 26
    }
    // 气泡跟着头走但慢半拍：头一动它就抖、打字变宽它就蹦都很假，低通之后再吸附到像素格
    const now = performance.now()
    const kf = bx === null || reduce ? 1 : 1 - Math.exp((-(now - bAt) / 1000) * 11)
    bAt = now
    bx = bx === null ? x : bx + (x - bx) * kf
    by = by === null ? y : by + (y - by) * kf
    bubble.style.transform = `translate(${Math.round(bx / u) * u}px, ${Math.round(by / u) * u}px)`
    bubble.style.setProperty('--tx', Math.max(12, Math.min(r.width - 28, tx)) + 'px')
  }
  requestAnimationFrame(placeBubble)
  function showBubble() {
    if (!bubble.classList.contains('show')) {
      bubble.classList.remove('pop')
      void bubble.offsetWidth
      bubble.classList.add('show', 'pop')
      sound.pop()
    }
  }
  const hideBubble = () => {
    bubble.classList.remove('show', 'has-more')
    bx = by = null
  }

  // 打字机：逐字出现。点气泡或按空格先补全这一句，再点翻下一句；不点也会按阅读时长自己翻
  async function say(lines, { log = true, keep = true } = {}) {
    const token = ++sayToken
    lines = [].concat(lines)
    if (log) lines.forEach((l) => addLog('it', l))
    live.textContent = plain(lines.join(' '))
    for (let i = 0; i < lines.length; i++) {
      if (token !== sayToken) return
      showBubble()
      await typeLine(lines[i], token)
      if (token !== sayToken) return
      if (i < lines.length - 1) {
        bubble.classList.add('has-more')
        await readPause(Math.min(2600, 900 + plain(lines[i]).length * 45), token)
        bubble.classList.remove('has-more')
      }
    }
    if (!keep && token === sayToken) {
      await wait(2400)
      if (token === sayToken) hideBubble()
    }
  }
  function typeLine(line, token) {
    const chars = [...plain(line)]
    return new Promise((res) => {
      let i = 0,
        done = false,
        tm = 0
      const full = () => {
        btext.innerHTML = rich(line)
      }
      const finish = () => {
        if (done) return
        done = true
        typing = null
        clearInterval(tm)
        full()
        res()
      }
      typing = finish
      if (reduce) return finish()
      btext.textContent = ''
      tm = setInterval(() => {
        if (token !== sayToken) {
          done = true
          clearInterval(tm)
          res()
          return
        }
        i += 1
        btext.textContent = chars.slice(0, i).join('')
        if (i % 2) sound.blip()
        if (stage.mood === 'talk' && i % 6 === 0 && Math.random() < 0.3) stage.tapKey()
        if (i >= chars.length) finish()
      }, 34)
    })
  }
  let skipRead = null
  function readPause(ms, token) {
    return new Promise((res) => {
      const t = setTimeout(end, reduce ? 60 : ms)
      function end() {
        clearTimeout(t)
        skipRead = null
        res()
      }
      skipRead = end
      void token
    })
  }
  function advance() {
    if (typing) typing()
    else if (skipRead) skipRead()
  }
  on(bubble, 'click', advance)
  on(bubble, 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      advance()
    }
  })
  function sayStep(line) {
    sayToken++
    typing = null
    showBubble()
    btext.innerHTML = `${esc(line)}<span class="dots"><i></i><i></i><i></i></span>`
    live.textContent = line
  }

  // ---- 记录 ----
  const addLog = () => {}
  const logBtn = $('#b-log'),
    logEl = $('#log')
  function openLog(v) {
    logEl.classList.toggle('open', v)
    logBtn.setAttribute('aria-expanded', v)
    if (v) $('#log-x').focus()
  }
  logBtn.onclick = () => openLog(!logEl.classList.contains('open'))
  $('#log-x').onclick = () => {
    openLog(false)
    logBtn.focus()
  }

  // ---- 建议问题 ----
  const chips = $('#chips')
  function setChips(list) {
    chips.innerHTML = ''
    list.slice(0, phone() ? 6 : 4).forEach((t, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn chip'
      b.textContent = systemText(t)
      b.style.animationDelay = i * 50 + 'ms'
      b.onclick = () => ask(b.textContent)
      chips.appendChild(b)
    })
    chips.classList.remove('off')
  }
  const hideChips = () => chips.classList.add('off')

  // ---- 手牌操作 ----
  const acts = $('#acts')
  const album = new Map() // 收下的卡
  const specs = new Map() // id → 卡面数据
  const watching = new Set()
  let inspect = false,
    back = false
  let loggedIn = initial.loggedIn
  let left = initial.remaining ?? Infinity
  let pendingWatch = null

  function drawCard(c, locale) {
    return Promise.all([
      drawContest(c, { watching: watching.has(c.id), locale }),
      drawBack(c, locale),
    ])
  }
  async function makeSpec(c) {
    const locale = snapshot.locale
    const [face, backC] = await drawCard(c, locale)
    if (snapshot.locale !== locale) {
      const latest = [...snapshot.cards, ...snapshot.album, ...snapshot.historyCards].find(
        (card) => card.id === c.id,
      )
      return makeSpec(latest ?? c)
    }
    const sp = { id: c.id, kind: 'contest', data: c, face, back: backC }
    specs.set(c.id, sp)
    return sp
  }
  function ticketFace(ticket) {
    return drawTicket({
      ...ticket,
      title: t(ticket.title),
      lines: ticket.lines.map((line) => t(line)),
    })
  }
  async function makeTicket(data) {
    const locale = snapshot.locale
    const [face, reverse] = await Promise.all([ticketFace(data), drawTicketBack()])
    if (snapshot.locale !== locale) return makeTicket(data)
    const sp = {
      id: data.id,
      kind: 'ticket',
      data,
      face,
      back: reverse,
    }
    specs.set(data.id, sp)
    return sp
  }
  async function redrawCards(next) {
    const locale = next.locale
    const cards = new Map(
      [...next.historyCards, ...next.album, ...next.cards].map((card) => [card.id, card]),
    )
    const visible = new Set([...specs.values(), ...album.values()])
    await Promise.all(
      [...visible].map(async (spec) => {
        const data = spec.kind === 'ticket' ? spec.data : cards.get(spec.id)
        if (!data) return
        const [face, reverse] =
          spec.kind === 'ticket'
            ? [await ticketFace(data), spec.back]
            : await drawCard(data, locale)
        if (disposed || snapshot.locale !== locale) return
        Object.assign(spec, { data, face, back: reverse })
        if (specs.get(spec.id) === spec) stage.updateFace(spec.id, face, reverse)
      }),
    )
    if (disposed || snapshot.locale !== locale) return
    renderActs()
    if (albumEl.classList.contains('open')) renderAlbum()
  }
  function button(label, fn, cls = '') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn ' + cls
    b.textContent = label
    b.onclick = fn
    return b
  }
  function renderActs() {
    acts.innerHTML = ''
    const id = stage.focusId
    const sp = id && specs.get(id)
    if (!sp) {
      acts.classList.remove('show')
      return
    }
    if (sp.kind === 'ticket') {
      acts.append(
        button(t(sp.data.yes), sp.data.onYes, 'primary'),
        button(t(sp.data.no), sp.data.onNo),
      )
    } else {
      const has = album.has(id)
      if (inspect && has) acts.append(button(t('放回卡册'), closeInspect, 'primary'))
      else acts.append(button(t('收下'), () => take(id), 'primary'))
      acts.append(button(t(back ? '看正面' : '翻面'), toggleFlip))
      if (!sp.data.blocked)
        acts.append(
          button(
            t(watching.has(id) ? '已盯着' : '帮我盯着'),
            () => watch(id),
            watching.has(id) ? 'on' : '',
          ),
        )
      if (!has) acts.append(button(t('放回'), () => file(id)))
      if (stage.handIds.length > 1) acts.append(button(t('全部收下'), takeAll))
    }
    if (back && sp.kind === 'contest') {
      const links = document.createElement('div')
      links.className = 'live-source-links'
      links.setAttribute('aria-label', t('卡背来源'))
      for (const source of sp.data.sources) {
        const link = document.createElement('a')
        link.href = source.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = source.who
        links.appendChild(link)
      }
      acts.appendChild(links)
    }
    acts.classList.add('show')
  }
  function placeActs() {
    requestAnimationFrame(placeActs)
    if (!acts.classList.contains('show')) return
    const r = stage.focusId && stage.cardRect(stage.focusId)
    if (!r) return
    const w = acts.offsetWidth,
      h = acts.offsetHeight
    const cx = (r.left + r.right) / 2
    const maxTop = innerHeight - h - (inspect ? 16 : 96)
    acts.style.transform = `translate(${Math.round(Math.max(12, Math.min(innerWidth - w - 12, cx - w / 2)))}px, ${Math.round(Math.min(maxTop, r.bottom + 16))}px)`
  }
  requestAnimationFrame(placeActs)
  function setInspect(v) {
    inspect = v
    stage.setInspect(v)
    stage.dim(v ? 0.5 : 0)
    $('#dock').style.visibility = v ? 'hidden' : ''
    if (v) hideBubble()
    renderActs()
  }
  function toggleFlip() {
    const id = stage.focusId
    if (!id) return
    back = !back
    stage.flip(id, back)
    sound.flip()
    renderActs()
  }
  async function take(id) {
    const sp = specs.get(id)
    if (!sp) return
    album.set(id, sp)
    callbacks.collect(sp.data.contest)
    back = false
    if (inspect) setInspect(false)
    sound.whoosh()
    addLog('card', sp.data.name, id)
    const p = stage.takeCard(id)
    renderActs()
    $('#count').hidden = false
    $('#count').textContent = album.size
    stage.gesture('nod')
    await p
    afterHand()
  }
  async function takeAll() {
    for (const id of [...stage.handIds]) {
      await take(id)
      await wait(140)
    }
  }
  async function file(id) {
    back = false
    if (inspect) setInspect(false)
    specs.delete(id)
    sound.whoosh()
    const p = stage.fileCard(id)
    renderActs()
    await p
    afterHand()
  }
  async function afterHand() {
    if (stage.handIds.length) {
      stage.setFocus(Math.min(stage.focusIndex(), stage.handIds.length - 1))
      renderActs()
      return
    }
    renderActs()
    if (phase !== 'hand') return
    phase = 'idle'
    stage.set('idle')
    armIdle()
    if (album.size && !nudged) {
      nudged = true
      say(t('收好了，都在右边那一摞里。'))
    } else say(t('还想查什么。'), { log: false })
    setChips(nextChips.length ? nextChips : FIRST_CHIPS)
  }
  let nudged = false
  async function watch(id) {
    if (watching.has(id)) return
    if (!loggedIn) {
      pendingWatch = id
      return dealLogin(t('要帮你盯着，我得知道该给谁发邮件。'))
    }
    const sp = specs.get(id)
    if (!(await callbacks.watch(id))) return
    watching.add(id)
    sp.face = await drawContest(sp.data, { watching: true, locale: snapshot.locale })
    if (disposed) return
    stage.updateFace(id, sp.face)
    stage.punch(id)
    sound.stamp()
    stage.hop(1.4)
    say(t('盯上了。截止有变，我发邮件给你。'), { log: false })
    renderActs()
  }
  async function dealLogin(line) {
    for (const id of [...stage.handIds]) {
      const sp = specs.get(id)
      if (sp?.kind === 'contest') {
        album.set(id, sp)
        callbacks.collect(sp.data.contest)
        stage.takeCard(id)
      }
    }
    $('#count').hidden = !album.size
    $('#count').textContent = album.size
    if (inspect) setInspect(false)
    phase = 'hand'
    setBusy(false)
    stage.set('hold')
    say(line, { log: false })
    const sp = await makeTicket({
      id: 'login',
      title: '登录 Inkpaw',
      lines: ['登录后提问不限次数，这次的卡和记录都会保存。'],
      yes: '登录',
      no: '先不用',
      onYes: () => callbacks.login(pendingWatch),
      onNo: async () => {
        callbacks.dismissTicket()
        pendingWatch = null
        await dropTicket('login')
        say(t('好，这次的记录先留在这台设备上。'), { log: false })
      },
    })
    if (disposed) return
    await stage.deal([sp])
    renderActs()
  }
  async function dealProfile() {
    phase = 'hand'
    setBusy(false)
    stage.set('hold')
    say(t('我得先看看你做过什么。'), { log: false })
    const sp = await makeTicket({
      id: 'profile',
      title: '连接你的 GitHub',
      lines: ['只读公开仓库，用来判断你适合什么比赛。', '也可以导入简历或填写画像。'],
      yes: '连接 GitHub',
      no: '先不用',
      onYes: () => callbacks.profile('github'),
      onNo: async () => {
        callbacks.dismissTicket()
        await dropTicket('profile')
        say(t('好。告诉我你写什么语言、想做什么方向，也能挑。'), { log: false })
      },
    })
    if (disposed) return
    await stage.deal([sp])
    renderActs()
  }
  async function dropTicket(id) {
    specs.delete(id)
    const p = stage.fileCard(id)
    renderActs()
    await p
    phase = 'idle'
    stage.set('idle')
    setChips(nextChips.length ? nextChips : FIRST_CHIPS)
  }
  async function reopenCard(id, data) {
    const sp = specs.get(id) ?? album.get(id) ?? (data ? await makeSpec(data) : null)
    if (!sp) return
    specs.set(id, sp)
    closeAlbum()
    back = false
    phase = 'inspect'
    await stage.reopen(id, sp)
    setInspect(true)
  }
  async function closeInspect() {
    const id = stage.focusId
    back = false
    if (id) stage.flip(id, false)
    if (album.has(id)) {
      setInspect(false)
      stage.dim(0)
      await stage.repile(id)
      phase = 'idle'
      renderActs()
    } else setInspect(false)
  }

  // ---- 卡册 ----
  const albumEl = $('#album'),
    grid = $('#grid')
  function renderAlbum() {
    grid.innerHTML = ''
    if (!album.size) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = t('还没有收下的卡。问它一场比赛，递过来的卡收下就在这里。')
      grid.appendChild(empty)
    }
    for (const [id, sp] of album) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'thumb'
      b.setAttribute('aria-label', sp.data.name)
      const c = document.createElement('canvas')
      c.width = 360
      c.height = 504
      c.getContext('2d').drawImage(sp.face, 0, 0, 360, 504)
      b.appendChild(c)
      b.onclick = () => reopenCard(id)
      grid.appendChild(b)
    }
  }
  function openAlbum() {
    renderAlbum()
    albumEl.classList.add('open')
    $('#album-x').focus()
  }
  function closeAlbum() {
    albumEl.classList.remove('open')
  }
  $('#b-album').onclick = openAlbum
  $('#album-x').onclick = () => {
    closeAlbum()
    $('#b-album').focus()
  }
  on(albumEl, 'click', (e) => {
    if (e.target === albumEl) closeAlbum()
  })

  // ---- 对话回合 ----
  let phase = 'idle' // idle 等人说话 | busy 在查 | hand 手上有牌 | inspect 细看
  let turn = 0
  let nextChips = []
  const trail = $('#trail')
  const SEND =
    '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M4 1h2v1h1v1h1v1h1v1H6v4H4V5H1V4h1V3h1V2h1z"/></svg>'
  const STOP = '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 2h6v6H2z"/></svg>'
  const sendBtn = $('#send'),
    q = $('#q')
  sendBtn.innerHTML = SEND
  function setBusy(v) {
    sendBtn.innerHTML = v ? STOP : SEND
    sendBtn.setAttribute('aria-label', t(v ? '让它停下' : '发送'))
    sendBtn.disabled = v ? false : !q.value.trim()
  }
  function renderQuota() {
    const el = $('#quota')
    const show = !loggedIn && left <= 2
    el.hidden = !show
    if (show)
      el.textContent = left > 0 ? t('今天还能问 {count} 次', { count: left }) : t('今天问完了')
  }
  const alive = (t) => !disposed && t === turn

  async function ask(text) {
    text = text.trim()
    if (!text || disposed) return
    clearTimers()
    for (const id of [...stage.handIds]) {
      const sp = specs.get(id)
      if (sp?.kind === 'contest') {
        album.set(id, sp)
        callbacks.collect(sp.data.contest)
        stage.takeCard(id)
      } else {
        specs.delete(id)
        stage.fileCard(id)
      }
    }
    renderActs()
    $('#count').hidden = !album.size
    $('#count').textContent = album.size
    if (inspect) setInspect(false)
    ++turn
    phase = 'busy'
    q.value = ''
    hideChips()
    hideBubble()
    setBusy(true)
    trail.innerHTML = ''
    trail.classList.remove('fade')
    stage.set('think')
    const r = $('#ask').getBoundingClientRect()
    sound.whoosh()
    void stage.catchNote(r.left + r.width / 2, r.top)
    callbacks.submit(text)
  }
  let shownId = null,
    shownStatus = null,
    shownTrace = 0,
    spoken = '',
    ticket = null
  async function showResult(result, cards, token) {
    const list = cards
    if (list.length) {
      stage.set('hold')
      await stage.gesture('eureka')
      if (!alive(token) || disposed) return
      stage.set('rummage')
      stage.startRummage(1)
      sayStep(t('我拿给你'))
      const ready = await Promise.all(list.map(makeSpec))
      if (!alive(token) || disposed) return
      stage.set('hold')
      sound.whoosh()
      trail.classList.add('fade')
      await stage.deal(ready)
      if (!alive(token) || disposed) return
      sound.card()
      phase = 'hand'
      setBusy(false)
      renderActs()
      if (list.some((card) => card.blocked)) {
        stage.set('warn')
        stage.gesture('shake')
      } else if (list.some((card) => card.conflict)) {
        stage.set('think')
        stage.gesture('chin')
      } else stage.gesture('nod')
    } else {
      finishTurn()
      const mood = turnMood(result)
      stage.set(mood)
      if (mood === 'warn') stage.gesture('shake')
      else if (mood === 'sad') stage.gesture('shrug')
    }
    const lines = speechLines(result.content)
    if (lines.length) void say(lines, { log: false })
    if (result.status === 'error' || result.action || result.status === 'stopped') {
      stage.set('think')
      stage.gesture('shrug')
      openLog(true)
      if (!lines.length)
        void say(
          result.error ? systemText(result.error) : t('已经找到的内容留在记录里，可以接着查。'),
          { log: false },
        )
    }
  }
  function update(next) {
    if (disposed) return
    for (const link of root.querySelectorAll('a.logo, nav a')) link.href = next.textHref
    snapshot = next
    loggedIn = next.loggedIn
    left = next.remaining ?? Infinity
    renderQuota()
    watching.clear()
    next.watching.forEach((id) => watching.add(id))
    if (renderedLocale !== next.locale) {
      const previous = renderedLocale
      renderedLocale = next.locale
      paintCopy()
      if (previous) void redrawCards(next)
    }
    for (const card of next.album) {
      if (album.has(card.id)) continue
      void makeSpec(card).then((sp) => {
        if (disposed) return
        album.set(card.id, sp)
        $('#count').hidden = !album.size
        $('#count').textContent = album.size
      })
    }
    const current = next.turn
    if (next.ticket && ticket !== next.ticket) {
      ticket = next.ticket
      if (ticket === 'login') void dealLogin(t('今天的 3 次问完了。登录之后不限次数。'))
      else void dealProfile()
      return
    }
    if (!next.ticket) ticket = null
    if (!current) return
    if (shownId !== current.id) {
      shownId = current.id
      shownStatus = null
      shownTrace = 0
      spoken = ''
      ++turn
      stage.stopAll()
      phase = 'busy'
      setBusy(true)
      hideChips()
      hideBubble()
      trail.innerHTML = ''
      trail.classList.remove('fade')
    }
    if (current.status === 'running') {
      if (shownStatus !== 'running') {
        shownStatus = 'running'
        shownTrace = 0
        spoken = ''
        trail.innerHTML = ''
        phase = 'busy'
        setBusy(true)
        ++turn
      }
      for (const event of current.trace.slice(shownTrace)) {
        trail.querySelector('.now')?.classList.replace('now', 'done')
        const line = event.type === 'step' ? systemText(event.label) : event.summary
        const li = document.createElement('li')
        li.className = 'now'
        li.textContent = line
        trail.appendChild(li)
        // 留完整足迹在记录里；舞台上仅保留最近几步，避免长任务遮住主角。
        while (trail.children.length > 6) trail.firstElementChild.remove()
        sayStep(line)
      }
      shownTrace = current.trace.length
      stage.set(turnMood(current))
      if (current.content && current.content !== spoken) {
        spoken = current.content
        ++sayToken
        typing?.()
        skipRead?.()
        showBubble()
        const lines = speechLines(current.content)
        btext.textContent = lines.at(-1) ?? ''
        live.textContent = lines.slice(0, -1).at(-1) ?? ''
      }
    } else if (shownStatus !== current.status) {
      shownStatus = current.status
      trail.querySelector('.now')?.classList.replace('now', 'done')
      void showResult(current, next.cards, turn)
    }
  }
  // 长任务延续真实工具动作，不添加虚构步骤。
  setInterval(() => {
    if (phase === 'busy' && snapshot.turn?.status === 'running') {
      const mood = turnMood(snapshot.turn)
      stage.set(mood)
      if (mood === 'think') stage.gesture('chin')
    }
  }, 7000)

  async function finishTurn(o = {}) {
    phase = 'idle'
    setBusy(false)
    if (!o.keepMood) stage.set('idle')
    setTimeout(() => trail.classList.add('fade'), 1600)
    setChips(nextChips.length ? nextChips : FIRST_CHIPS)
    armIdle()
    if (o.keepMood)
      setTimeout(() => {
        if (phase === 'idle' && stage.mood === 'sad') stage.set('idle')
      }, 5000)
  }

  function stopTurn() {
    callbacks.stop()
    stage.gesture('shrug')
  }

  on($('#ask'), 'submit', (e) => {
    e.preventDefault()
    if (phase === 'busy') return stopTurn()
    if (q.value.trim()) ask(q.value)
  })
  let typeTimer = 0
  on(q, 'input', () => {
    if (phase !== 'busy') sendBtn.disabled = !q.value.trim()
    poke0()
    if (phase === 'idle' && q.value) {
      if (stage.mood !== 'listen') stage.set('listen')
      stage.tapKey()
      sound.key()
      clearTimeout(typeTimer)
      typeTimer = setTimeout(() => {
        if (stage.mood === 'listen') stage.set('idle')
      }, 2200)
    } else if (!q.value && stage.mood === 'listen') stage.set('idle')
  })
  on(q, 'focus', poke0)

  // ---- 待机：长时间没人理就打瞌睡，一有动静就醒 ----
  const SLEEP_AFTER = 45000
  let idleTimer = 0
  function clearTimers() {
    clearTimeout(idleTimer)
    clearTimeout(typeTimer)
  }
  function armIdle() {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (phase === 'idle' && !stage.handIds.length) {
        stage.set('sleep')
        hideBubble()
      }
    }, SLEEP_AFTER)
  }
  function poke0() {
    if (stage.mood === 'sleep') {
      stage.set('idle')
      stage.wake()
      say(t('嗯……我没睡。'), { log: false, keep: false })
    }
    armIdle()
  }

  // ---- 舞台上的点击和指针 ----
  const POKE = { 1: null, 2: '嗯？', 3: '别戳了。', 4: '再戳我喷墨了。', 5: '说过了。' }
  let lastP = null
  on(host, 'pointermove', (e) => {
    const hit = stage.hitCard(e.clientX, e.clientY)
    const over =
      hit >= 0 || stage.octoHit(e.clientX, e.clientY) || stage.pileHit(e.clientX, e.clientY)
    host.classList.toggle('can-click', over)
    if (lastP && phase !== 'busy')
      stage.petMove(e.clientX, e.clientY, Math.hypot(e.clientX - lastP.x, e.clientY - lastP.y))
    lastP = { x: e.clientX, y: e.clientY }
    armIdle()
  })
  on(host, 'click', (e) => {
    const x = e.clientX,
      y = e.clientY
    poke0()
    const hit = stage.hitCard(x, y)
    if (hit >= 0) {
      const id = stage.handIds[hit]
      if (hit !== stage.focusIndex()) {
        stage.setFocus(hit)
        sound.flip()
        back = false
        return renderActs()
      }
      // 背面的来源链接：点中就开原文
      if (back) {
        const r = stage.cardRect(id),
          sp = specs.get(id)
        const u = (x - r.left) / (r.right - r.left),
          v = (y - r.top) / (r.bottom - r.top)
        const link = sp.back.links?.find(
          (l) => u >= l.x && u <= l.x + l.w && v >= l.y && v <= l.y + l.h,
        )
        if (link) return void window.open(link.url, '_blank', 'noopener')
      }
      if (specs.get(id)?.kind === 'ticket') return
      if (!inspect) return setInspect(true)
      return toggleFlip()
    }
    if (inspect) return closeInspect()
    if (stage.pileHit(x, y)) return openAlbum()
    if (stage.octoHit(x, y)) {
      const n = stage.poke()
      sound.boop()
      const line = POKE[Math.min(n, 5)]
      if (line && phase !== 'busy') say(t(line), { log: false, keep: false })
    }
  })
  addEventListener('keydown', (e) => {
    const inInput =
      e.target === q || e.target.closest?.('button, a, textarea, [contenteditable=true]')
    if (e.key === 'Escape') {
      if (albumEl.classList.contains('open')) return closeAlbum()
      if (logEl.classList.contains('open')) return openLog(false)
      if (inspect) return closeInspect()
      if (phase === 'busy') return stopTurn()
    }
    if (inInput && q.value) return
    if (stage.handIds.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const i = stage.focusIndex() + (e.key === 'ArrowLeft' ? -1 : 1)
      if (i >= 0 && i < stage.handIds.length) {
        stage.setFocus(i)
        back = false
        renderActs()
        sound.flip()
      }
      e.preventDefault()
    }
    if (
      !inInput &&
      (e.key === ' ' || e.key === 'Enter') &&
      (typing || skipRead) &&
      e.target === document.body
    ) {
      e.preventDefault()
      advance()
    }
  })

  // 手机上左右滑切牌
  let swipe = null
  on(
    host,
    'touchstart',
    (e) => {
      swipe = e.touches[0].clientX
    },
    { passive: true },
  )
  on(
    host,
    'touchend',
    (e) => {
      if (swipe == null || stage.handIds.length < 2) return
      const dx = e.changedTouches[0].clientX - swipe
      swipe = null
      if (Math.abs(dx) < 40) return
      const i = stage.focusIndex() + (dx < 0 ? 1 : -1)
      if (i >= 0 && i < stage.handIds.length) {
        stage.setFocus(i)
        back = false
        renderActs()
      }
    },
    { passive: true },
  )

  // ---- 顶栏 ----
  const themeBtn = $('#b-theme'),
    soundBtn = $('#b-sound')
  const paintTheme = () => {
    themeBtn.textContent = t(dark ? '浅色' : '深色')
  }
  function paintCopy() {
    for (const node of root.querySelectorAll('[data-copy]')) {
      const message = t(node.dataset.copy)
      if (node.dataset.copyAttr) node.setAttribute(node.dataset.copyAttr, message)
      else node.textContent = message
    }
    paintTheme()
    soundBtn.textContent = t(soundBtn.getAttribute('aria-pressed') === 'true' ? '声音开' : '声音关')
    sendBtn.setAttribute('aria-label', t(phase === 'busy' ? '让它停下' : '发送'))
    if (chips.children.length && !chips.classList.contains('off'))
      setChips(nextChips.length ? nextChips : FIRST_CHIPS)
  }
  themeBtn.onclick = () => {
    dark = !dark
    root.dataset.theme = dark ? 'dark' : 'light'
    stage.setTheme(dark)
    store.set('theme', dark ? 'dark' : 'light')
    paintTheme()
  }
  soundBtn.onclick = () => {
    const on = sound.toggle()
    soundBtn.textContent = t(on ? '声音开' : '声音关')
    soundBtn.setAttribute('aria-pressed', on)
    store.set('sound', on ? '1' : '0')
    if (on) sound.pop()
  }

  // ---- 开场 ----
  let booted = false
  async function boot() {
    if (booted) return
    booted = true
    void document.fonts?.load('18px FusionPixel', '八爪鱼')
    renderQuota()
    nextChips = []
    await stage.enter()
    if (disposed || snapshot.turn || snapshot.ticket) return
    stage.gesture('wave')
    await wait(240)
    await say([t('我是 Inkpaw 的侦探。'), t('想查哪场比赛，写在下面。')], { log: false })
    setChips(FIRST_CHIPS)
    armIdle()
  }
  for (const link of root.querySelectorAll('a.logo, nav a')) {
    link.href = initial.textHref
    link.onclick = (event) => {
      event.preventDefault()
      callbacks.text()
    }
  }
  $('#profile-add').onclick = () => callbacks.profile('profile')
  update(initial)
  return {
    update,
    reopen: reopenCard,
    stop() {
      disposed = true
      ++turn
      ++sayToken
      typing?.()
      skipRead?.()
      globalEvents.abort()
      for (const id of frames) window.cancelAnimationFrame(id)
      for (const id of timers) window.clearTimeout(id)
      for (const id of intervals) window.clearInterval(id)
      stage.stopAll()
      stage.stop()
      sound.stop()
    },
  }
}
