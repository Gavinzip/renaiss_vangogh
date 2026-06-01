import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Wallet } from 'ethers'

const envPath = new URL('../.env.deploy.local', import.meta.url)
const force = process.argv.includes('--force')

function readEnvValue(source, key) {
  const line = source
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf('=') + 1).trim() : ''
}

if (existsSync(envPath) && !force) {
  const existing = readFileSync(envPath, 'utf8')
  const privateKey = readEnvValue(existing, 'BSC_DEPLOYER_PRIVATE_KEY')
  if (!privateKey) {
    throw new Error('.env.deploy.local exists but BSC_DEPLOYER_PRIVATE_KEY is missing.')
  }

  const wallet = new Wallet(privateKey)
  console.log(
    JSON.stringify(
      {
        ok: true,
        reused: true,
        address: wallet.address,
        envFile: '.env.deploy.local',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const wallet = Wallet.createRandom()

writeFileSync(
  envPath,
  [
    '# Local deploy secret. Do not commit or paste this file into chat.',
    'BSC_RPC_URL=https://bsc-dataseed.binance.org',
    'BSC_CHAIN_ID=56',
    `BSC_DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
    '',
    '# Chainlink VRF v2.5 on BNB Smart Chain mainnet.',
    'VRF_COORDINATOR=0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9',
    'VRF_KEY_HASH=0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4',
    'VRF_REQUEST_CONFIRMATIONS=3',
    'VRF_CALLBACK_GAS_LIMIT=750000',
    'VRF_NATIVE_PAYMENT=true',
    'VRF_NATIVE_FUND_BNB=0.05',
    '',
    'INITIAL_PRIZE_SLOT_COUNT=21',
    '',
  ].join('\n'),
)

console.log(
  JSON.stringify(
    {
      ok: true,
      reused: false,
      address: wallet.address,
      envFile: '.env.deploy.local',
    },
    null,
    2,
  ),
)
