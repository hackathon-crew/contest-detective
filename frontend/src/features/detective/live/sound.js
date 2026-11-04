// 音效全部用 Web Audio 现合成，默认关。像素游戏的方波就是这个风格的声音本身，音量压得很低，打字声不抢戏。
export function makeSound() {
  let on = false,
    ctx = null
  const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)())
  function tone(f, d, type = 'square', g = 0.02, slide = 0) {
    if (!on) return
    const a = ac(),
      o = a.createOscillator(),
      v = a.createGain(),
      t = a.currentTime
    o.type = type
    o.frequency.setValueAtTime(f, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d)
    v.gain.setValueAtTime(g, t)
    v.gain.exponentialRampToValueAtTime(0.0001, t + d)
    o.connect(v).connect(a.destination)
    o.start(t)
    o.stop(t + d)
  }
  function noise(d, g = 0.03) {
    if (!on) return
    const a = ac(),
      n = a.sampleRate * d,
      b = a.createBuffer(1, n, a.sampleRate),
      c = b.getChannelData(0)
    for (let i = 0; i < n; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const s = a.createBufferSource(),
      v = a.createGain(),
      f = a.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1800
    v.gain.value = g
    s.buffer = b
    s.connect(f).connect(v).connect(a.destination)
    s.start()
  }
  return {
    stop() {
      on = false
      void ctx?.close()
      ctx = null
    },
    toggle() {
      on = !on
      if (on) ac().resume?.()
      return on
    },
    blip: () => tone(520 + Math.random() * 60, 0.03, 'square', 0.009),
    key: () => tone(300, 0.02, 'square', 0.006),
    pop: () => tone(420, 0.07, 'square', 0.016, 260),
    boop: () => tone(240, 0.12, 'triangle', 0.05, 200),
    flip: () => noise(0.09, 0.02),
    whoosh: () => noise(0.22, 0.03),
    card: () => {
      tone(660, 0.08, 'square', 0.014)
      setTimeout(() => tone(880, 0.12, 'square', 0.014), 80)
    },
    stamp: () => {
      tone(110, 0.14, 'triangle', 0.08, -50)
      noise(0.06, 0.04)
    },
  }
}
