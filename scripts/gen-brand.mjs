// 生成品牌资源：favicon PNG/ICO、apple-touch、PWA 图标、og:image。
// 依赖 sharp（devDependency）。构建前自动执行：npm run prebuild → node scripts/gen-brand.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const iconSvg = readFileSync(join(pub, 'favicon.svg'))
const ogSvg = readFileSync(join(pub, 'brand', 'og.svg'))

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.warn('[gen-brand] sharp 未安装，跳过品牌图标生成（已有 public/ 资源保持不变）')
  process.exit(0)
}

async function renderPng(svg, size) {
  return await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer()
}

function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = 6 + 16 * entries.length
  const dirs = []
  const datas = []
  for (const { size, buf } of entries) {
    const d = Buffer.alloc(16)
    d.writeUInt8(size >= 256 ? 0 : size, 0)
    d.writeUInt8(size >= 256 ? 0 : size, 1)
    d.writeUInt8(0, 2)
    d.writeUInt8(0, 3)
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(buf.length, 8)
    d.writeUInt32LE(offset, 12)
    dirs.push(d)
    datas.push(buf)
    offset += buf.length
  }
  return Buffer.concat([header, ...dirs, ...datas])
}

const sizes = [16, 32, 48, 180, 192, 512]
const pngs = {}
for (const size of sizes) pngs[size] = await renderPng(iconSvg, size)

writeFileSync(join(pub, 'favicon-16.png'), pngs[16])
writeFileSync(join(pub, 'favicon-32.png'), pngs[32])
writeFileSync(join(pub, 'favicon.ico'), buildIco([
  { size: 16, buf: pngs[16] },
  { size: 32, buf: pngs[32] },
  { size: 48, buf: pngs[48] },
]))
writeFileSync(join(pub, 'apple-touch-icon.png'), pngs[180])
writeFileSync(join(pub, 'icon-192.png'), pngs[192])
writeFileSync(join(pub, 'icon-512.png'), pngs[512])

const og = await sharp(ogSvg, { density: 144 }).resize(1200, 630, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer()
writeFileSync(join(pub, 'og-image.png'), og)

console.log('[gen-brand] 已生成 favicon.ico / favicon-*.png / apple-touch-icon.png / icon-*.png / og-image.png')
