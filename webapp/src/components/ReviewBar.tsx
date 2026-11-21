interface Props { variant: "A" | "B"; onVariant: (v: "A" | "B") => void; pause: boolean; onPause: (v: boolean) => void; held: boolean; onContinue: () => void }

/** Team-review controls on the waiting screen: pick the end-of-flight layout and hold the map once it has finished processing. */
export default function ReviewBar({ variant, onVariant, pause, onPause, held, onContinue }: Props) {
  return (
    <>
    <div className="rbar" role="group" aria-label="Review options">
      <div className="rbar__seg" role="radiogroup" aria-label="Map layout">
        <button type="button" role="radio" aria-checked={variant === "A"} className={variant === "A" ? "on" : ""} onClick={() => onVariant("A")}><b>A</b> Clean map + satellite window</button>
        <button type="button" role="radio" aria-checked={variant === "B"} className={variant === "B" ? "on" : ""} onClick={() => onVariant("B")}><b>B</b> Satellite</button>
      </div>
      <label className="rbar__pause"><input type="checkbox" checked={pause} onChange={(e) => onPause(e.target.checked)} /> Pause at end</label>
      {held && <button type="button" className="rbar__go" onClick={onContinue}>Continue</button>}
    </div>
    {held && <div className="explore-hint">Drag to move · scroll to zoom</div>}
    </>
  )
}