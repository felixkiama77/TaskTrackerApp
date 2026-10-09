// Renders the vector brand mark into the PNG/ICO assets used by the window, tray,
// notifications and installer. Run with: npm run icons
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const brandDir = path.join(root, 'src/assets/brand')
const masterSvg = readFileSync(path.join(brandDir, 'task-tracker-mark.svg'), 'utf8')
// Small sizes use pixel-aligned variants so the T stays crisp instead of blurring between pixels.
const HINTED_SIZES = [16, 20, 24, 32]
const svgFor = (size) =>
  HINTED_SIZES.includes(size)
    ? readFileSync(path.join(brandDir, `task-tracker-mark-${size}.svg`), 'utf8')
    : masterSvg

const PNG_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** Builds a Windows .ico whose entries are PNG-compressed images. */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    directory.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    directory.writeUInt8(size >= 256 ? 0 : size, o + 1)
    directory.writeUInt16LE(1, o + 4) // color planes
    directory.writeUInt16LE(32, o + 6) // bits per pixel
    directory.writeUInt32LE(png.length, o + 8)
    directory.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
  // Each size is rasterized from vector (not scaled from one bitmap).
  const jobs = PNG_SIZES.map((size) => [size, svgFor(size)])
  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const results = []
    for (const [size, svg] of ${JSON.stringify(jobs)}) {
      const img = new Image()
      img.src = 'data:image/svg+xml;base64,' + btoa(svg)
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, 0, 0, size, size)
      results.push(canvas.toDataURL('image/png'))
    }
    return results
  })()`)

  const pngs = new Map(PNG_SIZES.map((size, i) => [size, Buffer.from(dataUrls[i].split(',')[1], 'base64')]))
  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) })))

  mkdirSync(path.join(root, 'build/icons'), { recursive: true })
  for (const [size, png] of pngs) writeFileSync(path.join(root, `build/icons/${size}x${size}.png`), png)
  writeFileSync(path.join(root, 'build/icon.png'), pngs.get(1024))
  writeFileSync(path.join(root, 'build/icon.ico'), ico)
  writeFileSync(path.join(root, 'public/app-icon.png'), pngs.get(256))
  writeFileSync(path.join(root, 'public/app-icon.ico'), ico)
  console.log(`Wrote ${pngs.size} PNG sizes and a ${ICO_SIZES.length}-image ICO.`)
  app.quit()
})
