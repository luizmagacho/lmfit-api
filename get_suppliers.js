fetch("http://localhost:4000/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@lmfit.local", password: "ChangeMe123!" })
}).then(r => r.json()).then(auth => {
  return fetch("http://localhost:4000/suppliers?limit=10", {
    headers: { Authorization: "Bearer " + auth.accessToken }
  });
}).then(r => r.json()).then(data => console.log(JSON.stringify(data, null, 2)));
