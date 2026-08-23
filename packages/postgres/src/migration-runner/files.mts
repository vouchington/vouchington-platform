import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

export function getFilesFromFolder(
  folder: string,
  allowedExtensions: string[] = ['.sql', '.mts'],
): string[] {
  if (!fs.existsSync(folder)) return []
  return fs
    .readdirSync(folder)
    .filter((file) => {
      if (file.startsWith('.')) return false
      if (file.endsWith('.d.mts')) return false
      const ext = path.extname(file)
      if (!allowedExtensions.includes(ext)) return false
      const filePath = path.resolve(folder, file)
      return fs.statSync(filePath).isFile()
    })
    .toSorted((a: string, b: string) => a.localeCompare(b))
}

export async function readMigrationFile(folder: string, file: string): Promise<string> {
  const ext = path.extname(file)
  if (ext === '.mts') {
    const migrationModule = await import(path.resolve(folder, file))
    assert(
      typeof migrationModule.default === 'function',
      `Expected a function, got ${typeof migrationModule.default}`,
    )
    return migrationModule.default()
  }
  if (ext === '.sql') {
    return fs.readFileSync(path.resolve(folder, file), 'utf8')
  }
  throw new Error(`Unknown type of file: ${file}`)
}
