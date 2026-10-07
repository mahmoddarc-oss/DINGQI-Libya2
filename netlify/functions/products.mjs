import { getStore } from '@netlify/blobs';

const getBlobStore = () => getStore({ name: 'dingqi-libya', consistency: 'strong' });
const PASSWORD = '2005515';
const key = (x) => `data/${x}`;

async function getJSON(k, fallback) {
  const store = getBlobStore();
  return (await store.get(key(k), { type: 'json', consistency: 'strong' })) ?? fallback;
}

async function setJSON(k, value) {
  const store = getBlobStore();
  await store.setJSON(key(k), value);
  return value;
}

function authorized(req) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  try {
    const raw = h.slice(7);
    const decoded = typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString('binary');
    return decodeURIComponent(escape(decoded)) === PASSWORD;
  } catch {
    return false;
  }
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'cache-control': 'no-store'
    }
  });
}

function makeId() {
  return crypto.randomUUID();
}

function normalizeProduct(b, existing = {}) {
  const now = new Date().toISOString();
  const rawSale = b.salePrice === null || b.salePrice === '' || b.salePrice === undefined ? null : Number(b.salePrice);
  const images = Array.isArray(b.images)
    ? b.images.filter(Boolean).slice(0, 6)
    : (b.image ? [b.image] : (existing.images || []));

  return {
    ...existing,
    id: b.id || existing.id || makeId(),
    name: String(b.name ?? existing.name ?? '').trim(),
    price: Math.max(0, Number(b.price ?? existing.price ?? 0)),
    cost: Math.max(0, Number(b.cost ?? existing.cost ?? 0)),
    salePrice: rawSale === null || Number.isNaN(rawSale) ? null : Math.max(0, rawSale),
    stock: Math.max(0, Math.floor(Number(b.stock ?? existing.stock ?? 0))),
    description: String(b.description ?? existing.description ?? ''),
    category: String(b.category ?? existing.category ?? 'معدات ورش'),
    active: b.active !== undefined ? !!b.active : existing.active !== false,
    featured: b.featured !== undefined ? !!b.featured : !!existing.featured,
    offer: b.offer !== undefined ? !!b.offer : !!existing.offer,
    images,
    image: b.image !== undefined ? String(b.image || '') : (existing.image || images[0] || ''),
    createdAt: existing.createdAt || b.createdAt || now,
    updatedAt: now
  };
}

export default async (req) => {
  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      return response(await getJSON('products', []));
    }

    if (!authorized(req)) return response({ error: 'Unauthorized' }, 401);

    if (req.method === 'POST') {
      const b = await req.json();
      let products = await getJSON('products', []);
      const existing = b.id ? products.find((x) => x.id === b.id) : undefined;
      const p = normalizeProduct(b, existing || {});

      if (!p.name) return response({ error: 'اسم المنتج مطلوب' }, 400);
      if (!Number.isFinite(p.price) || !Number.isFinite(p.cost) || !Number.isFinite(p.stock)) {
        return response({ error: 'قيم السعر أو المخزون غير صالحة' }, 400);
      }

      const i = products.findIndex((x) => x.id === p.id);
      if (i >= 0) products[i] = p;
      else products.push(p);
      await setJSON('products', products);
      return response(p);
    }

    // تعديل المخزون فقط: delta لإضافة/خصم كمية، أو stock لتعيين كمية محددة.
    if (req.method === 'PATCH') {
      const b = await req.json();
      if (!b.id) return response({ error: 'معرّف المنتج مطلوب' }, 400);

      const products = await getJSON('products', []);
      const i = products.findIndex((x) => x.id === b.id);
      if (i < 0) return response({ error: 'المنتج غير موجود' }, 404);

      const oldStock = Math.max(0, Math.floor(Number(products[i].stock || 0)));
      let newStock;
      let reason = String(b.reason || 'تعديل يدوي').trim() || 'تعديل يدوي';

      if (b.stock !== undefined) {
        newStock = Math.max(0, Math.floor(Number(b.stock)));
      } else if (b.delta !== undefined) {
        newStock = Math.max(0, oldStock + Math.floor(Number(b.delta)));
      } else {
        return response({ error: 'أرسل stock أو delta' }, 400);
      }

      if (!Number.isFinite(newStock)) return response({ error: 'كمية غير صالحة' }, 400);

      products[i] = { ...products[i], stock: newStock, updatedAt: new Date().toISOString() };
      await setJSON('products', products);

      const log = await getJSON('inventoryLog', []);
      log.unshift({
        id: makeId(),
        productId: products[i].id,
        productName: products[i].name,
        before: oldStock,
        after: newStock,
        delta: newStock - oldStock,
        reason,
        createdAt: new Date().toISOString()
      });
      await setJSON('inventoryLog', log.slice(0, 500));

      return response(products[i]);
    }

    if (req.method === 'DELETE') {
      const products = await getJSON('products', []);
      const id = url.searchParams.get('id');
      const i = products.findIndex((x) => x.id === id);
      if (i < 0) return response({ error: 'Not found' }, 404);
      products.splice(i, 1);
      await setJSON('products', products);
      return response({ ok: true });
    }

    return response({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error(e);
    return response({ error: e.message || 'Server error' }, 500);
  }
};
