// lib/webflow.js
const BASE = 'https://api.webflow.com/v2';

const headers = () => ({
  Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`,
  'Content-Type': 'application/json',
  'accept-version': '1.0.0',
});

async function webflowRequest(path, method = 'GET', body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === null ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Webflow API error ${res.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function createItem(collectionId, fieldData) {
  return await webflowRequest(
    `/collections/${collectionId}/items`,
    'POST',
    { fieldData }
  );
}

async function updateItem(collectionId, itemId, fieldData) {
  return await webflowRequest(
    `/collections/${collectionId}/items/${itemId}`,
    'PATCH',
    { fieldData }
  );
}

async function publishItems(collectionId, itemIds) {
  await webflowRequest(
    `/collections/${collectionId}/items/publish`,
    'POST',
    { itemIds }
  );
}

async function getAllItems(collectionId) {
  const result = await webflowRequest(
    `/collections/${collectionId}/items`,
    'GET'
  );
  return result.items || [];
}

module.exports = { createItem, updateItem, publishItems, getAllItems };
