const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

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

function getNodeMajor() {
  const raw = process.versions && process.versions.node ? process.versions.node : '';
  const major = Number.parseInt(raw.split('.')[0], 10);
  return Number.isInteger(major) ? major : NaN;
}

async function run() {
  let failures = 0;
  const requiredNodeMajor = 20;

  const requiredRuntimeVars = ['JWT_SECRET', 'PORT'];
  const requiredDbVars = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];

  console.log('=== Deployment Preflight ===');

  const nodeMajor = getNodeMajor();
  const nodeVersionOk = nodeMajor === requiredNodeMajor;
  printResult('Node.js runtime version', nodeVersionOk, `${process.versions.node} (required ${requiredNodeMajor}.x)`);
  if (!nodeVersionOk) failures += 1;

  const distServerExists = checkFileExists(path.join('dist', 'src', 'index.js'));
  printResult('Built server artifact', distServerExists, 'dist/src/index.js');
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

  const allowInMemoryInProd = process.env.ALLOW_IN_MEMORY_DB_IN_PRODUCTION === 'true';
  printResult(
    'In-memory DB disabled in production',
    !allowInMemoryInProd,
    allowInMemoryInProd
      ? 'ALLOW_IN_MEMORY_DB_IN_PRODUCTION=true is unsafe for deployment'
      : 'fallback override not enabled'
  );
  if (allowInMemoryInProd) failures += 1;

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

  const pgHost = process.env.PG_HOST || 'localhost';
  const useSSL = process.env.PG_SSL === 'true' || /supabase\.co$/i.test(pgHost);
  const pgClient = new Client({
    host: pgHost,
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: useSSL
      ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true' }
      : undefined,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pgClient.connect();
    await pgClient.query('SELECT 1');
    printResult('PostgreSQL connectivity check', true, 'connected and queryable');
  } catch (error) {
    const detail = error && error.message ? error.message : 'connection failed';
    printResult('PostgreSQL connectivity check', false, detail);
    console.error('\nPreflight failed with 1 blocking issue(s).');
    process.exit(1);
  } finally {
    try {
      await pgClient.end();
    } catch {
      // no-op
    }
  }

  console.log('\nPreflight passed. Deployment gate is clear.');
}

run().catch((error) => {
  console.error('Preflight execution error:', error && error.message ? error.message : error);
  process.exit(1);
});
