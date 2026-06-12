async function test() {
  const beforeRes = await fetch('http://127.0.0.1:4000/public/tenants/kivoni');
  const before = await beforeRes.json();
  console.log('Before:', before.branding);

  const loginRes = await fetch('http://127.0.0.1:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kivoni.local', password: '123' })
  });
  const login = await loginRes.json();
  const token = login.accessToken;
  const tenantId = login.user.tenantId;

  const newColor = '#' + Math.floor(Math.random()*16777215).toString(16);
  console.log('Changing color to:', newColor);
  
  await fetch(`http://127.0.0.1:4000/tenants/${tenantId}/branding`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ primaryColor: newColor })
  });

  const afterRes = await fetch('http://127.0.0.1:4000/public/tenants/kivoni');
  const after = await afterRes.json();
  console.log('After:', after.branding);
}

test().catch(console.error);
