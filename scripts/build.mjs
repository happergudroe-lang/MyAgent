import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, NODE_ENV: 'production' }
process.env.NODE_ENV = 'production'

const commands = [
  ['tsc', ['-b']],
  ['vite', ['build']],
]

for (const [command, args] of commands) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error(`Failed to start ${command}:`, result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectJavaScriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })
}

const jsFiles = collectJavaScriptFiles(resolve(root, 'dist'))
const jsxDevCount = jsFiles.reduce((total, path) => {
  const source = readFileSync(path, 'utf8')
  return total + (source.match(/\\bjsxDEV\\b/g)?.length ?? 0)
}, 0)

console.log(`[build] production bundle jsxDEV occurrences: ${jsxDevCount}`)
if (jsxDevCount > 0) {
  console.error('[build] Refusing to accept a development JSX runtime in the production bundle.')
  process.exit(1)
}
