import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';

/* ───────────────────────────────
   __dirname for ESM
   ─────────────────────────────── */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ───────────────────────────────
   Firebase Admin (env-based)
   ─────────────────────────────── */
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};

if (!serviceAccount.project_id) {
  console.error('❌ FIREBASE_PROJECT_ID is missing!');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
  });
  console.log('✅ Firebase initialized successfully');
}
const db = admin.firestore();

/* ───────────────────────────────
   Express
   ─────────────────────────────── */
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

// Serve /web
const WEB_DIR = path.join(__dirname, '../web');
app.use(express.static(WEB_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

/* ───────────────────────────────
   Helpers
   ─────────────────────────────── */
const toISO = (createdAt) => {
  try {
    if (!createdAt) return null;
    if (typeof createdAt === 'string') return createdAt;
    if (typeof createdAt?.toDate === 'function') return createdAt.toDate().toISOString();
    if (createdAt.seconds != null) {
      const d = new Date(createdAt.seconds * 1000 + Math.floor((createdAt.nanoseconds || 0) / 1e6));
      return d.toISOString();
    }
  } catch {}
  return null;
};
const asString = (v) => (v == null ? undefined : String(v));
const asBool = (v) => (typeof v === 'boolean' ? v : undefined);
const numOrUndef = (v) => {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const normTags = (tags) => {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
};

/* =======================================================================================
 * recentItems — TYPE-2: content.products
 * ======================================================================================= */
const COL_ITEMS = 'recentItems';

const normProductsArray = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p) => ({
      id: p?.id == null || p?.id === '' ? undefined : Number(p.id),
      brand: p?.brand == null ? undefined : String(p.brand),
      name: p?.name == null ? undefined : String(p.name),
      image: p?.image == null ? undefined : String(p.image),
      link: p?.link == null ? undefined : String(p.link),
      price: p?.price == null ? undefined : String(p.price),
    }))
    .map((p) => {
      const o = {};
      for (const [k, v] of Object.entries(p)) if (v !== undefined) o[k] = v;
      return o;
    });
};

function shapeItemDoc(d) {
  const data = d.data() || {};
  return {
    _id: d.id,
    category: data.category || '',
    description: data.description || '',
    image: data.image || '',
    thumbnail: data.thumbnail || '',
    instagramUrl: data.instagramUrl || '',
    isSaved: !!data.isSaved,
    tags: Array.isArray(data.tags) ? data.tags : normTags(data.tags),
    title: data.title || '',
    uploadDate: data.uploadDate || '',
    id: typeof data.id === 'string' ? data.id : undefined,
    createdAt: data.createdAt ? toISO(data.createdAt) : null,
    content: {
      ...(data.content && typeof data.content === 'object' ? data.content : {}),
      products: normProductsArray(data?.content?.products || []),
    },
    stats:
      data.stats && typeof data.stats === 'object'
        ? {
            views: numOrUndef(data.stats.views),
            saves: numOrUndef(data.stats.saves),
            shares: numOrUndef(data.stats.shares),
          }
        : undefined,
  };
}

function sanitizeItem(body = {}) {
  const out = {};
  const set = (k, v) => { if (v !== undefined) out[k] = v; };

  set('category', asString(body.category));
  set('description', asString(body.description));
  set('image', asString(body.image));
  set('thumbnail', asString(body.thumbnail));
  set('instagramUrl', asString(body.instagramUrl));
  set('uploadDate', asString(body.uploadDate));
  set('title', asString(body.title));
  set('isSaved', asBool(body.isSaved));
  set('tags', normTags(body.tags));
  if (typeof body.id === 'string' && body.id.trim()) set('id', body.id.trim());
  if (typeof body.createdAt === 'string' && body.createdAt.trim()) set('createdAt', body.createdAt.trim());

  let content = body.content && typeof body.content === 'object' ? { ...body.content } : {};
  const incomingProducts = Array.isArray(body?.content?.products)
    ? normProductsArray(body.content.products)
    : Array.isArray(body.products)
    ? normProductsArray(body.products)
    : undefined;
  if (incomingProducts !== undefined) content.products = incomingProducts;
  if (Object.keys(content).length) set('content', content);

  if (body.stats && typeof body.stats === 'object') {
    const s = {};
    if (!isNaN(Number(body.stats.views))) s.views = Number(body.stats.views);
    if (!isNaN(Number(body.stats.saves))) s.saves = Number(body.stats.saves);
    if (!isNaN(Number(body.stats.shares))) s.shares = Number(body.stats.shares);
    if (Object.keys(s).length) set('stats', s);
  }
  return out;
}

