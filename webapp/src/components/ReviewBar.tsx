interface Props { variant: "A" | "B"; onVariant: (v: "A" | "B") => void; pause: boolean; onPause: (v: boolean) => void; held: boolean; onContinue: () => void; hasJson?: boolean; onJson?: () => void }

/** Team-review controls on the waiting screen: pick the end-of-flight layout and hold the map once it has finished processing. */
export default function ReviewBar({ variant, onVariant, pause, onPause, held, onContinue, hasJson, onJson }: Props) {
  return (
    <>
    <div className="rbar" role="group" aria-label="Review options">
      <label className="rbar__pause"><input type="checkbox" checked={pause} onChange={(e) => onPause(e.target.checked)} /> Pause at end</label>
      {held && hasJson && <button type="button" className="rbar__json" onClick={onJson}>JSON</button>}
      {held && <button type="button" className="rbar__go" onClick={onContinue}>Continue</button>}
    </div>
    </>
  )
}