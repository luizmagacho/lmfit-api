fetch("http://localhost:4000/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@lmfit.local", password: "ChangeMe123!" })
}).then(r => r.json()).then(auth => {
  return fetch("http://localhost:4000/purchases?limit=2", {
    headers: { Authorization: "Bearer " + auth.accessToken }
  });
}).then(r => r.json()).then(data => console.log(JSON.stringify(data.items, null, 2)));
