import { Clipboard, FileCode2, Hash, ListChecks, Trophy } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { RaffleLedger } from '../lib/ticketing/types'
import { compactNumber } from '../lib/ticketing/display'
import { TOTAL_PRIZE_SLOTS } from '../lib/prizes/prizes'
import type { AppCopy } from '../lib/i18n'

const CONTRACT_SOURCE = 'contracts/RenaissLuckyDraw.sol'

export function ContractDetails({ ledger, network, copy }: { ledger: RaffleLedger; network: DrawNetworkConfig; copy: AppCopy }) {
  async function copySourcePath() {
    await navigator.clipboard.writeText(CONTRACT_SOURCE)
  }

  async function copyLedgerHash() {
    if (ledger.ledgerHash) await navigator.clipboard.writeText(ledger.ledgerHash)
  }

  return (
    <section className="panel contract-details">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.contract.smartContract}</span>
          <h2>{copy.contract.title}</h2>
        </div>
        <FileCode2 size={22} />
      </div>

      <div className="contract-source-row">
        <div>
          <span>{copy.contract.soliditySource}</span>
          <strong>{CONTRACT_SOURCE}</strong>
        </div>
        <button className="icon-button" type="button" onClick={copySourcePath} aria-label={copy.contract.copyContractPath}>
          <Clipboard size={17} />
        </button>
      </div>

      <div className="contract-status source-metrics">
        <div>
          <span>{copy.contract.totalTickets}</span>
          <strong>{compactNumber(ledger.totalFinalTickets)}</strong>
        </div>
        <div>
          <span>{copy.contract.prizeSlots}</span>
          <strong>{TOTAL_PRIZE_SLOTS}</strong>
        </div>
        <div>
          <span>{copy.contract.ledgerEntries}</span>
          <strong>{compactNumber(ledger.totalEntries)}</strong>
        </div>
        <div>
          <span>{copy.contract.network}</span>
          <strong>{network.label}</strong>
        </div>
      </div>

      <div className="hash-row">
        <Hash size={18} />
        <div>
          <span>{copy.contract.ledgerHashFinalized}</span>
          <strong>{ledger.ledgerHash || copy.common.notGenerated}</strong>
        </div>
        <button className="icon-button" type="button" onClick={copyLedgerHash} disabled={!ledger.ledgerHash}>
          <Clipboard size={17} />
        </button>
      </div>

      <div className="rule-list contract-flow">
        <div>
          <span>{copy.contract.stepLabel} 1</span>
          <strong>{copy.contract.step1}</strong>
        </div>
        <div>
          <span>{copy.contract.stepLabel} 2</span>
          <strong>{copy.contract.step2}</strong>
        </div>
        <div>
          <span>{copy.contract.stepLabel} 3</span>
          <strong>{copy.contract.step3}</strong>
        </div>
      </div>

      <p className="soft-copy icon-copy">
        <ListChecks size={16} />
        {copy.contract.verifiedPublicly}
      </p>
      <p className="soft-copy icon-copy">
        <Trophy size={16} />
        {copy.contract.winnersMatched}
      </p>
    </section>
  )
}
