const http = require('http');

const port = process.env.PORT || '3000';
const host = process.env.SMOKE_HOST || 'localhost';
const path = '/api/health';

const request = http.request(
  {
    hostname: host,
    port,
    path,
    method: 'GET',
    timeout: 8000,
  },
  (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`FAIL: ${path} returned status ${res.statusCode}`);
        process.exit(1);
      }

      try {
        const payload = JSON.parse(data);
        if (payload && payload.status === 'ok') {
          console.log(`PASS: ${host}:${port}${path} -> status=ok`);
          process.exit(0);
        }

        console.error(`FAIL: ${path} did not return status=ok`);
        process.exit(1);
      } catch (_error) {
        console.error(`FAIL: ${path} response is not valid JSON`);
        process.exit(1);
      }
    });
  }
);

request.on('timeout', () => {
  console.error(`FAIL: Request timed out for ${host}:${port}${path}`);
  request.destroy();
  process.exit(1);
});

request.on('error', (error) => {
  console.error(`FAIL: Unable to reach ${host}:${port}${path} (${error.message})`);
  process.exit(1);
});

request.end();
