import type p5 from 'p5'
import type { P5CanvasInstance, SketchProps } from '@p5-wrapper/react'

export type RippleSketchProps = SketchProps & {
  background: string
  water: string
  stone: string
  stoneCount: number
  particleDensity: 'low' | 'med' | 'high' | 'ultra'
  particleSize: 'xs' | 'sm' | 'md' | 'lg'
  generateToken: number
  saveToken: number
  sizeToken: number
  width: number
  height: number
}

type Stone = {
  pts: { x: number; y: number }[]
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace('#', '')
  if (h.length !== 6) return null
  const n = Number.parseInt(h, 16)
  if (Number.isNaN(n)) return null
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function setFillFromHex(p: p5, hex: string, alpha = 255) {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    p.fill(0, alpha)
    return
  }
  p.fill(rgb.r, rgb.g, rgb.b, alpha)
}

function blobStone(p: p5, cx: number, cy: number, r: number, seed: number): Stone {
  const pts: { x: number; y: number }[] = []
  const steps = 96
  const nScale = p.random(0.7, 1.25)
  const amp = p.random(0.35, 0.8)
  const lopsided = p.random(0.78, 1.28)
  const angOff = p.random(p.TWO_PI)
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * p.TWO_PI
    const ca = Math.cos(t + angOff)
    const sa = Math.sin(t + angOff)
    const nx = ca * nScale + 2.1
    const ny = sa * nScale + 7.3
    const wobble = p.noise(nx + seed, ny + seed) // 0..1
    const wobble2 = p.noise(nx * 1.7 + seed * 1.3, ny * 1.7 + seed * 1.3)
    const rr = r * (0.6 + wobble * amp + wobble2 * (amp * 0.35))
    const x = cx + Math.cos(t) * rr * lopsided
    const y = cy + Math.sin(t) * rr * (2 - lopsided)
    pts.push({ x, y })
  }
  return { pts }
}

