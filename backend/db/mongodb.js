// ╔══════════════════════════════════════════════════════╗
// ║  StayDekho — MongoDB Connection + Auto Seed         ║
// ╚══════════════════════════════════════════════════════╝
require('dotenv').config();
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI .env mein set nahi hai!');
    console.error('   mongodb.com/cloud/atlas par free cluster banao aur URI yahan add karo.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log('✅ MongoDB connected');
    await seedIfEmpty();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

async function seedIfEmpty() {
  const { User, Property, SiteSetting, TravelGuide } = require('./models');
  const bcrypt = require('bcryptjs');

  // ── Admin seed — always sync to canonical credentials ──
  const adminEmail = 'info@staydekho.com';
  const adminPhone = '8602591814';
  const adminPass  = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    console.warn('⚠️  ADMIN_PASSWORD env var not set — skipping admin credential sync');
  } else {
    const hash = await bcrypt.hash(adminPass, 10);
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (!existingAdmin) {
      await User.create({ name: 'Sanskar Patidar', email: adminEmail, phone: adminPhone, password: hash, role: 'admin' });
      console.log(`✅ Admin created — ${adminEmail}`);
    } else {
      await User.findOneAndUpdate(
        { role: 'admin' },
        { $set: { email: adminEmail, phone: adminPhone, password: hash, name: 'Sanskar Patidar' } },
        { runValidators: true }
      );
      console.log(`✅ Admin synced — ${adminEmail}`);
    }
  }

  // ── Properties seed ─────────────────────────────────
  const propCount = await Property.countDocuments();
  if (propCount === 0) {
    await Property.insertMany([
      { name: 'Lakeside Villa',     location: 'Udaipur, Rajasthan',     price: 7500,  guests: 20, beds: 6, bathrooms: 5, description: 'Stunning lakeside villa with panoramic lake views.',        amenities: 'Pool,WiFi,AC,Chef,Parking',         images: JSON.stringify(['https://images.unsplash.com/photo-1613977257365-aaae5a9817ff?w=800&q=80']), status: 'Active' },
      { name: 'Heritage Haveli',    location: 'Jaipur, Rajasthan',      price: 9200,  guests: 16, beds: 5, bathrooms: 4, description: 'Royal heritage stay in the heart of Jaipur.',              amenities: 'WiFi,AC,Chef,Parking,Heritage Tour', images: JSON.stringify(['https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80']), status: 'Active' },
      { name: 'Pool Villa Udaipur', location: 'Udaipur, Rajasthan',     price: 6800,  guests: 14, beds: 4, bathrooms: 4, description: 'Modern pool villa with stunning city and lake views.',     amenities: 'Pool,WiFi,AC,BBQ',                  images: JSON.stringify(['https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80']), status: 'Active' },
      { name: 'Mountain Retreat',   location: 'Mussoorie, Uttarakhand', price: 5500,  guests: 12, beds: 4, bathrooms: 3, description: 'Serene mountain retreat perfect for group getaways.',      amenities: 'WiFi,Bonfire,Hiking,Breakfast',      images: JSON.stringify(['https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80']), status: 'Active' },
      { name: 'Beachside Bungalow', location: 'Goa',                    price: 8000,  guests: 18, beds: 5, bathrooms: 4, description: 'Stunning beachfront bungalow steps from the ocean.',      amenities: 'Beach Access,Pool,BBQ,WiFi',         images: JSON.stringify(['https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80']), status: 'Active' },
      { name: 'Royal Fort Stay',    location: 'Jodhpur, Rajasthan',     price: 11000, guests: 24, beds: 8, bathrooms: 6, description: 'Live like royalty in this majestic fort-style property.', amenities: 'Fort Access,Chef,Pool,Parking,WiFi',  images: JSON.stringify(['https://images.unsplash.com/photo-1561361058-c24cecae35ca?w=800&q=80']), status: 'Active' },
    ]);
    console.log('✅ Sample properties seeded');
  }

  // ── Site Settings seed ──────────────────────────────
  const settingsCount = await SiteSetting.countDocuments();
  if (settingsCount === 0) {
    const defaults = {
      hero_eyebrow:   'Discover Premium Stays',
      hero_headline:  'Your Group Deserves<br/>a <em>Proper</em> Stay',
      hero_sub:       'Handpicked villas, pool homes &amp; heritage retreats — every stay directly managed by us.',
      hero_slides:    JSON.stringify(['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=80','https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=1800&q=80','https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1800&q=80']),
      contact_email:  'info@staydekho.com',
      contact_phone:  '+91 87699 05983',
      social_instagram: 'https://www.instagram.com/stay_dekho/',
      social_whatsapp:  'https://wa.me/918769905983',
    };
    await SiteSetting.insertMany(Object.entries(defaults).map(([key, value]) => ({ key, value })));
    console.log('✅ Site settings seeded');
  }

  // ── Travel Guides seed ──────────────────────────────
  const guideCount = await TravelGuide.countDocuments();
  if (guideCount === 0) {
    await TravelGuide.insertMany([
      { slug: 'udaipur-travel-guide', city: 'Udaipur', title: 'Udaipur Travel Guide: The City of Lakes', summary: 'Everything you need to know to plan a perfect trip to Udaipur.', body: 'Udaipur, the City of Lakes, is one of Rajasthan\'s most romantic destinations.', hero_image: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&q=80', published: true },
      { slug: 'jaipur-travel-guide',  city: 'Jaipur',  title: 'Jaipur Travel Guide: The Pink City',       summary: 'Forts, palaces, bazaars and flavours — your complete guide to Jaipur.',  body: 'Jaipur earns its nickname "Pink City" from the terracotta-pink buildings.', hero_image: 'https://images.unsplash.com/photo-1477587458883-47145ed31fd0?w=1200&q=80', published: true },
      { slug: 'goa-travel-guide',     city: 'Goa',     title: 'Goa Travel Guide: Beaches, Villas & Beyond', summary: 'Sun, sand, spice and soul — the complete Goa trip guide.',             body: 'Goa is India\'s most popular holiday destination with over 100km of coastline.', hero_image: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=1200&q=80', published: true },
    ]);
    console.log('✅ Travel guides seeded');
  }
}

module.exports = { connectDB };
