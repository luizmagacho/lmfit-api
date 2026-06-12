async function test() {
  const loginRes = await fetch('http://127.0.0.1:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@lmfit.local', password: 'password', tenantSlug: 'kivoni' })
  });
  const login = await loginRes.json();
  const token = login.accessToken;
  console.log('Login:', loginRes.status);
  if (!token) {
    console.error('No token:', login);
    return;
  }

  const res = await fetch('http://127.0.0.1:4000/production/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      name: "Test Batch",
      sku: "",
      batchQty: 10,
      inputs: [], // Fixed empty input
      status: "Planejado"
    })
  });
  console.log('Post:', res.status);
  console.log(await res.text());
}
test().catch(console.error);
