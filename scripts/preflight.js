const fs = require('fs');
const path = require('path');
require('dotenv').config();

const root = process.cwd();

function checkFileExists(relativePath) {
  const full = path.join(root, relativePath);
  return fs.existsSync(full);
}

function hasValue(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function printResult(label, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${label}${detail ? `: ${detail}` : ''}`);
}

function run() {
  let failures = 0;

  const requiredRuntimeVars = ['JWT_SECRET', 'PORT'];
  const requiredDbVars = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];

  console.log('=== Deployment Preflight ===');

  const distServerExists = checkFileExists(path.join('dist', 'index.js'));
  printResult('Built server artifact', distServerExists, 'dist/index.js');
  if (!distServerExists) failures += 1;

  const publicIndexExists = checkFileExists(path.join('dist', 'public', 'index.html'));
  printResult('Built frontend artifact', publicIndexExists, 'dist/public/index.html');
  if (!publicIndexExists) failures += 1;

  for (const name of requiredRuntimeVars) {
    const ok = hasValue(name);
    printResult(`Env var ${name}`, ok);
    if (!ok) failures += 1;
  }

  const dbConfigured = requiredDbVars.every(hasValue);
  printResult(
    'PostgreSQL configuration',
    dbConfigured,
    dbConfigured ? 'PG_* values present' : 'Missing one or more PG_* values'
  );
  if (!dbConfigured) failures += 1;

  const hasGroq = hasValue('GROQ_API_KEY');
  const hasGoogle = hasValue('GOOGLE_AI_API_KEY');
  const aiConfigured = hasGroq || hasGoogle;
  printResult(
    'AI key configured',
    aiConfigured,
    aiConfigured ? 'GROQ_API_KEY or GOOGLE_AI_API_KEY present' : 'No AI key configured (fallback mode only)'
  );

  const nodeEnv = process.env.NODE_ENV || 'development';
  const nodeEnvValid = ['production', 'development', 'test'].includes(nodeEnv);
  printResult('NODE_ENV value', nodeEnvValid, nodeEnv);
  if (!nodeEnvValid) failures += 1;

  const isProduction = nodeEnv === 'production';
  printResult('Deployment NODE_ENV enforcement', isProduction, 'NODE_ENV must be production for deploy checks');
  if (!isProduction) failures += 1;

  if (failures > 0) {
    console.error(`\nPreflight failed with ${failures} blocking issue(s).`);
    process.exit(1);
  }

  console.log('\nPreflight passed. Deployment gate is clear.');
}

run();
