// Loading indicator: eight square pixels around a diamond path, each fading in sequence (after loading-ui "Diamond").
const PIXELS: [number, number][] = [[2, 0], [3, 1], [4, 2], [3, 3], [2, 4], [1, 3], [0, 2], [1, 1]]

export default function Diamond({ className = "" }: { className?: string }) {
  return (
    <svg className={"diamond " + className} viewBox="0 0 10 10" aria-hidden="true" fill="currentColor">
      {PIXELS.map(([x, y], i) => (
        <rect key={i} x={x * 2 + 0.25} y={y * 2 + 0.25} width="1.5" height="1.5" style={{ animationDelay: `${i * 0.11}s` }} />
      ))}
    </svg>
  )
}