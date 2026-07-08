async function test() {
  const loginRes = await fetch('http://127.0.0.1:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kivoni.local', password: '123' })
  });
  const login = await loginRes.json();
  const token = login.accessToken;
  console.log('Login:', loginRes.status);

  const res = await fetch('http://127.0.0.1:4000/products/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      ids: ["6628e69bd79b4e2fbcf01bc4"],
      changes: {
        priceSet: 15
      }
    })
  });
  console.log('Bulk:', res.status);
  console.log(await res.text());
}
test().catch(console.error);
