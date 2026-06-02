import renaissLogo from '../assets/renaiss-logo-alpha-cropped.webp'
import { CircularText } from './CircularText'
import './InitialPageLoader.css'

type InitialPageLoaderProps = {
  isLeaving: boolean
}

export function InitialPageLoader({ isLeaving }: InitialPageLoaderProps) {
  return (
    <div className={`initial-loader${isLeaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" aria-busy={!isLeaving}>
      <div className="initial-loader__mark" aria-hidden="true">
        <CircularText
          text="Cards • Renaiss • Collectibles • "
          onHover="speedUp"
          spinDuration={18}
          className="initial-loader__circular"
        />
        <img className="initial-loader__logo" src={renaissLogo} alt="" draggable={false} decoding="async" />
      </div>
      <span className="initial-loader__sr">Loading Renaiss Lucky Draw</span>
    </div>
  )
}
