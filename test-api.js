const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/suppliers',
  method: 'GET',
};
const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});
req.on('error', err => console.log('Error:', err.message));
req.end();
