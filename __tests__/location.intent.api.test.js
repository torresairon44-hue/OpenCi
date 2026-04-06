jest.mock('../dist/chatbot-location-scraper.js', () => {
  const records = [
    {
      entityType: 'LocationSnapshot',
      capturedAt: '2026-03-31T00:00:00.000Z',
      personName: 'Ronald Airon Torres',
      role: 'admin',
      latitude: 14.510496,
      longitude: 120.991165,
      address: 'Kennedy Road, Tambo, Paranaque, Metro Manila, Philippines',
      freshnessStatus: 'live',
      accessStatus: 'active',
      source: 'test-fixture',
    },
    {
      entityType: 'LocationSnapshot',
      capturedAt: '2026-03-31T00:00:00.000Z',
      personName: 'Angelo Principio',
      role: 'fieldman',
      latitude: 14.510391,
      longitude: 120.991253,
      address: 'Quirino Avenue, Tambo, Paranaque, Metro Manila, Philippines',
      freshnessStatus: 'live',
      accessStatus: 'active',
      source: 'test-fixture',
    },
  ];

  return {
    shouldEnableChatbotLocationScraper: jest.fn(() => false),
    startChatbotLocationScraper: jest.fn(() => true),
    getChatbotLocationScraperStatus: jest.fn(() => ({
      enabled: true,
      running: true,
      lastSuccessAt: '2026-03-31T00:00:00.000Z',
      lastAttemptAt: '2026-03-31T00:00:00.000Z',
      lastError: null,
      lastItemCount: records.length,
      totalUpserts: records.length,
      lagSeconds: 0,
      stale: false,
      cursor: '2026-03-31T00:00:00.000Z',
    })),
    queryChatbotLocationByName: jest.fn((nameQuery, requester) => {
      const query = String(nameQuery || '').trim().toLowerCase();
      if (!query) return [];
      return records.filter((item) => {
        if (requester?.isAnonymous && item.role === 'admin') {
          return false;
        }
        return item.personName.toLowerCase().includes(query);
      });
    }),
  };
});

const request = require('supertest');
const app = require('../dist/index.js').default;

let ipCounter = 40;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe('location intent routing regression', () => {
  test('GET /api/chatbot/location-status returns scraper status payload', async () => {
    const response = await request(app)
      .get('/api/chatbot/location-status')
      .set('X-Forwarded-For', nextIp());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('status');
    expect(response.body.status).toHaveProperty('running', true);
  });

  test('does not treat filler word as person name', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({ content: 'do u know my location?', history: [] });

    expect(response.status).toBe(200);
    expect(response.body.aiMessage.content).toMatch(/Please include the person name/i);
    expect(response.body.aiMessage.content).not.toMatch(/for know/i);
  });

  test('does not treat self pronoun as literal name for anonymous query', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({ content: 'nasaan ako?', history: [] });

    expect(response.status).toBe(200);
    expect(response.body.aiMessage.content).toMatch(/Please include the person name/i);
    expect(response.body.aiMessage.content).not.toMatch(/for ako/i);
  });

  test('resolves direct address request for fieldman deterministically', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({ content: 'address for angelo', history: [] });

    expect(response.status).toBe(200);
    expect(response.body.aiMessage.content).toMatch(/Angelo Principio \(fieldman\)/i);
    expect(response.body.aiMessage.content).toMatch(/approximate address:/i);
    expect(response.body.aiMessage.content).toMatch(/Coordinates:/i);
  });

  test('uses follow-up pronoun with history for address lookup', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({
        content: 'address niya',
        history: [
          { role: 'user', content: 'where is Angelo' },
          { role: 'assistant', content: 'Angelo Principio (fieldman) coordinates: 14.510391, 120.991253.' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.aiMessage.content).toMatch(/Angelo Principio \(fieldman\)/i);
    expect(response.body.aiMessage.content).toMatch(/approximate address:/i);
  });

  test('does not fallback to previous person when explicit admin name is restricted for anonymous', async () => {
    const response = await request(app)
      .post('/api/chat/anonymous')
      .set('X-Forwarded-For', nextIp())
      .send({
        content: "what is Ronald's address?",
        history: [
          { role: 'user', content: 'where is Angelo' },
          { role: 'assistant', content: 'Angelo Principio (fieldman) coordinates: 14.510391, 120.991253.' },
        ],
      });

    expect(response.status).toBe(200);
      expect(response.body.aiMessage.content).toMatch(/Ronald/i);
      expect(response.body.aiMessage.content).toMatch(/No location record found|No visible location record found/i);
    expect(response.body.aiMessage.content).not.toMatch(/Angelo Principio/i);
  });
});
