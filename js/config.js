// ╔═══════════════════════════════════════════════════════════════╗
// ║  StayDekho — SITE CONFIG                                     ║
// ║  Sirf yeh file edit karo — baaki koi code nahi chhuna padega ║
// ╚═══════════════════════════════════════════════════════════════╝

const SD = {

  // ── CONTACT ──────────────────────────────────────────────────
  phone:         '+91 87699 05983',   // ← display ke liye
  phone_link:    '918769905983',      // ← same number bina + aur spaces ke
  whatsapp:      '918769905983',      // ← WhatsApp number (bina + ke)
  whatsapp_msg:  'Hi StayDekho! I want to enquire about your properties.',
  email:         'info@staydekho.com',
  safety_email:  'safety@staydekho.com',

  // ── BUSINESS INFO ─────────────────────────────────────────────
  business_name: 'StayDekho',
  city:          'Udaipur',
  tagline:       'Your Group Deserves a Proper Stay',

  // ── STATS (homepage hero bar) — apne hissab se badlo ─────────
  stats: {
    villas:       '10+',
    destinations: '5+',
    guests:       '500+',
    rating:       '4.8★',
  },

  // ── SOCIAL LINKS ──────────────────────────────────────────────
  social: {
    instagram: 'https://instagram.com/staydekho',
    twitter:   'https://twitter.com/staydekho',
    youtube:   '',   // ← apna YouTube channel daalo: 'https://youtube.com/@staydekho'
  },

  // ── DESTINATIONS (homepage chips) ─────────────────────────────
  destinations: [
    'Udaipur', 'Goa', 'Jaipur', 'Manali',
    'Coorg', 'Munnar', 'Shimla', 'Pondicherry',
    'Alibaug', 'Ooty', 'Lonavala', 'Mussoorie',
  ],

  // ── GUEST VIDEO REELS (homepage review section) ───────────────
  // video: apna MP4 file ka path daalo jaise 'videos/priya.mp4'
  //        ya koi direct MP4 URL (Google Drive direct link kaam nahi karta)
  //        Cloudinary, Bunny CDN, ya apne server pe upload karo
  //        Agar video nahi hai toh '' rakho — "Coming Soon" dikhega
  // poster: thumbnail image (Unsplash ya apni photo — portrait format best)
  // stay:   property/location naam (badge pe dikhega)
  // quote:  guest ka review text (2-3 lines)
  // name:   guest ka naam
  // location: guest ka sheher
  // stars:  rating (1-5)
  reels: [
    {
      video:    '',   // ← apna video yahan: 'videos/priya-reel.mp4'
      poster:   'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Goa Pool Villa',
      quote:    'Pool ke saath ocean view, sunset BBQ — magical beyond words! StayDekho ne poora trip banaya!',
      name:     'Priya Sharma',
      location: 'Mumbai',
      stars:    5,
    },
    {
      video:    '',
      poster:   'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Coorg Bungalow',
      quote:    'Misty mornings, coffee plantations all around. Woke up to bliss every single day. Absolutely perfect!',
      name:     'Rahul Verma',
      location: 'Bengaluru',
      stars:    5,
    },
    {
      video:    '',
      poster:   'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Manali Retreat',
      quote:    'Best group trip ever! Mountain views, bonfire nights, snow peaks — 10/10 will definitely come back!',
      name:     'Sneha & Rohan',
      location: 'Delhi',
      stars:    5,
    },
    {
      video:    '',
      poster:   'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Udaipur Heritage Haveli',
      quote:    'Felt like royalty! Impeccable service, authentic Rajasthani food. Our anniversary was truly unforgettable.',
      name:     'Aarav & Meera Patel',
      location: 'Ahmedabad',
      stars:    5,
    },
    {
      video:    '',
      poster:   'https://images.unsplash.com/photo-1470770903676-69b98201ea1c?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Kerala Backwaters',
      quote:    'Houseboat stay on backwaters was surreal. Zero stress, everything perfectly managed by StayDekho!',
      name:     'Kavya Nair',
      location: 'Chennai',
      stars:    5,
    },
    {
      video:    '',
      poster:   'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=400&h=710&q=80',
      stay:     'Lonavala Pool Villa',
      quote:    'Monsoon pool villa — epic experience! The whole group loved it. Booking again next season for sure!',
      name:     'Vikram Joshi',
      location: 'Pune',
      stars:    5,
    },
  ],
};

// Auto links
SD.whatsapp_link = `https://wa.me/${SD.whatsapp}?text=${encodeURIComponent(SD.whatsapp_msg)}`;
SD.phone_tel     = `tel:${SD.phone_link}`;

window.SD = SD;
