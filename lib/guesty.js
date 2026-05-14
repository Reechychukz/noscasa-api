// lib/guesty.js
const axios = require('axios');

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiry) return _token;

  const res = await axios.post(
    'https://open-api.guesty.com/oauth2/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: process.env.GUESTY_CLIENT_ID,
      client_secret: process.env.GUESTY_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  _token = res.data.access_token;
  _tokenExpiry = now + (res.data.expires_in - 300) * 1000;
  return _token;
}

async function guesty(method, path, data = null, params = {}) {
  const token = await getToken();
  const res = await axios({
    method,
    url: `https://open-api.guesty.com/v1${path}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    params,
    data,
  });
  return res.data;
}

module.exports = { guesty };