export function rippleSketch(p: P5CanvasInstance<RippleSketchProps>) {
  let props: RippleSketchProps | undefined
  let stones: Stone[] = []
  let seed = 1
  let lastStoneColor = ''
  let isSetup = false
  let lastGenerateToken = 0
  let lastSaveToken = 0
  let lastSizeToken = 0
  let lastStoneCount = -1
  // (Colors are read directly from props in draw.)
  let lastParticleDensity: RippleSketchProps['particleDensity'] | undefined
  let lastParticleSize: RippleSketchProps['particleSize'] | undefined

  type Particle = {
    x: number
    y: number
    vx: number
    vy: number
    age: number
    stuck: number
    slow: number
  }

  let stoneMask: p5.Graphics | undefined
  let stoneMaskPixels: number[] | undefined
  let stoneMaskW = 0
  let stoneMaskH = 0
  let particles: Particle[] = []
  let desiredParticleCount = 0
  let fieldT = 0
  let edgeMargin = 2

  function resizeIfNeeded(next?: RippleSketchProps) {
    if (!next) return
    if (!isSetup) return
    const w = Math.max(240, Math.floor(next.width))
    const h = Math.max(240, Math.floor(next.height))
    if (p.width !== w || p.height !== h) {
      p.resizeCanvas(w, h)
      stoneMask = p.createGraphics(w, h)
      stoneMask.pixelDensity(1)
      stoneMaskPixels = undefined
      // Force a re-generate at the new resolution.
      generate({ ...props, width: w, height: h } as RippleSketchProps)
    }
  }

  function rebuildStoneMask(stoneHex: string) {
    if (!stoneMask) {
      stoneMask = p.createGraphics(p.width, p.height)
      stoneMask.pixelDensity(1)
    }
    stoneMask.clear()
    stoneMask.noStroke()
    const rgb = hexToRgb(stoneHex) ?? { r: 255, g: 255, b: 255 }
    stoneMask.fill(rgb.r, rgb.g, rgb.b, 255)
    for (const s of stones) {
      stoneMask.beginShape()
      for (const pt of s.pts) stoneMask.vertex(pt.x, pt.y)
      stoneMask.endShape(p.CLOSE)
    }

    // Cache pixels for fast collision checks.
    stoneMask.loadPixels()
    stoneMaskPixels = stoneMask.pixels
    stoneMaskW = stoneMask.width
    stoneMaskH = stoneMask.height
  }

  function inStone(x: number, y: number): boolean {
    if (!stoneMaskPixels) return false
    const ix = Math.max(0, Math.min(stoneMaskW - 1, Math.floor(x)))
    const iy = Math.max(0, Math.min(stoneMaskH - 1, Math.floor(y)))
    const idx = (iy * stoneMaskW + ix) * 4 + 3
    return (stoneMaskPixels[idx] ?? 0) > 10
  }

  function stoneNormalAt(x: number, y: number): { x: number; y: number } {
    // Approximate an outward normal using a tiny occupancy gradient on the mask.
    // If we're inside, we want the direction that exits the stone.
    const eps = 2
    const ax = inStone(x + eps, y) ? 1 : 0
    const bx = inStone(x - eps, y) ? 1 : 0
    const ay = inStone(x, y + eps) ? 1 : 0
    const by = inStone(x, y - eps) ? 1 : 0
    let nx = bx - ax
    let ny = by - ay
    const len = Math.hypot(nx, ny)
    if (len < 1e-6) {
      // Fallback: random direction.
      const a = p.random(p.TWO_PI)
      return { x: Math.cos(a), y: Math.sin(a) }
    }
    nx /= len
    ny /= len
    return { x: nx, y: ny }
  }

  function avoidanceAt(x: number, y: number): { x: number; y: number } {
    // Sample around the point; if we detect stone nearby, push away from it.
    const r = 7
    let ax = 0
    let ay = 0
    // Keep this cheap: 4-neighborhood is enough for steering.
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const

    for (const [dx, dy] of dirs) {
      const sx = x + dx * r
      const sy = y + dy * r
      if (inStone(sx, sy)) {
        // We found stone in this direction; push opposite.
        ax -= dx
        ay -= dy
      }
    }

    const len = Math.hypot(ax, ay)
    if (len < 1e-6) return { x: 0, y: 0 }
    return { x: ax / len, y: ay / len }
  }

  function respawnParticle(pt: Particle) {
    // Emit from a source region so the motion reads like continuous flowing water.
    // For now: a band near the top (with slight horizontal jitter).
    const tries = 80
    for (let i = 0; i < tries; i++) {
      const x = p.width * 0.5 + p.random(-p.width * 0.48, p.width * 0.48)
      const y = p.random(0, p.height * 0.18)
      if (inStone(x, y)) continue
      pt.x = x
      pt.y = y
      pt.vx = p.random(-0.4, 0.4)
      pt.vy = p.random(0.6, 1.4)
      pt.age = 0
      pt.stuck = 0
      pt.slow = 0
      return
    }
    // Fallback: anywhere not in stone.
    pt.x = p.random(1, p.width - 2)
    pt.y = p.random(1, p.height - 2)
    pt.vx = p.random(-0.6, 0.6)
    pt.vy = p.random(-0.6, 0.6)
    pt.age = 0
    pt.stuck = 0
    pt.slow = 0
  }

  function reseedParticles() {
    const area = p.width * p.height

    // Higher baseline so it reads as "water".
    const base = Math.max(5000, Math.min(18000, Math.floor(area / 320)))
    const density = props?.particleDensity ?? 'med'
    // If performance stays good (pixel-cached collision), allow denser modes.
    const mul = density === 'low' ? 0.85 : density === 'med' ? 1.25 : density === 'high' ? 1.9 : 3.0
    desiredParticleCount = Math.max(2500, Math.min(42000, Math.floor(base * mul)))
  }

  function reconcileParticleCount() {
    // Avoid big allocations on every settings tweak; converge over a few frames.
    const target = desiredParticleCount || particles.length
    if (particles.length > target) {
      particles.length = target
      return
    }
    if (particles.length < target) {
      const batch = Math.min(1200, target - particles.length)
      for (let i = 0; i < batch; i++) {
        const pt: Particle = { x: 0, y: 0, vx: 0, vy: 0, age: 0, stuck: 0, slow: 0 }
        respawnParticle(pt)
        particles.push(pt)
      }
    }
  }

  function stepParticle(pt: Particle) {
    pt.age++

    // Flow field + a little momentum.
    const n = p.noise(pt.x * 0.0028, pt.y * 0.0028, seed * 0.00001 + fieldT)
    const ang = n * p.TWO_PI * 6
    // Keep a consistent (slower, smooth) feel regardless of density.
    // Density should control particle count, not how fast they move.
    // This matches the older ultra/high pacing.
    const forceK = 0.58

    let ax = Math.cos(ang) * 0.26 * forceK
    let ay = (Math.sin(ang) * 0.26 + 0.09) * forceK // gentle downward drift for "water flow"

    // Small wandering term to break up clusters.
    const n2 = p.noise(pt.x * 0.006, pt.y * 0.006, seed * 0.00002 + fieldT * 1.7)
    const ang2 = n2 * p.TWO_PI * 2
    ax += Math.cos(ang2) * 0.06 * forceK
    ay += Math.sin(ang2) * 0.06 * forceK

    // Steer away from stones so the field flows through channels instead of piling up.
    const avoid = avoidanceAt(pt.x, pt.y)
    ax += avoid.x * 0.55 * forceK
    ay += avoid.y * 0.55 * forceK

    // Add a tangential component so the flow tends to slide around stones.
    const swirl = 0.22
    ax += -avoid.y * swirl
    ay += avoid.x * swirl
    pt.vx = pt.vx * 0.97 + ax
    pt.vy = pt.vy * 0.97 + ay

    // Limit speed so collisions look like ripples, not streaks.
    const maxV = 2.0
    const sp = Math.hypot(pt.vx, pt.vy)
    if (sp > maxV) {
      pt.vx = (pt.vx / sp) * maxV
      pt.vy = (pt.vy / sp) * maxV
    }

    let tx = pt.x + pt.vx
    let ty = pt.y + pt.vy

    // Bounce on canvas edges so motion stays energetic and continuous.
    // Use <= / >= so we reliably flip at the boundary.
    const m = edgeMargin
    if (tx <= m) {
      tx = m
      pt.vx = Math.abs(pt.vx) * 1.02
      pt.vx *= -1
    } else if (tx >= p.width - m) {
      tx = p.width - m
      pt.vx = Math.abs(pt.vx) * 1.02
      pt.vx *= -1
    }
    if (ty <= m) {
      ty = m
      pt.vy = Math.abs(pt.vy) * 1.02
      pt.vy *= -1
    } else if (ty >= p.height - m) {
      ty = p.height - m
      pt.vy = Math.abs(pt.vy) * 1.02
      pt.vy *= -1
    }

    // Stone collision: reflect velocity and push out so motion stays continuous.
    if (inStone(tx, ty)) {
      const nrm = stoneNormalAt(tx, ty)
      const dot = pt.vx * nrm.x + pt.vy * nrm.y
      pt.vx = pt.vx - 2 * dot * nrm.x
      pt.vy = pt.vy - 2 * dot * nrm.y
      // Add a little energy + jitter to prevent "settling" on edges.
      const j = p.random(-0.25, 0.25)
      const cx = pt.vx * Math.cos(j) - pt.vy * Math.sin(j)
      const cy = pt.vx * Math.sin(j) + pt.vy * Math.cos(j)
      pt.vx = cx * 1.08
      pt.vy = cy * 1.08

      // Push out along the normal until we're out (bounded loop).
      let px = pt.x
      let py = pt.y
      for (let k = 0; k < 8; k++) {
        px += nrm.x * 2.2
        py += nrm.y * 2.2
        // Keep inside the box (edge bounce is handled in the main step).
        px = Math.max(1, Math.min(p.width - 2, px))
        py = Math.max(1, Math.min(p.height - 2, py))
        if (!inStone(px, py)) break
      }
      pt.x = px
      pt.y = py
      pt.stuck++
      if (pt.stuck > 10) {
        respawnParticle(pt)
      }
      return
    }

    pt.x = tx
    pt.y = ty
    pt.stuck = 0

    const sp2 = Math.hypot(pt.vx, pt.vy)
    pt.slow = sp2 < 0.18 ? pt.slow + 1 : 0
    if (pt.slow > 90) {
      respawnParticle(pt)
      return
    }

    // If a particle gets very slow for too long, recycle it.
    if (pt.age > 2400) {
      respawnParticle(pt)
    }
  }

  function generate(next?: RippleSketchProps) {
    if (!isSetup) return
    const w = next ? next.width : p.width
    const h = next ? next.height : p.height
    seed = Math.floor(p.random(1, 1_000_000))
    p.noiseSeed(seed)

    const requested = Math.max(1, Math.min(30, Math.floor(next?.stoneCount ?? 9)))
    // Layout: random packing that fills the canvas, with a guaranteed gap.
    const area = w * h
    const fill = 0.48 // leave more negative space for channels
    const baseR0 = Math.sqrt((area * fill) / (requested * Math.PI))
    const minR = Math.min(w, h) * 0.05
    const maxR = Math.min(w, h) * 0.22
    let baseR = p.constrain(baseR0, minR, maxR)
    const gap = Math.max(16, Math.min(w, h) * 0.03)
    const centers: { x: number; y: number; r: number }[] = []

    // Dart throwing with a few radius shrink attempts if it can't pack.
    for (let pass = 0; pass < 5 && centers.length < requested; pass++) {
      const attempts = 1200
      for (let a = 0; a < attempts && centers.length < requested; a++) {
        const r = baseR * p.random(0.75, 1.08)
        const x = p.random(r + gap, w - r - gap)
        const y = p.random(r + gap, h - r - gap)
        let ok = true
        for (const c of centers) {
          const d = p.dist(x, y, c.x, c.y)
          if (d < r + c.r + gap) {
            ok = false
            break
          }
        }
        if (ok) centers.push({ x, y, r })
      }
      baseR *= 0.92
    }

    // If we're still short, just place the remainder (smaller) in available pockets.
    for (let a = 0; a < 2000 && centers.length < requested; a++) {
      const r = baseR * 0.72
      const x = p.random(r + gap, w - r - gap)
      const y = p.random(r + gap, h - r - gap)
      let ok = true
      for (const c of centers) {
        const d = p.dist(x, y, c.x, c.y)
        if (d < r + c.r + gap) {
          ok = false
          break
        }
      }
      if (ok) centers.push({ x, y, r })
    }

    stones = centers.map((c, i) => blobStone(p, c.x, c.y, c.r, seed * 0.001 + i * 10.13))
    lastStoneColor = next?.stone ?? '#111827'
    rebuildStoneMask(lastStoneColor)
    reseedParticles()
    // If this is our first generate (or after resize), quickly populate to target.
    while (particles.length < desiredParticleCount) reconcileParticleCount()
  }

  p.setup = () => {
    // Defensive: in dev/HMR it's easy to end up with multiple canvases attached to the same mount.
    // Clear any existing canvases under the wrapper's mount node before creating ours.
    const mount = (p as unknown as { _userNode?: HTMLElement })._userNode
    if (mount) {
      for (const c of Array.from(mount.querySelectorAll('canvas'))) c.remove()
    }
    ;(p as unknown as { canvas?: HTMLCanvasElement }).canvas?.remove()

    const w = Math.max(240, Math.floor(props?.width ?? 720))
    const h = Math.max(240, Math.floor(props?.height ?? 900))
    p.createCanvas(w, h)
    p.pixelDensity(2)
    p.frameRate(60)
    isSetup = true
    stoneMask = p.createGraphics(p.width, p.height)
    stoneMask.pixelDensity(1)
    stoneMaskPixels = undefined

    // Generate using the latest props (so stoneCount applies on first paint).
    lastStoneCount = props?.stoneCount ?? -1
    lastGenerateToken = props?.generateToken ?? 0
    lastSaveToken = props?.saveToken ?? 0
    lastSizeToken = props?.sizeToken ?? 0
    lastParticleDensity = props?.particleDensity
    lastParticleSize = props?.particleSize
    generate(props)
  }

  p.updateWithProps = (next) => {
    // Always accept latest props (updateWithProps can run before setup()).
    props = next
    if (!isSetup) return

    if (next.sizeToken !== lastSizeToken) {
      lastSizeToken = next.sizeToken
      resizeIfNeeded(next)
    }

    // Colors are applied live in draw; no bookkeeping needed here.
    if (next.stone !== lastStoneColor) {
      lastStoneColor = next.stone
      rebuildStoneMask(next.stone)
    }

    if (next.stoneCount !== lastStoneCount) {
      lastStoneCount = next.stoneCount
      generate(next)
    }

    if (next.particleDensity !== lastParticleDensity) {
      lastParticleDensity = next.particleDensity
      reseedParticles()
    }

    if (next.particleSize !== lastParticleSize) {
      lastParticleSize = next.particleSize
    }

    if (next.generateToken !== lastGenerateToken) {
      lastGenerateToken = next.generateToken
      generate(next)
    }

    if (next.saveToken !== lastSaveToken) {
      lastSaveToken = next.saveToken
      p.saveCanvas('flowstone', 'png')
    }
  }

  p.draw = () => {
    if (!isSetup) return
    // Advance the field once per frame (not per particle) for stable performance.
    fieldT += 0.015
    const bg = props?.background ?? '#0b0c10'
    const water = props?.water ?? '#7dd3fc'
    const stone = props?.stone ?? '#111827'

    // (mask rebuild handled in updateWithProps; keep draw light)

    {
      const rgb = hexToRgb(bg)
      if (rgb) p.background(rgb.r, rgb.g, rgb.b)
      else p.background(bg)
    }

    const base = Math.min(p.width, p.height)
    const sz = props?.particleSize ?? 'md'
    const mul = sz === 'xs' ? 0.003 : sz === 'sm' ? 0.004 : sz === 'md' ? 0.0052 : 0.0068
    const dot = Math.max(1.1, base * mul)
    // Keep dots fully inside the box when bouncing.
    edgeMargin = Math.max(2, dot * 0.55)

    reconcileParticleCount()

    // No ghosting: draw particles fresh each frame.
    p.noStroke()
    setFillFromHex(p, water, 220)
    // Keep motion speed consistent across densities.
    // Use 1 step so we don't accidentally double the perceived speed.
    const steps = 1
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i]!
      for (let s = 0; s < steps; s++) stepParticle(pt)
      if (inStone(pt.x, pt.y)) {
        // respawn if somehow inside after regeneration
        pt.x = p.random(1, p.width - 2)
        pt.y = p.random(1, p.height - 2)
        continue
      }
      p.circle(pt.x, pt.y, dot)
    }

    // Stones visible again.
    p.noStroke()
    setFillFromHex(p, stone, 255)
    for (const s of stones) {
      p.beginShape()
      for (const pt of s.pts) p.vertex(pt.x, pt.y)
      p.endShape(p.CLOSE)
    }

  }
}
