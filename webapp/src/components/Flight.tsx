import { useEffect, useRef, type ReactNode } from "react"
import { MapFlight } from "../lib/mapFlight"
import { Wordmark } from "../brand/Brand"

interface Props { hidden: boolean; fade: boolean; skipped: boolean; onSkip: () => void; children?: ReactNode }

/** Full-screen waiting screen: a real satellite globe (MapLibre). What is happening is told by the companion's bubble. */
export default function Flight({ hidden, fade, skipped, onSkip, children }: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const cvEl = useRef<HTMLCanvasElement>(null)
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (hidden) return
    if (!MapFlight.mounted && mapEl.current && cvEl.current) MapFlight.mount(mapEl.current, cvEl.current)
    h.current?.focus({ preventScroll: true })
  }, [hidden])
  return (
    <div id="flight" hidden={hidden} className={fade ? "out" : ""} role="region" aria-labelledby="h-proc">
      <div id="map" ref={mapEl} aria-hidden="true" />
      <canvas id="stage" aria-hidden="true" ref={cvEl} />
      <h1 id="h-proc" className="vh" tabIndex={-1} ref={h}>Preparing your file</h1>
      <header className="brand flightbrand"><Wordmark size={24} /></header>
      {children}
    </div>
  )
}