const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const EXPORT_FORMAT = 'corpdb-storage-export';
const EXPORT_VERSION = 1;

function normalizeStorageRoot(storageRoot) {
  return path.resolve(String(storageRoot || '').trim());
}

function portablePath(value) {
  return String(value || '').split(path.sep).join('/');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function walkFiles(rootDir, currentDir = rootDir) {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      relativePath: portablePath(path.relative(rootDir, absolutePath)),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
  return files;
}

async function listStorageFiles(storageRoot, options = {}) {
  const rootDir = normalizeStorageRoot(storageRoot);
  const allFiles = await walkFiles(rootDir);
  const includeSecrets = options.includeSecrets === true;
  return allFiles
    .filter((file) => includeSecrets || !file.relativePath.startsWith('secrets/'))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function getStorageStatus(storageRoot) {
  const rootDir = normalizeStorageRoot(storageRoot);
  const allFiles = await listStorageFiles(rootDir, { includeSecrets: true });
  const secretFiles = allFiles.filter((file) => file.relativePath.startsWith('secrets/'));
  const dataFiles = allFiles.filter((file) => !file.relativePath.startsWith('secrets/'));

  return {
    rootDir,
    dataFileCount: dataFiles.length,
    dataBytes: dataFiles.reduce((sum, file) => sum + file.size, 0),
    secretFileCount: secretFiles.length,
    secretBytes: secretFiles.reduce((sum, file) => sum + file.size, 0),
    secretsExcludedFromExport: true,
  };
}

function buildExportFileName(now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `corpdb-storage-${timestamp}.json.gz`;
}

async function buildStorageExport(storageRoot, options = {}) {
  const rootDir = normalizeStorageRoot(storageRoot);
  const now = options.now instanceof Date ? options.now : new Date();
  const fileMetadata = await listStorageFiles(rootDir, { includeSecrets: false });
  const files = [];

  for (const metadata of fileMetadata) {
    const content = await fs.readFile(metadata.absolutePath);
    files.push({
      path: metadata.relativePath,
      size: content.length,
      modifiedAt: metadata.modifiedAt,
      sha256: sha256(content),
      encoding: 'base64',
      data: content.toString('base64'),
    });
  }

  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    createdAt: now.toISOString(),
    secretsIncluded: false,
    excludedPaths: ['secrets/**'],
    files,
  };
  const jsonBuffer = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  const buffer = await gzip(jsonBuffer, { level: 9 });

  return {
    fileName: buildExportFileName(now),
    buffer,
    fileCount: files.length,
    uncompressedBytes: jsonBuffer.length,
    compressedBytes: buffer.length,
    sha256: sha256(buffer),
  };
}

module.exports = {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  portablePath,
  sha256,
  listStorageFiles,
  getStorageStatus,
  buildExportFileName,
  buildStorageExport,
};
