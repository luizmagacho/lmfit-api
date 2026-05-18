(async () => {
  try {
    const login = await fetch("http://localhost:4000/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@lmfit.local", password: "ChangeMe123!" })
    }).then(r => r.json());
    
    const token = login.accessToken;
    
    const res = await fetch("http://localhost:4000/suppliers?page=1&limit=500", { 
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    
    console.log("Suppliers items length:", res.items ? res.items.length : "undefined");
    console.log("First item:", res.items && res.items[0]);
  } catch (err) {
    console.error(err);
  }
})();
