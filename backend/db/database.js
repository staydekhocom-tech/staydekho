const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'staydekho.db');
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT    NOT NULL UNIQUE,
      phone      TEXT,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS properties (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      location    TEXT    NOT NULL,
      price       INTEGER NOT NULL,
      guests      INTEGER NOT NULL DEFAULT 10,
      beds        INTEGER NOT NULL DEFAULT 4,
      bathrooms   INTEGER NOT NULL DEFAULT 3,
      description TEXT,
      amenities   TEXT,
      images      TEXT    DEFAULT '[]',
      status      TEXT    NOT NULL DEFAULT 'Active',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id),
      property_id         INTEGER NOT NULL REFERENCES properties(id),
      guest_name          TEXT    NOT NULL,
      guest_email         TEXT    NOT NULL,
      guest_phone         TEXT,
      checkin             TEXT    NOT NULL,
      checkout            TEXT    NOT NULL,
      guests              INTEGER NOT NULL DEFAULT 1,
      nights              INTEGER NOT NULL DEFAULT 1,
      amount              INTEGER NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'pending',
      razorpay_order_id   TEXT,
      razorpay_payment_id TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otps (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      phone      TEXT    NOT NULL,
      otp        TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id          INTEGER NOT NULL REFERENCES bookings(id),
      razorpay_order_id   TEXT    NOT NULL,
      razorpay_payment_id TEXT,
      razorpay_signature  TEXT,
      amount              INTEGER NOT NULL,
      currency            TEXT    NOT NULL DEFAULT 'INR',
      status              TEXT    NOT NULL DEFAULT 'created',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      booking_id  INTEGER REFERENCES bookings(id),
      rating      INTEGER NOT NULL DEFAULT 5,
      text        TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guest_reels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      location   TEXT    NOT NULL DEFAULT '',
      stay       TEXT    NOT NULL,
      quote      TEXT    DEFAULT '',
      stars      INTEGER NOT NULL DEFAULT 5,
      video_url  TEXT    DEFAULT '',
      poster_url TEXT    DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // New tables (safe to run on each start)
  db.exec(`
    CREATE TABLE IF NOT EXISTS wishlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, property_id)
    );

    CREATE TABLE IF NOT EXISTS contact_submissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      phone      TEXT,
      subject    TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add columns that may not exist in older DBs (safe to run on each start)
  for (const sql of [
    "ALTER TABLE properties ADD COLUMN checkin_time  TEXT DEFAULT '2:00 PM'",
    "ALTER TABLE properties ADD COLUMN checkout_time TEXT DEFAULT '11:00 AM'",
    "ALTER TABLE properties ADD COLUMN rules         TEXT DEFAULT '[]'",
    "ALTER TABLE properties ADD COLUMN addons        TEXT DEFAULT '[]'",
    "ALTER TABLE properties ADD COLUMN map_url       TEXT DEFAULT ''",
    "ALTER TABLE properties ADD COLUMN brochure_url  TEXT DEFAULT ''",
    "ALTER TABLE properties ADD COLUMN ical_url      TEXT DEFAULT ''",
    "ALTER TABLE properties ADD COLUMN ical_uid      TEXT DEFAULT ''",
    "ALTER TABLE properties ADD COLUMN fomo_bookings    INTEGER DEFAULT NULL",
    "ALTER TABLE properties ADD COLUMN fomo_viewers     INTEGER DEFAULT NULL",
    "ALTER TABLE properties ADD COLUMN fomo_enabled     INTEGER DEFAULT 1",
    "ALTER TABLE properties ADD COLUMN property_types   TEXT    DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''",
  ]) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Site settings (key/value JSON) — drives dynamic hero, stats overrides, contact info
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ical_blocks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source       TEXT    NOT NULL DEFAULT 'external',
      external_uid TEXT,
      summary      TEXT,
      start_date   TEXT    NOT NULL,
      end_date     TEXT    NOT NULL,
      synced_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(property_id, external_uid)
    );

    CREATE TABLE IF NOT EXISTS ical_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url           TEXT    NOT NULL,
      label         TEXT    DEFAULT '',
      last_synced   TEXT,
      last_error    TEXT
    );

    CREATE TABLE IF NOT EXISTS travel_guides (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slug       TEXT    NOT NULL UNIQUE,
      city       TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      summary    TEXT    DEFAULT '',
      body       TEXT    DEFAULT '',
      hero_image TEXT    DEFAULT '',
      published  INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS addon_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id  INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
      addon       TEXT    NOT NULL,
      note        TEXT    DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'pending',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS date_prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      date        TEXT    NOT NULL,
      price       INTEGER,
      blocked     INTEGER NOT NULL DEFAULT 0,
      note        TEXT    DEFAULT '',
      UNIQUE(property_id, date)
    );

    CREATE TABLE IF NOT EXISTS blog_posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      slug         TEXT    NOT NULL UNIQUE,
      excerpt      TEXT    DEFAULT '',
      body         TEXT    DEFAULT '',
      category     TEXT    DEFAULT 'General',
      cover_image  TEXT    DEFAULT '',
      author       TEXT    DEFAULT 'StayDekho Team',
      published    INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      updated_at   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed default site settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM site_settings').get().c;
  if (settingsCount === 0) {
    const defaults = {
      hero_eyebrow:   'Discover Premium Stays',
      hero_headline:  'Your Group Deserves<br/>a <em>Proper</em> Stay',
      hero_sub:       'Handpicked villas, pool homes &amp; heritage retreats — every stay directly managed by us.',
      hero_slides: JSON.stringify([
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=80',
        'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=1800&q=80',
        'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1800&q=80',
        'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1800&q=80',
        'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1800&q=80',
      ]),
      stats_villas_override:       '',
      stats_destinations_override: '',
      stats_guests_override:       '',
      stats_rating_override:       '',
      contact_email:               'info@staydekho.com',
      contact_phone:               '+91 87699 05983',
      contact_safety_email:        'safety@staydekho.com',
      social_instagram:            'https://www.instagram.com/stay_dekho/',
      social_twitter:              'https://twitter.com/staydekho',
      social_whatsapp:             'https://wa.me/918769905983',
    };
    const ins = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?)');
    Object.entries(defaults).forEach(([k, v]) => ins.run(k, v));
    console.log('✅ Site settings seeded');
  }

  // Seed sample travel guides
  const guideCount = db.prepare('SELECT COUNT(*) as c FROM travel_guides').get().c;
  if (guideCount === 0) {
    const ig = db.prepare('INSERT INTO travel_guides (slug,city,title,summary,body,hero_image,published) VALUES (?,?,?,?,?,?,1)');
    [
      ['udaipur-travel-guide', 'Udaipur', 'Udaipur Travel Guide: The City of Lakes',
        'Everything you need to know to plan a perfect trip to Udaipur — from palaces and boat rides to the best time to visit.',
        `Udaipur, often called the "City of Lakes", is one of Rajasthan's most romantic destinations. Set around the shimmering Pichola Lake and overlooked by the majestic City Palace, it's a place that feels like a living painting.

BEST TIME TO VISIT
October to March is ideal — the weather is cool and pleasant. Summers (April–June) are very hot, while the monsoon (July–September) brings lush greenery but some flooding.

TOP ATTRACTIONS
• City Palace — the largest palace complex in Rajasthan, with stunning views over Lake Pichola
• Lake Pichola — take a boat ride to Jag Mandir and Jag Niwas (Lake Palace)
• Sajjangarh (Monsoon Palace) — hilltop fort with panoramic views, magical at sunset
• Jagdish Temple — ornate 17th-century Hindu temple in the heart of the old city
• Fateh Sagar Lake — a peaceful lake perfect for an evening stroll
• Shilpgram — rural arts and crafts village showcasing Rajasthani culture

WHERE TO EAT
Udaipur's rooftop restaurants overlooking the lake are legendary. Try Ambrai Ghat for lakeside dining, or the many cafes lining the old city lanes for local dal baati churma.

GETTING THERE
Udaipur has its own airport (UDR) with flights from Delhi, Mumbai and Jaipur. By train, the Mewar Express from Delhi is popular. The city is also well-connected by road.

LOCAL TIPS
• Hire a local guide for City Palace — the history is rich and easy to miss without context
• Book a heritage villa stay for the full Rajput experience
• The old city lanes are best explored on foot in the early morning`,
        'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&q=80'],

      ['jaipur-travel-guide', 'Jaipur', 'Jaipur Travel Guide: The Pink City',
        'Forts, palaces, bazaars and flavours — your complete guide to exploring the Pink City of Rajasthan.',
        `Jaipur, the capital of Rajasthan, earns its nickname "Pink City" from the terracotta-pink buildings that line its old city streets. It's a city of grand forts, vibrant markets and world-class cuisine.

BEST TIME TO VISIT
October to February is the best time — cool, dry and perfect for sightseeing. The Jaipur Literature Festival in January draws visitors from around the world.

TOP ATTRACTIONS
• Amber Fort — the most visited site in Jaipur, a majestic hillside fort with elephant rides and stunning mirror work
• Hawa Mahal (Palace of Winds) — the iconic five-storey pink façade is one of India's most photographed buildings
• City Palace — still home to the royal family, with museums and courtyards open to visitors
• Jantar Mantar — an 18th-century astronomical observatory and UNESCO World Heritage Site
• Nahargarh Fort — great for sunset views over the city

SHOPPING
Jaipur is India's gem and jewellery capital. Johari Bazaar for jewellery, Bapu Bazaar for textiles and Tripolia Bazaar for lac bangles are must-visits.

WHERE TO EAT
Try laal maas (red mutton curry), dal baati churma and ghevar (sweet). Suvarna Mahal at Rambagh Palace is a splurge worth taking.

GETTING THERE
Jaipur International Airport connects to all major Indian cities. The Shatabdi Express from Delhi takes about 4.5 hours.`,
        'https://images.unsplash.com/photo-1477587458883-47145ed31fd0?w=1200&q=80'],

      ['goa-travel-guide', 'Goa', 'Goa Travel Guide: Beaches, Villas & Beyond',
        'Sun, sand, spice and soul — the complete insider guide to planning the perfect Goa trip for your group.',
        `Goa is India's most popular holiday destination — and for good reason. With over 100 km of coastline, world-class villa stays, Portuguese heritage and a vibrant nightlife scene, there's something for every kind of traveller.

BEST TIME TO VISIT
November to February is peak season with perfect beach weather. March to May is hot but less crowded. Avoid the heavy monsoon months (June–September) unless you love dramatic rains and lush green landscapes.

NORTH GOA vs SOUTH GOA
North Goa (Baga, Anjuna, Calangute) is energetic — beach shacks, nightlife, markets and watersports. South Goa (Palolem, Agonda, Colva) is quieter, with cleaner beaches and a more relaxed vibe. Most private villas are in North Goa.

TOP EXPERIENCES
• Sunset cruise on the Mandovi River
• Visit the Portuguese churches of Old Goa (UNESCO Heritage)
• Dudhsagar Waterfall — a 4-tier waterfall on the Karnataka border
• Spice plantation tours in the hinterlands
• Local seafood thali at a beach shack (xacuti, cafreal, sorpotel)

NIGHTLIFE
Tito's Lane in Baga, Club Cubana in Arpora, and the legendary Sunburn festival (December) are the highlights.

GETTING THERE
Goa's Dabolim Airport (GOI) and the newer Mopa Airport (GOX) have direct flights from all major cities. The Konkan Railway route from Mumbai is also scenic and popular.`,
        'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=1200&q=80'],

      ['mussoorie-travel-guide', 'Mussoorie', 'Mussoorie Travel Guide: Queen of the Hills',
        'Misty mountains, colonial charm and Himalayan views — your guide to Mussoorie, the classic Indian hill station.',
        `Mussoorie, perched at 2,000 metres in the Garhwal Himalayas, has been a summer escape since the British Raj. Known as the "Queen of the Hills", it offers cool weather, pine forests, and sweeping views of the Doon Valley below.

BEST TIME TO VISIT
March to June is perfect — clear skies and pleasant temperatures make it ideal for a summer escape from the plains. October to November brings crisp autumn beauty. December to February is cold but magical if you're hoping for snow.

TOP ATTRACTIONS
• Mall Road — the colonial-era promenade with shops, cafes and panoramic views
• Kempty Falls — a popular waterfall about 15 km from town
• Gun Hill — take the ropeway for 360° Himalayan views
• Lal Tibba — highest point in Mussoorie, with a telescope view of Badrinath and Kedarnath peaks
• Cloud's End — the quiet, forested western end of the ridge

ACTIVITIES
Trekking to Nag Tibba (the nearest Himalayan trek from Delhi), nature walks in the Benog Wildlife Sanctuary, and mountain biking are popular with groups.

WHERE TO EAT
Try the local Garhwali cuisine — aloo ke gutke, chainsoo dal and singori sweets. Landour (the quieter cantonment area above Mussoorie) has charming bakeries worth the walk.

GETTING THERE
The nearest railhead is Dehradun (35 km). From Dehradun, take a taxi or shared cab up the winding mountain road. Delhi to Dehradun by train is about 6 hours.`,
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80'],
    ].forEach(g => ig.run(...g));
    console.log('✅ Sample travel guides seeded');
  }

  // Seed admin user
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@staydekho.com');
  if (!admin) {
    const bcrypt = require('bcryptjs');
    const adminPass = process.env.ADMIN_PASSWORD || 'StayDekho@2024!';
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)')
      .run('Admin', 'admin@staydekho.com', '+91 98765 00000', hash, 'admin');
    console.log(`✅ Admin seeded — email: admin@staydekho.com  password: ${adminPass}`);
  }

  // Seed sample properties
  const propCount = db.prepare('SELECT COUNT(*) as c FROM properties').get().c;
  if (propCount === 0) {
    const ins = db.prepare(
      'INSERT INTO properties (name,location,price,guests,beds,bathrooms,description,amenities,images,status) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    [
      ['Lakeside Villa',     'Udaipur, Rajasthan',     7500,  20, 6, 5, 'Stunning lakeside villa with panoramic lake views.',         'Pool,WiFi,AC,Chef,Parking',          JSON.stringify(['https://images.unsplash.com/photo-1613977257365-aaae5a9817ff?w=800&q=80']), 'Active'],
      ['Heritage Haveli',    'Jaipur, Rajasthan',      9200,  16, 5, 4, 'Royal heritage stay in the heart of Jaipur.',               'WiFi,AC,Chef,Parking,Heritage Tour',  JSON.stringify(['https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80']), 'Active'],
      ['Pool Villa Udaipur', 'Udaipur, Rajasthan',     6800,  14, 4, 4, 'Modern pool villa with stunning city and lake views.',      'Pool,WiFi,AC,BBQ',                    JSON.stringify(['https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80']), 'Active'],
      ['Mountain Retreat',   'Mussoorie, Uttarakhand', 5500,  12, 4, 3, 'Serene mountain retreat perfect for group getaways.',       'WiFi,Bonfire,Hiking,Breakfast',       JSON.stringify(['https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80']), 'Active'],
      ['Beachside Bungalow', 'Goa',                    8000,  18, 5, 4, 'Stunning beachfront bungalow steps from the ocean.',        'Beach Access,Pool,BBQ,WiFi',          JSON.stringify(['https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80']), 'Active'],
      ['Royal Fort Stay',    'Jodhpur, Rajasthan',     11000, 24, 8, 6, 'Live like royalty in this majestic fort-style property.',   'Fort Access,Chef,Pool,Parking,WiFi',  JSON.stringify(['https://images.unsplash.com/photo-1561361058-c24cecae35ca?w=800&q=80']), 'Active'],
    ].forEach(p => ins.run(...p));
    console.log('✅ Sample properties seeded');
  }
}

init();
module.exports = db;
