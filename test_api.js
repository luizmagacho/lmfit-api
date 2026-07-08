const http = require('http');

const data = JSON.stringify({
  supplierId: "60a8b9f7f8d6f519349e5d7d",
  status: "interest",
  lines: [
    {
      unitPrice: 12.5,
      quantityOrdered: 1,
      variantId: "",
      rawName: "Teste",
    }
  ]
});

const req = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/purchases',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'BODY:', body));
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
