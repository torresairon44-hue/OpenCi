const axios = require('axios');

async function run() {
  const healthUrl = process.env.CANARY_HEALTH_URL || 'http://localhost:3000/api/health';

  try {
    const response = await axios.get(healthUrl, { timeout: 7000 });
    const payload = response.data || {};
    const canary = payload.canary || {};

    if (!canary || typeof canary !== 'object') {
      console.error('[FAIL] Canary payload missing from health endpoint');
      process.exit(1);
    }

    console.log(`[INFO] Canary status: ${canary.status || 'unknown'}`);
    console.log(`[INFO] Sample size: ${canary.sampleSize || 0}`);
    console.log(`[INFO] Provider failure rate: ${canary.providerFailureRate || 0}`);
    console.log(`[INFO] Fallback rate: ${canary.fallbackRate || 0}`);

    if (canary.rollbackRecommended === true) {
      console.error('[FAIL] Canary recommends rollback');
      if (Array.isArray(canary.reasons)) {
        for (const reason of canary.reasons) {
          console.error(` - ${reason}`);
        }
      }
      process.exit(1);
    }

    console.log('[PASS] Canary policy check passed');
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    console.error(`[FAIL] Canary check failed: ${detail}`);
    process.exit(1);
  }
}

run();
