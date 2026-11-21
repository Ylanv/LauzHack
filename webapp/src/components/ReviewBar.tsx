interface Props { variant: "A" | "B"; onVariant: (v: "A" | "B") => void; pause: boolean; onPause: (v: boolean) => void; held: boolean; onContinue: () => void; reportHref?: string }

/** Team-review controls on the waiting screen: hold the map once the report is ready, open that report in the
 *  underwriter dashboard, then continue to the confirmation. Not part of the client flow. */
export default function ReviewBar({ pause, onPause, held, onContinue, reportHref }: Props) {
  return (
    <div className="rbar" role="group" aria-label="Review options">
      <label className="rbar__pause"><input type="checkbox" checked={pause} onChange={(e) => onPause(e.target.checked)} /> Pause at end</label>
      {held && reportHref && <a className="rbar__json" href={reportHref} target="_blank" rel="noreferrer">Open report</a>}
      {held && <button type="button" className="rbar__go" onClick={onContinue}>Continue</button>}
    </div>
  )
}
