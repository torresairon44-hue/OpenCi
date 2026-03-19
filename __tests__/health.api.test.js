const request = require('supertest');

// deploy:check runs build first, so dist/index.js is available for this integration test.
const app = require('../dist/index.js').default;

describe('GET /api/health', () => {
  test('returns status ok and ISO timestamp', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');

    // Basic ISO date parse check
    const parsed = Date.parse(response.body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
  });
});
