import { Cable, Clock3, Search, ShieldCheck, Wallet } from 'lucide-react'
import heroArtwork from '../assets/van-gogh-draw-hero-generated.png'
import type { RaffleLedger } from '../lib/ticketing/types'
import { formatDateTime } from '../lib/ticketing/rules'

export function HeroSection({
  ledger,
  onFindTickets,
  onConnectWallet,
}: {
  ledger: RaffleLedger
  onFindTickets: () => void
  onConnectWallet: () => void
}) {
  return (
    <section className="hero-band">
      <img className="hero-artwork" src={heroArtwork} alt="Van Gogh inspired lucky draw prize cube" />
      <div className="hero-copy">
        <div className="status-row">
          <span className="pill good">
            <ShieldCheck size={16} />
            Buyback ledger ready
          </span>
          <span className="pill">
            <Clock3 size={16} />
            {formatDateTime(ledger.campaignStart)} - {formatDateTime(ledger.campaignEnd)}
          </span>
          <span className="pill bsc-pill">
            <Cable size={16} />
            BNB Smart Chain
          </span>
        </div>
        <h1>Van Gogh Lucky Draw</h1>
        <p>
          Buy back OMEGA Gacha and Costume Packs to earn lucky tickets. Search your exact
          ticket numbers, verify the ledger, and run the BSC draw on-chain.
        </p>
        <div className="hero-actions">
          <button className="primary shimmer-button" type="button" onClick={onFindTickets}>
            <Search size={18} />
            Find My Tickets
          </button>
          <button type="button" onClick={onConnectWallet}>
            <Wallet size={18} />
            Connect BSC Wallet
          </button>
        </div>
        <span className="trust-line">
          Transparent · Fair · On-chain · {ledger.ledgerHash ? `${ledger.ledgerHash.slice(0, 8)}...${ledger.ledgerHash.slice(-6)}` : 'Ledger hash pending'}
        </span>
      </div>
    </section>
  )
}
