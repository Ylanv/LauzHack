// AXAlotl brand: the wordmark "AXAl○tl" whose o is the mascot's head, front view, flat (same pixels and colours as the
// 3D companion: src/mascot/palette.json + face.ts). Font: Nunito 900, served by the app (@fontsource/nunito).
import "@fontsource/nunito/900.css"
import "./brand.css"

const P = { body: "#00008F", spot: "#2B2BB5", belly: "#EEF1FF", gill: "#FF1721", gillMid: "#E0141E", gillDark: "#B50D16", white: "#FFFFFF", pupil: "#00005B", mouth: "#00005B", inside: "#FF1721", cheek: "#FF4B53" }
type Expr = "smile" | "happy"
type Px = [number, number, string, number, number]

/** pixels of the head on a 24 x 16 grid: gills x 0-3 and 20-23, the cube's front face x 4-19 */
function headPixels(expr: Expr): Px[] {
  const r: Px[] = []
  const px = (x: number, y: number, c: string, w = 1, h = 1) => r.push([x, y, c, w, h])
  ;[[1, 2], [0, 6], [1, 10]].forEach(([x, y]) => { px(x, y, P.gill, 3, 2); px(3, y, P.gillMid, 1, 2) })
  ;[[20, 2], [20, 6], [20, 10]].forEach(([x, y], i) => { px(x, y, P.gillMid, 1, 2); px(x + 1, y, P.gill, i === 1 ? 3 : 2, 2) })
  px(3, 1, P.gillDark, 1, 12); px(20, 1, P.gillDark, 1, 12)
  px(4, 0, P.body, 16, 16); px(6, 1, P.spot, 3, 1); px(15, 2, P.spot, 2, 1); px(4, 11, P.belly, 16, 5)
  const f = (x: number, y: number, c: string, w = 1, h = 1) => px(x + 4, y, c, w, h)
  ;[0, 12].forEach((x0) => {
    if (expr === "smile") { f(x0, 7, P.white, 4, 4); f(x0 + 1, 8, P.pupil, 2, 2) }
    else { f(x0 + 1, 8, P.white, 2, 1); f(x0, 9, P.white); f(x0 + 3, 9, P.white); f(x0 + 1, 12, P.cheek, 2, 1) }
  })
  if (expr === "smile") { f(5, 12, P.mouth); f(10, 12, P.mouth); f(6, 13, P.mouth, 4, 1) }
  else { f(5, 12, P.mouth, 6, 1); f(5, 13, P.mouth); f(6, 13, P.inside, 4, 1); f(10, 13, P.mouth); f(6, 14, P.mouth, 4, 1) }
  return r
}

/** the mascot's head, front view (happy by default: ^ ^ eyes, grin, cheeks) */
export function MascotHead({ expr = "happy", className }: { expr?: Expr; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
      {headPixels(expr).map(([x, y, c, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={c} />)}
    </svg>
  )
}

/** "AXAl○tl": the app's name, the o being the mascot's head. `size` = font size in px. */
export function Wordmark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={"wordmark " + className} style={{ fontSize: size }} role="img" aria-label="AXAlotl">
      <span aria-hidden="true">AXAl</span><MascotHead className="wordmark__o" /><span className="wordmark__tl" aria-hidden="true">tl</span>
    </span>
  )
}
