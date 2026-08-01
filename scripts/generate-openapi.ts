import { mkdir, writeFile } from 'node:fs/promises'
import { generateOpenApiDocument } from '../src/openapi.js'

const outDir = new URL('../docs/', import.meta.url)
await mkdir(outDir, { recursive: true })
await writeFile(new URL('openapi.json', outDir), JSON.stringify(generateOpenApiDocument(), null, 2) + '\n')
