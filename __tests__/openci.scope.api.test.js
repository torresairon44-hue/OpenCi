const request = require('supertest');
const app = require('../dist/src/index.js').default;

let ipCounter = 90;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe('OpenCI scope guardrails', () => {
  test('rejects obvious off-topic anonymous request', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({ content: 'san pinakamalapit na jollibee?', history: [] });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('aiMessage');
    expect(response.body.aiMessage.content).toMatch(/Sorry, I can only help with OpenCI-related questions/i);
  });

  test('rejects off-topic brand/color question', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({ content: 'ano kulay ng jollibee logo?', history: [] });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('aiMessage');
    expect(response.body.aiMessage.content).toMatch(/Sorry, I can only help with OpenCI-related questions/i);
  });
});
