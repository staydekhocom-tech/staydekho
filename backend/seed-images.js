// Run: node backend/seed-images.js
// Auto-generates room & bathroom categories based on each property's beds/bathrooms
const db = require('./db/database');

// ── Image pools (cycled for each room/bathroom slot) ──────────────────────────
const ROOM_POOL = [
  'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1615460549969-36fa19521a4f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1631049421450-348ccd7f8949?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1598928636135-d146006ff4be?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=1200&q=80',
];
const BATH_POOL = [
  'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1620626011761-996317702149?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1604709177225-055f99402ea3?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=1200&q=80',
];

// ── Per-property: Exterior + common area images ───────────────────────────────
const PROP_EXTRAS = {
  1: { // Lakeside Villa - Udaipur
    exterior: [
      'https://images.unsplash.com/photo-1613977257365-aaae5a9817ff?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=1200&q=80', cat: 'Kitchen' },
      { url: 'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?auto=format&fit=crop&w=1200&q=80', cat: 'Pool' },
    ],
  },
  2: { // Heritage Haveli - Jaipur
    exterior: [
      'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=1200&q=80', cat: 'Dining' },
    ],
  },
  3: { // Pool Villa Udaipur
    exterior: [
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1613977257365-aaae5a9817ff?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?auto=format&fit=crop&w=1200&q=80', cat: 'Pool' },
      { url: 'https://images.unsplash.com/photo-1533090481720-856c6e3c1fdc?auto=format&fit=crop&w=1200&q=80', cat: 'Pool' },
    ],
  },
  4: { // Mountain Retreat - Mussoorie
    exterior: [
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=1200&q=80', cat: 'Kitchen' },
    ],
  },
  5: { // Beachside Bungalow - Goa
    exterior: [
      'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?auto=format&fit=crop&w=1200&q=80', cat: 'Pool' },
    ],
  },
  6: { // Royal Fort Stay - Jodhpur
    exterior: [
      'https://images.unsplash.com/photo-1561361058-c24cecae35ca?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80',
    ],
    common: [
      { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', cat: 'Lounge' },
      { url: 'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=1200&q=80', cat: 'Dining' },
      { url: 'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?auto=format&fit=crop&w=1200&q=80', cat: 'Pool' },
    ],
  },
};

// ── Build images for a property ───────────────────────────────────────────────
function buildImages(id, beds, bathrooms) {
  const extras = PROP_EXTRAS[id];
  const images = [];

  // Exterior (2 images)
  extras.exterior.forEach(url => images.push({ url, cat: 'Exterior' }));

  // One image per room: Room 1 … Room N (N = beds/BHK)
  for (let i = 0; i < beds; i++) {
    images.push({ url: ROOM_POOL[i % ROOM_POOL.length], cat: `Room ${i + 1}` });
  }

  // One image per bathroom: Bathroom 1 … Bathroom M (M = bathrooms)
  for (let i = 0; i < bathrooms; i++) {
    images.push({ url: BATH_POOL[i % BATH_POOL.length], cat: `Bathroom ${i + 1}` });
  }

  // Lounge / Kitchen / Pool / Dining
  extras.common.forEach(item => images.push(item));

  return images;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const properties = db.prepare('SELECT id, name, beds, bathrooms FROM properties ORDER BY id').all();
let updated = 0;

for (const p of properties) {
  const images = buildImages(p.id, p.beds, p.bathrooms);
  db.prepare('UPDATE properties SET images = ? WHERE id = ?')
    .run(JSON.stringify(images), p.id);

  const cats = [...new Set(images.map(i => i.cat))];
  console.log(`✅ Property ${p.id} (${p.name}) — ${p.beds} BHK / ${p.bathrooms} bath → ${images.length} images`);
  console.log(`   Categories: ${cats.join(' · ')}`);
  updated++;
}

console.log(`\nDone! Updated ${updated} properties.`);
