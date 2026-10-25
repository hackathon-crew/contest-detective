import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(root, 'public/ocr')
const dependencies = resolve(root, 'node_modules')
await mkdir(join(output, 'core'), { recursive: true })
await mkdir(join(output, 'lang'), { recursive: true })
const manifest = { engine: 'tesseract.js', version: '6.0.1', files: [] }
async function copy(source, name) {
  const destination = join(output, name)
  await copyFile(source, destination)
  const data = await readFile(destination)
  manifest.files.push({
    path: name,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
}
await copy(join(dependencies, 'tesseract.js/dist/worker.min.js'), 'worker.min.js')
for (const name of await readdir(join(dependencies, 'tesseract.js-core'))) {
  if (/\.wasm(?:\.js)?$/.test(name))
    await copy(join(dependencies, 'tesseract.js-core', name), `core/${name}`)
}
for (const language of ['chi_sim', 'eng'])
  await copy(
    join(dependencies, `@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`),
    `lang/${language}.traineddata.gz`,
  )
await copy(join(dependencies, 'tesseract.js/LICENSE.md'), 'LICENSE-tesseract.js.txt')
await copy(join(dependencies, 'tesseract.js-core/LICENSE'), 'LICENSE-tesseract-core.txt')
await writeFile(
  join(output, 'NOTICE.txt'),
  'Tesseract.js 6.0.1 and Tesseract.js-core 6 are Apache-2.0.\nChinese/English language data: @tesseract.js-data/chi_sim and @tesseract.js-data/eng 1.0.0, Apache-2.0.\nSources: https://github.com/naptha/tesseract.js and https://github.com/naptha/tessdata\nAssets are self-hosted. No screenshot bytes are uploaded for OCR.\n',
)
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Prepared ${manifest.files.length} self-hosted OCR assets`)
