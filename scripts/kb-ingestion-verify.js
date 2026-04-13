const fs = require('fs');
const path = require('path');

const root = process.cwd();
const kbRoot = path.join(root, 'kb');

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
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

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return null;
  const endMarker = raw.indexOf('\n---\n', 4);
  if (endMarker < 0) return null;

  const fmText = raw.slice(4, endMarker);
  const values = {};
  let currentArrayKey = null;

  for (const line of fmText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^-[\s]+/.test(trimmed) && currentArrayKey) {
      const item = trimmed.replace(/^-[\s]+/, '').trim();
      const existing = values[currentArrayKey];
      if (Array.isArray(existing)) {
        existing.push(item);
      } else {
        values[currentArrayKey] = [item];
      }
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();
    if (!key) continue;

    if (!rawValue) {
      values[key] = [];
      currentArrayKey = key;
      continue;
    }

    values[key] = rawValue.replace(/^['\"]|['\"]$/g, '');
    currentArrayKey = null;
  }

  return values;
}

function run() {
  if (!fs.existsSync(kbRoot)) {
    console.error('[FAIL] kb directory not found');
    process.exit(1);
  }

  const allowedTypes = new Set(['module', 'workflow', 'troubleshooting', 'procedure', 'faq', 'policy', 'glossary']);
  const allowedAccess = new Set(['public', 'authenticated']);

  const files = collectKbMarkdownFiles(kbRoot).sort((a, b) => a.localeCompare(b));
  let approved = 0;
  let skippedNoFrontmatter = 0;
  let skippedNotApproved = 0;
  let skippedInvalid = 0;
  const byType = new Map();

  for (const fullPath of files) {
    const rel = toPosix(path.relative(kbRoot, fullPath));
    const raw = fs.readFileSync(fullPath, 'utf8');
    const fm = parseFrontmatter(raw);

    if (!fm) {
      skippedNoFrontmatter += 1;
      continue;
    }

    const status = String(fm.status || '').toLowerCase();
    if (status !== 'approved') {
      skippedNotApproved += 1;
      continue;
    }

    const id = String(fm.id || '').trim();
    const type = String(fm.type || '').trim().toLowerCase();
    const access = String(fm.access_level || '').trim().toLowerCase();

    if (!id || !allowedTypes.has(type) || !allowedAccess.has(access)) {
      skippedInvalid += 1;
      console.log(`[WARN] invalid approved file: kb/${rel}`);
      continue;
    }

    approved += 1;
    byType.set(type, (byType.get(type) || 0) + 1);
  }

  console.log('[INFO] KB ingestion verification summary');
  console.log(`[INFO] total markdown files: ${files.length}`);
  console.log(`[INFO] approved and valid: ${approved}`);
  console.log(`[INFO] skipped (no frontmatter): ${skippedNoFrontmatter}`);
  console.log(`[INFO] skipped (not approved): ${skippedNotApproved}`);
  console.log(`[INFO] skipped (invalid approved metadata): ${skippedInvalid}`);
  console.log('[INFO] approved docs by type:');
  for (const [type, count] of Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  - ${type}: ${count}`);
  }
}

run();
