#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const WEB_BUILD_DEV_DEPENDENCIES = [
  '@vitejs/plugin-react',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@types/three',
  'typescript',
  'vite',
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(repoRoot, 'package.json')
const lockPath = resolve(repoRoot, 'package-lock.json')

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const packageLock = JSON.parse(readFileSync(lockPath, 'utf8'))

const nextDevDependencies = Object.fromEntries(
  WEB_BUILD_DEV_DEPENDENCIES.map((name) => {
    const lockedVersion = packageLock.packages?.[`node_modules/${name}`]?.version
    const declaredVersion = packageJson.devDependencies?.[name]
    return [name, lockedVersion || declaredVersion]
  }).filter(([, version]) => Boolean(version)),
)

const missingDependencies = WEB_BUILD_DEV_DEPENDENCIES.filter((name) => !nextDevDependencies[name])
if (missingDependencies.length) {
  throw new Error(`Missing Docker web build dependencies: ${missingDependencies.join(', ')}`)
}

packageJson.devDependencies = nextDevDependencies
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
