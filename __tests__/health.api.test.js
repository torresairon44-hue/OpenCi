const request = require('supertest');

// deploy:check runs build first, so dist/src/index.js is available for this integration test.
const app = require('../dist/src/index.js').default;

describe('GET /api/health', () => {
  test('returns status ok, ISO timestamp, and canary policy data', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('canary');
    expect(response.body.canary).toHaveProperty('status');
    expect(response.body.canary).toHaveProperty('rollbackRecommended');

    // Basic ISO date parse check
    const parsed = Date.parse(response.body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
  });
});
