const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const kbRoot = path.join(root, 'kb');
const snapshotsDir = path.join(kbRoot, 'snapshots');
const latestFile = path.join(snapshotsDir, 'LATEST.json');

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function collectKbMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = toPosix(path.relative(kbRoot, fullPath));

    if (entry.isDirectory()) {
      if (relative.startsWith('snapshots')) continue;
      files.push(...collectKbMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildManifest() {
  if (!fs.existsSync(kbRoot)) {
    throw new Error('kb directory not found');
  }

  const files = collectKbMarkdownFiles(kbRoot)
    .sort((a, b) => a.localeCompare(b))
    .map((fullPath) => {
      const rel = toPosix(path.relative(kbRoot, fullPath));
      const content = fs.readFileSync(fullPath);
      const size = content.length;
      const sha256 = hashContent(content);
      return { path: rel, size, sha256 };
    });

  const combinedHashInput = files
    .map((item) => `${item.path}:${item.sha256}`)
    .join('\n');

  const combinedHash = hashContent(Buffer.from(combinedHashInput, 'utf8'));

  return {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    combinedHash,
    files,
  };
}

function ensureSnapshotsDir() {
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
}

function writeSnapshot() {
  ensureSnapshotsDir();
  const manifest = buildManifest();

  const stamp = manifest.generatedAt.replace(/[:.]/g, '-');
  const snapshotName = `snapshot-${stamp}.json`;
  const snapshotPath = path.join(snapshotsDir, snapshotName);

  fs.writeFileSync(snapshotPath, JSON.stringify(manifest, null, 2), 'utf8');

  const latest = {
    generatedAt: manifest.generatedAt,
    snapshot: snapshotName,
    combinedHash: manifest.combinedHash,
    fileCount: manifest.fileCount,
    approvedBy: process.env.KB_APPROVED_BY || 'unassigned',
    approvalNote: process.env.KB_APPROVAL_NOTE || 'manual snapshot update',
  };

  fs.writeFileSync(latestFile, JSON.stringify(latest, null, 2), 'utf8');

  console.log(`[PASS] KB snapshot created: kb/snapshots/${snapshotName}`);
  console.log(`[PASS] KB lock updated: kb/snapshots/LATEST.json`);
  console.log(`[INFO] KB combined hash: ${manifest.combinedHash}`);
}

function verifySnapshot() {
  if (!fs.existsSync(latestFile)) {
    console.error('[FAIL] kb/snapshots/LATEST.json is missing');
    process.exit(1);
  }

  const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
  const manifest = buildManifest();

  if (latest.combinedHash !== manifest.combinedHash) {
    console.error('[FAIL] KB hash mismatch against approved snapshot');
    console.error(`[INFO] Expected: ${latest.combinedHash}`);
    console.error(`[INFO] Actual:   ${manifest.combinedHash}`);
    console.error('[INFO] Run: npm run kb:snapshot after KB review approval');
    process.exit(1);
  }

  console.log('[PASS] KB snapshot verification passed');
  console.log(`[INFO] Verified hash: ${manifest.combinedHash}`);
}

function main() {
  const command = (process.argv[2] || 'verify').toLowerCase();

  if (command === 'snapshot') {
    writeSnapshot();
    return;
  }

  if (command === 'verify') {
    verifySnapshot();
    return;
  }

  console.error('Usage: node scripts/kb-governance.js <snapshot|verify>');
  process.exit(1);
}

main();
