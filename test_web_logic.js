const axios = require('axios');

(async () => {
  try {
    const login = await axios.post("http://localhost:4000/auth/login", { email: "admin@lmfit.local", password: "ChangeMe123!" });
    const token = login.data.accessToken;
    
    const { data } = await axios.get("http://localhost:4000/suppliers", { 
      params: { page: 1, limit: 500 },
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log("Suppliers items length:", data.items ? data.items.length : "undefined");
    console.log("First item:", data.items && data.items[0]);
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
})();
