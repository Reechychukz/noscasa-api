// lib/webflow.js
const axios = require('axios');

const BASE = 'https://api.webflow.com/v2';

const headers = () => ({
  Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`,
  'Content-Type': 'application/json',
  'accept-version': '1.0.0',
});

async function createItem(collectionId, fieldData) {
  const res = await axios.post(
    `${BASE}/collections/${collectionId}/items`,
    { fieldData },
    { headers: headers() }
  );
  return res.data;
}

async function updateItem(collectionId, itemId, fieldData) {
  const res = await axios.patch(
    `${BASE}/collections/${collectionId}/items/${itemId}`,
    { fieldData },
    { headers: headers() }
  );
  return res.data;
}

async function publishItems(collectionId, itemIds) {
  await axios.post(
    `${BASE}/collections/${collectionId}/items/publish`,
    { itemIds },
    { headers: headers() }
  );
}

async function getAllItems(collectionId) {
  const res = await axios.get(
    `${BASE}/collections/${collectionId}/items`,
    { headers: headers() }
  );
  return res.data.items || [];
}

module.exports = { createItem, updateItem, publishItems, getAllItems };
