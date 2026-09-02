const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOTS = ['src', 'scripts'];

function collectJavaScriptFiles(root) {
  const absoluteRoot = path.resolve(process.cwd(), root);
  if (!fs.existsSync(absoluteRoot)) return [];

  const files = [];
  const stack = [absoluteRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

const files = ROOTS.flatMap(collectJavaScriptFiles);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`[check] syntax failed: ${path.relative(process.cwd(), file)}`);
    console.error(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`[check] syntax ok (${files.length} files)`);
}