// LIST items
app.get('/api/recent-items', async (req, res) => {
  try {
    let { limit = '50', q, category, saved } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 100);

    let snap;
    try {
      let qy = db.collection(COL_ITEMS).orderBy('createdAt', 'desc');
      if (category) qy = qy.where('category', '==', category);
      if (saved === 'true' || saved === 'false') qy = qy.where('isSaved', '==', saved === 'true');
      snap = await qy.limit(lim).get();
    } catch {
      let qy = db.collection(COL_ITEMS).orderBy(admin.firestore.FieldPath.documentId(), 'desc');
      if (category) qy = qy.where('category', '==', category);
      if (saved === 'true' || saved === 'false') qy = qy.where('isSaved', '==', saved === 'true');
      snap = await qy.limit(lim).get();
    }

    let items = snap.docs.map(shapeItemDoc);
    if (q && q.trim()) {
      const needle = q.trim().toLowerCase();
      items = items.filter(
        (it) =>
          (it._id || '').toLowerCase().includes(needle) ||
          (it.title || '').toLowerCase().includes(needle) ||
          (it.description || '').toLowerCase().includes(needle) ||
          (Array.isArray(it.tags) && it.tags.join(',').toLowerCase().includes(needle))
      );
    }
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/recent-items/:id', async (req, res) => {
  try {
    const ref = db.collection(COL_ITEMS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, item: shapeItemDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/recent-items', async (req, res) => {
  try {
    const payload = sanitizeItem(req.body);
    if (!payload.createdAt) payload.createdAt = new Date().toISOString();
    const ref = await db.collection(COL_ITEMS).add(payload);
    const snap = await ref.get();
    res.status(201).json({ ok: true, id: ref.id, item: shapeItemDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.put('/api/recent-items/:id', async (req, res) => {
  try {
    const payload = sanitizeItem(req.body);
    await db.collection(COL_ITEMS).doc(req.params.id).set(payload, { merge: true });
    const snap = await db.collection(COL_ITEMS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, id: req.params.id, item: shapeItemDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/recent-items/:id', async (req, res) => {
  try {
    await db.collection(COL_ITEMS).doc(req.params.id).delete();
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/debug/peek', async (_req, res) => {
  try {
    const snap = await db
      .collection(COL_ITEMS)
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(10)
      .get();
    const items = snap.docs.map((d) => ({
      _id: d.id,
      createdAt: toISO(d.get('createdAt')),
      category: d.get('category') || null,
    }));
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* =======================================================================================
 * images — schema per your sample (now includes title, uploadedBy, views)
 * ======================================================================================= */
const COL_IMAGES = 'images';

function shapeImageDoc(d) {
  const data = d.data() || {};
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  return {
    _id: d.id,
    category: data.category || '',
    createdAt: data.createdAt ? toISO(data.createdAt) : null,
    description: data.description || '',
    title: data.title || '',
    id: typeof data.id === 'string' ? data.id : undefined,
    imageUrl: data.imageUrl || '',
    thumbnailUrl: data.thumbnailUrl || '',
    uploadDate: data.uploadDate || '',
    isPublic: !!data.isPublic,
    likes: numOrUndef(data.likes) ?? 0,
    saves: numOrUndef(data.saves) ?? 0,
    shares: numOrUndef(data.shares) ?? 0,
    views: numOrUndef(data.views) ?? 0,
    uploadedBy: data.uploadedBy || '',
    tags: Array.isArray(data.tags) ? data.tags : normTags(data.tags),
    metadata: {
      format: meta.format || '',
      size: numOrUndef(meta.size) ?? undefined,
      width: numOrUndef(meta.width) ?? undefined,
      height: numOrUndef(meta.height) ?? undefined,
    },
  };
}

function sanitizeImage(body = {}) {
  const out = {};
  const set = (k, v) => { if (v !== undefined) out[k] = v; };

  set('category', asString(body.category));
  set('createdAt', asString(body.createdAt)); // keep as ISO string
  set('description', asString(body.description));
  set('title', asString(body.title));
  set('id', typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined);
  set('imageUrl', asString(body.imageUrl));
  set('thumbnailUrl', asString(body.thumbnailUrl ?? body.imageUrl)); // fallback
  set('uploadDate', asString(body.uploadDate));
  set('isPublic', asBool(body.isPublic));
  set('likes', numOrUndef(body.likes));
  set('saves', numOrUndef(body.saves));
  set('shares', numOrUndef(body.shares));
  set('views', numOrUndef(body.views));
  set('uploadedBy', asString(body.uploadedBy));
  set('tags', normTags(body.tags));

  if (body.metadata && typeof body.metadata === 'object') {
    const m = {};
    if (typeof body.metadata.format === 'string') m.format = body.metadata.format;
    const size = numOrUndef(body.metadata.size);
    const width = numOrUndef(body.metadata.width);
    const height = numOrUndef(body.metadata.height);
    if (size !== undefined) m.size = size;
    if (width !== undefined) m.width = width;
    if (height !== undefined) m.height = height;
    if (Object.keys(m).length) set('metadata', m);
  }
  return out;
}

// LIST images
app.get('/api/images', async (req, res) => {
  try {
    let { limit = '50', q, category, pub } = req.query; // pub: "true"/"false"
    const lim = Math.min(parseInt(limit, 10) || 50, 100);

    let snap;
    try {
      let qy = db.collection(COL_IMAGES).orderBy('createdAt', 'desc');
      if (category) qy = qy.where('category', '==', category);
      if (pub === 'true' || pub === 'false') qy = qy.where('isPublic', '==', pub === 'true');
      snap = await qy.limit(lim).get();
    } catch {
      let qy = db.collection(COL_IMAGES).orderBy(admin.firestore.FieldPath.documentId(), 'desc');
      if (category) qy = qy.where('category', '==', category);
      if (pub === 'true' || pub === 'false') qy = qy.where('isPublic', '==', pub === 'true');
      snap = await qy.limit(lim).get();
    }

    let items = snap.docs.map(shapeImageDoc);
    if (q && q.trim()) {
      const needle = q.trim().toLowerCase();
      items = items.filter(
        (it) =>
          (it._id || '').toLowerCase().includes(needle) ||
          (it.title || '').toLowerCase().includes(needle) ||
          (it.description || '').toLowerCase().includes(needle) ||
          (Array.isArray(it.tags) && it.tags.join(',').toLowerCase().includes(needle))
      );
    }
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET image
app.get('/api/images/:id', async (req, res) => {
  try {
    const ref = db.collection(COL_IMAGES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, item: shapeImageDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// CREATE image
app.post('/api/images', async (req, res) => {
  try {
    const payload = sanitizeImage(req.body);
    if (!payload.title) {
      return res.status(400).json({ ok: false, error: 'title is required' });
    }
    if (!payload.createdAt) payload.createdAt = new Date().toISOString();
    const ref = await db.collection(COL_IMAGES).add(payload);
    const snap = await ref.get();
    res.status(201).json({ ok: true, id: ref.id, item: shapeImageDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// UPDATE image
app.put('/api/images/:id', async (req, res) => {
  try {
    const payload = sanitizeImage(req.body);
    await db.collection(COL_IMAGES).doc(req.params.id).set(payload, { merge: true });
    const snap = await db.collection(COL_IMAGES).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, id: req.params.id, item: shapeImageDoc(snap) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// DELETE image
app.delete('/api/images/:id', async (req, res) => {
  try {
    await db.collection(COL_IMAGES).doc(req.params.id).delete();
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Debug + seed for images
app.get('/api/debug/peek-images', async (_req, res) => {
  try {
    const snap = await db
      .collection(COL_IMAGES)
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(10)
      .get();
    const items = snap.docs.map((d) => ({
      _id: d.id,
      createdAt: toISO(d.get('createdAt')),
      category: d.get('category') || null,
    }));
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/dev/seed-image', async (_req, res) => {
  try {
    const sample = {
      category: 'hairstyle',
      createdAt: '2025-08-10T13:19:15.486Z',
      description: 'Romantic braided crown hairstyle with soft loose curls',
      id: 'images_1754831955486_wd8d9',
      imageUrl:
        'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&h=1000&fit=crop&crop=face',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&h=500&fit=crop&crop=face',
      isPublic: true,
      likes: 489,
      saves: 568,
      shares: 145,
      tags: ['braided crown', 'romantic', 'curls', 'wedding', 'boho'],
      title: 'Braided Crown with Loose Curls',
      uploadDate: '2024-02-01T13:45:00Z',
      uploadedBy: 'user_001',
      metadata: { format: 'jpg', height: 1000, width: 800, size: 1345678 },
    };
    const ref = await db.collection(COL_IMAGES).add(sample);
    res.status(201).json({ ok: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Get all categories
app.get('/api/categories', async (_req, res) => {
  try {
    const snapshot = await db.collection('categories').get();
    const categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, categories });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add category
app.post('/api/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const docRef = await db.collection('categories').add({ name });
    res.json({ success: true, id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Edit category
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    await db.collection('categories').doc(id).update({ name });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete category
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('categories').doc(id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve the HTML page
app.get('/categories', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/add-category.html'));
});

// ---------- CREATE ----------

// ---------- LIST ALL GROUPS ----------
app.get('/api/basics', async (_req, res) => {
  try {
    const snap = await db.collection('basics').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// ---------- CREATE / APPEND (100 % safe) ----------
app.post('/api/basics/:groupId/items', async (req, res) => {
  try {
    const { groupId } = req.params;
    const newItem = { ...req.body, id: req.body.id || Date.now().toString() };

    const groupRef = db.collection('basics').doc(groupId);

    // Create document only if it doesn’t exist, **do NOT set items: []**
    await groupRef.set({}, { merge: true });

    // Atomically append the new item
    await groupRef.update({
      items: admin.firestore.FieldValue.arrayUnion(newItem)
    });

    res.json(newItem);
  } catch (e) {
    console.error('CREATE ERROR', e);
    res.status(500).json({ error: 'Create failed' });
  }
});
// ---------- UPDATE PRODUCT ----------
app.put('/api/basics/:groupId/items/:itemId', async (req, res) => {
  try {
    const { groupId, itemId } = req.params;
    const groupRef = db.collection('basics').doc(groupId);
    const doc = await groupRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Group not found' });

    let items = doc.data().items || [];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    items[idx] = { ...items[idx], ...req.body };
    await groupRef.update({ items });

    res.json(items[idx]);
  } catch (e) {
    console.error('UPDATE ERROR', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ---------- DELETE PRODUCT ----------
app.delete('/api/basics/:groupId/items/:itemId', async (req, res) => {
  try {
    const { groupId, itemId } = req.params;
    const groupRef = db.collection('basics').doc(groupId);
    const doc = await groupRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Group not found' });

    const items = doc.data().items || [];
    const filtered = items.filter(i => i.id !== itemId);
    await groupRef.update({ items: filtered });

    res.json({ deleted: true });
  } catch (e) {
    console.error('DELETE ERROR', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/*  recreate COLLECTION  */
// ---------- LIST ALL GROUPS ----------
app.get('/api/recreate', async (_req, res) => {
  try {
    const snap = await db.collection('recreate').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// ---------- CREATE / APPEND ----------
app.post('/api/recreate/:groupId/items', async (req, res) => {
  try {
    const { groupId } = req.params;
    const newItem = { ...req.body, id: req.body.id || Date.now().toString() };
    const groupRef = db.collection('recreate').doc(groupId);

    await groupRef.set({}, { merge: true });
    await groupRef.update({ items: admin.firestore.FieldValue.arrayUnion(newItem) });

    res.json(newItem);
  } catch (e) {
    console.error('CREATE ERROR', e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// ---------- UPDATE ----------
app.put('/api/recreate/:groupId/items/:itemId', async (req, res) => {
  try {
    const { groupId, itemId } = req.params;
    const groupRef = db.collection('recreate').doc(groupId);
    const doc = await groupRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Group not found' });

    let items = doc.data().items || [];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    items[idx] = { ...items[idx], ...req.body };
    await groupRef.update({ items });

    res.json(items[idx]);
  } catch (e) {
    console.error('UPDATE ERROR', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ---------- DELETE ----------
app.delete('/api/recreate/:groupId/items/:itemId', async (req, res) => {
  try {
    const { groupId, itemId } = req.params;
    const groupRef = db.collection('recreate').doc(groupId);
    const doc = await groupRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Group not found' });

    const items = doc.data().items || [];
    const filtered = items.filter(i => i.id !== itemId);
    await groupRef.update({ items: filtered });

    res.json({ deleted: true });
  } catch (e) {
    console.error('DELETE ERROR', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/* ===========================
   AI CARDS COLLECTION (CRUD)
   =========================== */
const COL_AICARDS = 'aiCards';

// shape helper (converts Firestore Timestamp/ISO to ISO)
function shapeAiCardDoc(d) {
  const data = d.data() || {};
  return {
    id: d.id,
    title: data.title || '',
    image: data.image || data.imageUrl || '',
    prompt: data.prompt || '',
    link: data.link || '',
    gender: data.gender || 'Unisex',
    category: data.category || d.id, // fallback to doc id as category
    createdAt: data.createdAt ? toISO(data.createdAt) : null,
  };
}

// GET all cards
app.get('/api/aicards', async (_req, res) => {
  try {
    let snap;
    try {
      // Prefer to order by createdAt if present
      snap = await db.collection(COL_AICARDS).orderBy('createdAt', 'desc').get();
    } catch {
      // Fallback: order by doc ID (no index needed)
      snap = await db.collection(COL_AICARDS)
        .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
        .get();
    }
    const items = snap.docs.map(shapeAiCardDoc);
    res.json(items); // return an array for simpler front-end
  } catch (err) {
    console.error('Error fetching aiCards:', err);
    res.status(500).json({ error: 'Failed to fetch aiCards' });
  }
});

// GET one card by id (doc id)
app.get('/api/aicards/:id', async (req, res) => {
  try {
    const ref = db.collection(COL_AICARDS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Not found' });
    res.json(shapeAiCardDoc(snap));
  } catch (err) {
    console.error('Error fetching card:', err);
    res.status(500).json({ error: 'Failed to fetch card' });
  }
});

// CREATE card
app.post('/api/aicards', async (req, res) => {
  try {
    const payload = {
      title: String(req.body.title || ''),
      image: String(req.body.image || ''),
      prompt: String(req.body.prompt || ''),
      link: String(req.body.link || ''),
      gender: String(req.body.gender || 'Unisex'),
      category: String(req.body.category || '').trim(),
      // Use server timestamp; shapeAiCardDoc+toISO already handle Timestamp or ISO
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Minimal validation
    if (!payload.title) return res.status(400).json({ error: 'title is required' });
    if (!payload.category) return res.status(400).json({ error: 'category is required' });

    const ref = await db.collection(COL_AICARDS).add(payload);
    const snap = await ref.get();
    res.status(201).json(shapeAiCardDoc(snap));
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// UPDATE card
app.put('/api/aicards/:id', async (req, res) => {
  try {
    const ref = db.collection(COL_AICARDS).doc(req.params.id);
    const prev = await ref.get();
    if (!prev.exists) return res.status(404).json({ error: 'Not found' });

    // Keep original createdAt if not provided
    const updates = {
      ...(req.body.title != null ? { title: String(req.body.title) } : {}),
      ...(req.body.image != null ? { image: String(req.body.image) } : {}),
      ...(req.body.prompt != null ? { prompt: String(req.body.prompt) } : {}),
      ...(req.body.link != null ? { link: String(req.body.link) } : {}),
      ...(req.body.gender != null ? { gender: String(req.body.gender) } : {}),
      ...(req.body.category != null ? { category: String(req.body.category) } : {}),
      createdAt: prev.data().createdAt || admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(updates, { merge: true });
    const fresh = await ref.get();
    res.json(shapeAiCardDoc(fresh));
  } catch (err) {
    console.error('Error updating card:', err);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// DELETE card
app.delete('/api/aicards/:id', async (req, res) => {
  try {
    await db.collection(COL_AICARDS).doc(req.params.id).delete();
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Route to add JSON data dynamically
app.post("/addJsonData", async (req, res) => {
  try {
    const { collection, docId, data } = req.body;

    if (!collection || !data) {
      return res.status(400).json({ success: false, error: "Collection and data are required!" });
    }

    let docRef;
    if (docId && docId.trim() !== "") {
      // Add with custom Document ID
      docRef = db.collection(collection).doc(docId);
      await docRef.set(data, { merge: true });
    } else {
      // Auto-generate Document ID
      docRef = await db.collection(collection).add(data);
    }

    res.json({ success: true, id: docRef.id || docId });
  } catch (err) {
    console.error("Error adding data:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});



/* ───────────────────────────────
   Test & health
   ─────────────────────────────── */
app.get('/api/test', async (_req, res) => {
  try {
    const snapshot = await db.collection('test').limit(1).get();
    const data = snapshot.docs.map((doc) => doc.data());
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));


/* ───────────────────────────────
   Start
   ─────────────────────────────── */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
