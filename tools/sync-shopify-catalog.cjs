#!/usr/bin/env node

/**
 * Sync Holder AR barcode records with the current public Shopify catalog.
 *
 * Barcode EANs and AR display names remain authoritative in catalog.json.
 * Only Shopify handles and product/variant URLs are refreshed.
 *
 * Usage:
 *   node tools/sync-shopify-catalog.cjs          # check only
 *   node tools/sync-shopify-catalog.cjs --write  # update catalog.json
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'catalog.json');
const SHOPIFY_BASE = 'https://www.acosmeticstory.com';
const COLLECTION_LIMIT = 250;
const WRITE = process.argv.includes('--write');

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError && lastError.message}`);
}

function numberedTitle(prefix, value) {
  return `${prefix} ${String(value).padStart(2, '0')}`;
}

function ensureUniqueEans(products) {
  const seen = new Set();
  const duplicates = [];
  for (const product of products) {
    if (seen.has(product.ean13)) duplicates.push(product.ean13);
    seen.add(product.ean13);
  }
  if (duplicates.length) {
    throw new Error(`Duplicate EANs: ${[...new Set(duplicates)].join(', ')}`);
  }
}

function updateRecord(record, handle, url, changes) {
  if (record.shopifyHandle === handle && record.shopifyUrl === url) return;
  changes.push({
    name: record.name,
    fromHandle: record.shopifyHandle || '',
    toHandle: handle,
    fromUrl: record.shopifyUrl || '',
    toUrl: url
  });
  record.shopifyHandle = handle;
  record.shopifyUrl = url;
}

async function main() {
  const document = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const products = document.products;
  if (!Array.isArray(products)) throw new Error('catalog.json products array is missing');
  ensureUniqueEans(products);

  const cacheBust = Date.now();
  const [juResponse, saiResponse] = await Promise.all([
    fetchJson(`${SHOPIFY_BASE}/collections/ju/products.json?limit=${COLLECTION_LIMIT}&v=${cacheBust}`),
    fetchJson(`${SHOPIFY_BASE}/collections/sai/products.json?limit=${COLLECTION_LIMIT}&v=${cacheBust}`)
  ]);
  const juProducts = juResponse.products || [];
  const saiProducts = saiResponse.products || [];
  const juByTitle = new Map(juProducts.map(product => [product.title, product]));
  const saiByTitle = new Map(saiProducts.map(product => [product.title, product]));
  const changes = [];
  const missing = [];
  let juCount = 0;
  let saiCount = 0;

  for (const record of products) {
    const juMatch = /^Ju\s+(\d+)$/i.exec(record.name || '');
    if (juMatch) {
      juCount++;
      const title = numberedTitle('Ju', Number(juMatch[1]));
      const shopifyProduct = juByTitle.get(title);
      if (!shopifyProduct) {
        missing.push(`${record.name}: Shopify product ${title} not found`);
        continue;
      }
      if (!Array.isArray(shopifyProduct.images) || !shopifyProduct.images.length) {
        missing.push(`${record.name}: ${title} has no Shopify product image`);
        continue;
      }
      updateRecord(
        record,
        shopifyProduct.handle,
        `${SHOPIFY_BASE}/products/${shopifyProduct.handle}`,
        changes
      );
      continue;
    }

    const saiMatch = /^Sai-([sm])\s+(\d+)$/i.exec(record.name || '');
    if (!saiMatch) continue;
    saiCount++;
    const size = saiMatch[1].toUpperCase();
    const title = numberedTitle('Sai', Number(saiMatch[2]));
    const shopifyProduct = saiByTitle.get(title);
    if (!shopifyProduct) {
      missing.push(`${record.name}: Shopify product ${title} not found`);
      continue;
    }
    const variant = (shopifyProduct.variants || []).find(item => item.title === size);
    if (!variant) {
      missing.push(`${record.name}: ${title} variant ${size} not found`);
      continue;
    }
    if (!Array.isArray(shopifyProduct.images) || !shopifyProduct.images.length) {
      missing.push(`${record.name}: ${title} has no Shopify product image`);
      continue;
    }
    updateRecord(
      record,
      shopifyProduct.handle,
      `${SHOPIFY_BASE}/products/${shopifyProduct.handle}?variant=${variant.id}`,
      changes
    );
  }

  if (juCount !== 50 || saiCount !== 100) {
    missing.push(`Unexpected catalog coverage: Ju=${juCount}, Sai=${saiCount}`);
  }
  if (missing.length) {
    console.error('Catalog sync stopped because mappings are incomplete:');
    missing.forEach(message => console.error(`- ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Shopify collections: Ju=${juProducts.length}, Sai=${saiProducts.length}`);
  console.log(`Barcode catalog checked: Ju=${juCount}, Sai=${saiCount}`);
  console.log(`Records requiring update: ${changes.length}`);

  if (!changes.length) {
    console.log('catalog.json already matches Shopify.');
    return;
  }

  changes.slice(0, 12).forEach(change => {
    console.log(`- ${change.name}: ${change.fromHandle || '(empty)'} -> ${change.toHandle}`);
  });
  if (changes.length > 12) console.log(`- ... and ${changes.length - 12} more`);

  if (!WRITE) {
    console.error('Run with --write to apply these catalog changes.');
    process.exitCode = 2;
    return;
  }

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Updated ${path.relative(ROOT, CATALOG_PATH)}.`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
