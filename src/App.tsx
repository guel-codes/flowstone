import { P5Canvas } from '@p5-wrapper/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rippleSketch } from './sketch/rippleSketch'

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 720, height: 960, token: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      setSize((s) => ({ width: cr.width, height: cr.height, token: s.token + 1 }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}

function App() {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [generateToken, setGenerateToken] = useState(1)
  const [saveToken, setSaveToken] = useState(0)

  const STONE_MIN = 1
  const STONE_MAX = 30
  const [stoneCount, setStoneCount] = useState(9)
  const [stoneCountText, setStoneCountText] = useState('9')

  const [background, setBackground] = useState('#0b0c10')
  const [water, setWater] = useState('#7dd3fc')
  const [stone, setStone] = useState('#111827')
  const [particleDensity, setParticleDensity] = useState<'low' | 'med' | 'high' | 'ultra'>('med')
  const [particleSize, setParticleSize] = useState<'xs' | 'sm' | 'md' | 'lg'>('md')

  // When major sim params change, just trigger a regenerate.
  // (Avoid remounting the sketch; it causes GC/jank with lots of particles.)
  useEffect(() => {
    setGenerateToken((t) => t + 1)
  }, [stoneCount, particleDensity])

  // Keep the text input in sync with programmatic changes.
  useEffect(() => {
    setStoneCountText(String(stoneCount))
  }, [stoneCount])

  function commitStoneCount(nextRaw: string) {
    const n = Number.parseInt(nextRaw, 10)
    if (!Number.isFinite(n)) {
      setStoneCountText(String(stoneCount))
      return
    }
    const next = Math.min(STONE_MAX, Math.max(STONE_MIN, n))
    setStoneCount(next)
    setStoneCountText(String(next))
  }

  const canvasDims = useMemo(() => {
    // Fit inside the available box, keep a wallpaper-ish aspect.
    const maxW = Math.max(240, Math.floor(size.width))
    const maxH = Math.max(240, Math.floor(size.height))
    const aspect = 3 / 4 // 0.75
    const w = Math.min(maxW, Math.floor(maxH * aspect))
    const h = Math.floor(w / aspect)
    return { width: Math.max(240, w), height: Math.max(240, h) }
  }, [size.height, size.width])

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 md:sticky md:top-4 md:self-start">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">FlowStone</h1>
              <p className="mt-1 text-xs text-zinc-300">by: Miguel Johnson</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGenerateToken((t) => t + 1)}
                className="rounded-md bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-950 hover:bg-white"
              >
                Generate
              </button>
              <button
                type="button"
                onClick={() => setSaveToken((t) => t + 1)}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
              >
                Save
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="text-xs font-medium text-zinc-300">Colors</div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Background</span>
              <input
                type="color"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Water</span>
              <input
                type="color"
                value={water}
                onChange={(e) => setWater(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Stone</span>
              <input
                type="color"
                value={stone}
                onChange={(e) => setStone(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </label>

            <div className="mt-2 text-xs font-medium text-zinc-300">Simulation</div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Stones</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={stoneCountText}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, '').slice(0, 2)
                  setStoneCountText(next)
                  // Live-update when it parses.
                  if (next.length > 0) commitStoneCount(next)
                }}
                onBlur={() => {
                  if (stoneCountText.trim().length === 0) {
                    setStoneCountText(String(stoneCount))
                    return
                  }
                  commitStoneCount(stoneCountText)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                }}
                className="h-9 w-20 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Particles</span>
              <select
                value={particleDensity}
                onChange={(e) => setParticleDensity(e.target.value as typeof particleDensity)}
                className="h-9 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
              >
                <option value="low">Low</option>
                <option value="med">Med</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="whitespace-nowrap text-zinc-200">Dot Size</span>
              <select
                value={particleSize}
                onChange={(e) => setParticleSize(e.target.value as typeof particleSize)}
                className="h-9 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
              >
                <option value="xs">XS</option>
                <option value="sm">SM</option>
                <option value="md">MD</option>
                <option value="lg">LG</option>
              </select>
            </label>
          </div>
        </aside>

        <main className="rounded-xl bg-zinc-950 p-2 md:p-4">
          <div
            ref={ref}
            className="mx-auto grid h-[70dvh] w-full max-w-[820px] place-items-center md:h-[calc(100dvh-2rem)]"
          >
            <div className="overflow-hidden rounded-lg" style={{ width: canvasDims.width, height: canvasDims.height }}>
              <P5Canvas
                sketch={rippleSketch}
                background={background}
                water={water}
                stone={stone}
                stoneCount={stoneCount}
                particleDensity={particleDensity}
                particleSize={particleSize}
                generateToken={generateToken}
                saveToken={saveToken}
                sizeToken={size.token}
                width={canvasDims.width}
                height={canvasDims.height}
                loading={() => (
                  <div className="grid h-full w-full place-items-center bg-zinc-950 text-xs text-zinc-400">
                    Loading canvas…
                  </div>
                )}
                error={(err) => {
                  const e = err as unknown as { message?: unknown; stack?: unknown }
                  return (
                    <div className="h-full w-full bg-zinc-950 p-3 text-left text-xs text-red-300">
                      <div className="font-semibold">Canvas error</div>
                      <div className="mt-2 whitespace-pre-wrap break-words text-red-200">
                        {String(e?.message ?? err)}
                      </div>
                      {e?.stack ? (
                        <div className="mt-2 whitespace-pre-wrap break-words text-red-200/80">
                          {String(e.stack)}
                        </div>
                      ) : null}
                    </div>
                  )
                }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
