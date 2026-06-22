import { Filesystem, Directory } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'

const DATA_DIR = Directory.Data

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path: dirPath, directory: DATA_DIR, recursive: true })
  } catch {
    // already exists
  }
}

export async function writeBinaryFile(filePath: string, data: Uint8Array): Promise<void> {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  if (dir) await ensureDir(dir)
  await Filesystem.writeFile({
    path: filePath,
    data: uint8ToBase64(data),
    directory: DATA_DIR,
  })
}

export async function writeTextFile(filePath: string, data: string): Promise<void> {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  if (dir) await ensureDir(dir)
  await Filesystem.writeFile({
    path: filePath,
    data,
    directory: DATA_DIR,
  })
}

export async function readBinaryFile(filePath: string): Promise<Uint8Array> {
  const result = await Filesystem.readFile({ path: filePath, directory: DATA_DIR })
  if (typeof result.data === 'string') {
    return base64ToUint8(result.data)
  }
  throw new Error('无法读取文件')
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: filePath, directory: DATA_DIR })
    return true
  } catch {
    return false
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: filePath, directory: DATA_DIR })
  } catch {
    // ignore
  }
}

export function getExt(filePath: string): string {
  const name = filePath.split('/').pop() || filePath
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

const COVER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export async function getFileUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null
  if (!(await fileExists(filePath))) return null

  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.getUri({ path: filePath, directory: DATA_DIR })
    return Capacitor.convertFileSrc(uri)
  }

  const ext = getExt(filePath)
  const mime = COVER_MIME[ext] || 'application/octet-stream'
  const data = await readBinaryFile(filePath)
  return `data:${mime};base64,${uint8ToBase64(data)}`
}

export async function pickBookFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.epub,.pdf,application/epub+zip,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      document.body.removeChild(input)
      resolve(file)
    }
    input.oncancel = () => {
      document.body.removeChild(input)
      resolve(null)
    }
    input.click()
  })
}

export async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

export const BOOKS_DIR = 'books'
export const COVERS_DIR = 'covers'
