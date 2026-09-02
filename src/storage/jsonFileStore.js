const fs = require('fs/promises');
const path = require('path');

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await ensureParentDir(filePath);

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => null);
    throw error;
  }
}

async function readJson(filePath, options = {}) {
  const createIfMissing = options.createIfMissing !== false;
  const defaultFactory =
    typeof options.defaultFactory === 'function'
      ? options.defaultFactory
      : () => options.defaultValue;

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    const defaultValue = defaultFactory();

    if (createIfMissing) {
      await writeJsonAtomic(filePath, defaultValue);
    }

    return defaultValue;
  }
}

module.exports = {
  ensureParentDir,
  readJson,
  writeJsonAtomic,
};
