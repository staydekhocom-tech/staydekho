// ╔══════════════════════════════════════════════════════╗
// ║  StayDekho — All Mongoose Models                    ║
// ╚══════════════════════════════════════════════════════╝
const mongoose = require('mongoose');
const { Schema } = mongoose;

// _id → id, __v remove karo JSON mein
const toJSON = {
  virtuals: true,
  transform: (_, ret) => { delete ret._id; delete ret.__v; return ret; },
};

// ── 1. User ────────────────────────────────────────────
const userSchema = new Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:      { type: String, default: null },
  password:   { type: String, required: true },
  role:       { type: String, default: 'user', enum: ['user', 'admin'] },
  avatar_url: { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 2. Property ────────────────────────────────────────
const propertySchema = new Schema({
  name:           { type: String, required: true },
  location:       { type: String, required: true },
  price:          { type: Number, required: true },
  guests:         { type: Number, default: 10 },
  beds:           { type: Number, default: 4 },
  bathrooms:      { type: Number, default: 3 },
  description:    { type: String, default: '' },
  amenities:      { type: String, default: '' },
  images:         { type: String, default: '[]' },
  status:         { type: String, default: 'Active', enum: ['Active', 'Inactive'] },
  checkin_time:   { type: String, default: '2:00 PM' },
  checkout_time:  { type: String, default: '11:00 AM' },
  rules:          { type: String, default: '[]' },
  addons:         { type: String, default: '[]' },
  map_url:        { type: String, default: '' },
  brochure_url:   { type: String, default: '' },
  ical_url:       { type: String, default: '' },
  ical_uid:       { type: String, default: '' },
  fomo_bookings:  { type: Number, default: null },
  fomo_viewers:   { type: Number, default: null },
  fomo_enabled:   { type: Boolean, default: true },
  property_types: { type: String, default: '[]' },
  lat:               { type: Number, default: null },
  lng:               { type: Number, default: null },
  nearby_attractions:{ type: String, default: '[]' },
  owner_name:        { type: String, default: '' },
  owner_phone:       { type: String, default: '' },   // WhatsApp notifications ke liye
  caretaker_name:    { type: String, default: '' },
  caretaker_phone:   { type: String, default: '' },   // WhatsApp notifications ke liye
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 3. Booking ─────────────────────────────────────────
const bookingSchema = new Schema({
  user_id:             { type: Schema.Types.ObjectId, ref: 'User', required: false, default: null },
  property_id:         { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  guest_name:          { type: String, required: true },
  guest_email:         { type: String, default: '' },
  guest_phone:         { type: String, default: '' },
  checkin:             { type: String, required: true },
  checkout:            { type: String, required: true },
  guests:              { type: Number, default: 1 },
  nights:              { type: Number, default: 1 },
  amount:              { type: Number, required: true },  // advance paid (30%)
  total_amount:        { type: Number, default: null },   // full booking price
  balance_amount:      { type: Number, default: null },   // remaining 70%
  balance_paid:        { type: Boolean, default: false }, // collected at check-in
  balance_paid_at:     { type: Date, default: null },     // when full payment completed
  booking_no:          { type: Number, default: null },   // short sequential number (SD-0001)
  payment_type:        { type: String, default: 'partial', enum: ['full', 'partial'] },
  status:              { type: String, default: 'pending', enum: ['pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out'] },
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  // ── Multi-channel (OTA) booking log fields ──
  platform:            { type: String, default: 'direct', enum: ['direct', 'airbnb', 'booking_com', 'agoda', 'mmt_goibibo', 'walkin'] },
  commission_pct:      { type: Number, default: 0 },   // platform commission % snapshot
  gst_on_commission_pct:{ type: Number, default: 0 },  // GST on commission %
  tds_pct:             { type: Number, default: 0 },   // TDS %
  net_payout:          { type: Number, default: null }, // we-received amount after commission/GST/TDS
  remitted_tax:        { type: Number, default: 0 },    // occupancy tax platform (Airbnb etc.) ne khud govt ko remit kiya — 70/30 split se bahar, pura StayDekho ke paas rehta hai (govt ko aage jama karne ke liye)
  payout_received:     { type: Boolean, default: false }, // OTA transferred payout to our bank
  payout_received_at:  { type: Date, default: null },
  owner_paid:          { type: Boolean, default: false }, // owner's 70% share transferred
  owner_paid_at:       { type: Date, default: null },
  notes:               { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

bookingSchema.index({ property_id: 1, checkin: 1 });
bookingSchema.index({ property_id: 1, status: 1 });
bookingSchema.index({ checkin: 1 });
bookingSchema.index({ status: 1, created_at: -1 });

// ── 4. Payment ─────────────────────────────────────────
const paymentSchema = new Schema({
  booking_id:          { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  razorpay_order_id:   { type: String, required: true },
  razorpay_payment_id: { type: String, default: null },
  razorpay_signature:  { type: String, default: null },
  amount:              { type: Number, required: true },
  currency:            { type: String, default: 'INR' },
  status:              { type: String, default: 'created', enum: ['created', 'captured', 'failed', 'refunded'] },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 5. OTP ─────────────────────────────────────────────
const otpSchema = new Schema({
  phone:      { type: String, required: true },
  otp:        { type: String, required: true },
  expires_at: { type: Date, required: true },
  used:       { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 6. Review ──────────────────────────────────────────
const reviewSchema = new Schema({
  user_id:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  property_id:   { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  booking_id:    { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  rating:        { type: Number, required: true, min: 1, max: 5 },
  text:          { type: String, default: '' },
  // Admin-created review extras
  guest_name:    { type: String, default: '' },   // custom name shown on homepage card
  image_url:     { type: String, default: '' },   // guest photo (card background)
  property_name: { type: String, default: '' },   // cached for display
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 7. GuestReel ───────────────────────────────────────
const guestReelSchema = new Schema({
  name:       { type: String, required: true },
  location:   { type: String, default: '' },
  stay:       { type: String, required: true },
  quote:      { type: String, default: '' },
  stars:      { type: Number, default: 5, min: 1, max: 5 },
  video_url:  { type: String, default: '' },
  poster_url: { type: String, default: '' },
  sort_order: { type: Number, default: 0 },
  active:     { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 8. Wishlist ────────────────────────────────────────
const wishlistSchema = new Schema({
  user_id:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });
wishlistSchema.index({ user_id: 1, property_id: 1 }, { unique: true });

// ── 9. Contact ─────────────────────────────────────────
const contactSchema = new Schema({
  name:    { type: String, required: true },
  email:   { type: String, required: true },
  phone:   { type: String, default: null },
  subject: { type: String, required: true },
  message: { type: String, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 10. SiteSetting ────────────────────────────────────
const siteSettingSchema = new Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: String, default: '' },
}, { toJSON });

// ── 11. IcalBlock ──────────────────────────────────────
const icalBlockSchema = new Schema({
  property_id:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  source:       { type: String, default: 'external' },
  external_uid: { type: String },
  summary:      { type: String, default: '' },
  start_date:   { type: String, required: true },
  end_date:     { type: String, required: true },
  synced_at:    { type: Date, default: Date.now },
}, { toJSON });
icalBlockSchema.index({ property_id: 1, external_uid: 1 }, { unique: true, sparse: true });

// ── 12. IcalSource ─────────────────────────────────────
const icalSourceSchema = new Schema({
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  url:         { type: String, required: true },
  label:       { type: String, default: '' },
  last_synced: { type: Date, default: null },
  last_error:  { type: String, default: null },
}, { toJSON });

// ── 13. TravelGuide ────────────────────────────────────
const travelGuideSchema = new Schema({
  slug:       { type: String, required: true, unique: true },
  city:       { type: String, required: true },
  title:      { type: String, required: true },
  summary:    { type: String, default: '' },
  body:       { type: String, default: '' },
  hero_image: { type: String, default: '' },
  published:  { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 14. AddonRequest ───────────────────────────────────
const addonRequestSchema = new Schema({
  user_id:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  booking_id: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  addon:      { type: String, required: true },
  note:       { type: String, default: '' },
  status:     { type: String, default: 'pending', enum: ['pending', 'confirmed', 'rejected'] },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 15. DatePrice ──────────────────────────────────────
const datePriceSchema = new Schema({
  property_id:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  date:         { type: String, required: true },
  price:        { type: Number, default: null },
  blocked:      { type: Boolean, default: false },
  note:         { type: String, default: '' },
  hike_pct:     { type: Number, default: 0 },   // % hike over base price (festival/weekend)
  holiday_note: { type: String, default: '' },  // National Holiday / Festival label
  targets:      { type: Object, default: {} },  // manual "Target We Receive" per platform — free-type, no formula (matches Excel template)
}, { toJSON });
datePriceSchema.index({ property_id: 1, date: 1 }, { unique: true });

// ── 16. BlogPost ───────────────────────────────────────
const blogPostSchema = new Schema({
  title:        { type: String, required: true },
  slug:         { type: String, required: true, unique: true },
  excerpt:      { type: String, default: '' },
  body:         { type: String, default: '' },
  category:     { type: String, default: 'General' },
  cover_image:  { type: String, default: '' },
  author:       { type: String, default: 'StayDekho Team' },
  published:    { type: Boolean, default: false },
  published_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, toJSON });

// ── 17. Expense ────────────────────────────────────────
const expenseSchema = new Schema({
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  date:        { type: String, required: true },
  category:    { type: String, default: 'General' },
  description: { type: String, default: '' },
  amount:      { type: Number, required: true },
  paid_by:     { type: String, default: '' },
  notes:       { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 18. CleaningTask ───────────────────────────────────
const cleaningTaskSchema = new Schema({
  property_id:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  date:            { type: String, required: true },
  checkout_today:  { type: Boolean, default: false },
  status:          { type: String, default: 'pending', enum: ['pending', 'in_progress', 'done'] },
  cleaned_by:      { type: String, default: '' },
  notes:           { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });
cleaningTaskSchema.index({ property_id: 1, date: 1 }, { unique: true });

// ── 19. PlatformSetting ────────────────────────────────
// One doc per property_id (or null = global default). Stores commission/GST/TDS % per OTA platform.
const platformSettingSchema = new Schema({
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  platforms: {
    type: Object,
    default: () => ({
      airbnb:      { commission_pct: 15.5, gst_pct: 18, tds_pct: 0.1, discount_pct: 0 },
      booking_com: { commission_pct: 18,   gst_pct: 18, tds_pct: 0,   discount_pct: 0 },
      agoda:       { commission_pct: 18,   gst_pct: 18, tds_pct: 5,   discount_pct: 0 },
      mmt_goibibo: { commission_pct: 18,   gst_pct: 18, tds_pct: 5,   discount_pct: 0 },
      direct:      { commission_pct: 0,    gst_pct: 0,  tds_pct: 0,   markup_pct: 0 },
    }),
  },
  default_base_price: { type: Number, default: 4000 },
}, { toJSON });

// ── 20. Staff ─────────────────────────────────────────
const staffSchema = new Schema({
  name:        { type: String, required: true },
  phone:       { type: String, required: true, unique: true },
  pin:         { type: String, required: true },
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  role:        { type: String, default: 'caretaker', enum: ['caretaker', 'housekeeping', 'manager', 'security', 'cook'] },
  status:      { type: String, default: 'active', enum: ['active', 'inactive'] },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 21. StaffTask ─────────────────────────────────────
const staffTaskSchema = new Schema({
  staff_id:     { type: Schema.Types.ObjectId, ref: 'Staff', default: null },
  property_id:  { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  booking_id:   { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  task_type:    { type: String, default: 'cleaning', enum: ['cleaning', 'maintenance', 'setup', 'other'] },
  title:        { type: String, required: true },
  notes:        { type: String, default: '' },
  photos:       { type: String, default: '[]' },
  status:       { type: String, default: 'pending', enum: ['pending', 'in_progress', 'done'] },
  due_date:     { type: String, required: true },
  completed_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 22. CheckinToken ──────────────────────────────────
const checkinTokenSchema = new Schema({
  booking_id:        { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  property_id:       { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  token:             { type: String, required: true, unique: true },
  room_photos:       { type: String, default: '[]' },
  guest_signed_name: { type: String, default: null },
  signed_at:         { type: Date, default: null },
  ready_at:          { type: Date, default: null },
  ready_by_staff_id: { type: Schema.Types.ObjectId, ref: 'Staff', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

// ── 23. PropertySOP ───────────────────────────────────
const propertySopSchema = new Schema({
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, unique: true },
  sop_photo:   { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, toJSON });

// ── 24. StaffIssue ────────────────────────────────────
const staffIssueSchema = new Schema({
  staff_id:    { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  photos:      { type: String, default: '[]' },
  status:      { type: String, default: 'open', enum: ['open', 'resolved'] },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

module.exports = {
  User:         mongoose.model('User',         userSchema),
  Property:     mongoose.model('Property',     propertySchema),
  Booking:      mongoose.model('Booking',      bookingSchema),
  Payment:      mongoose.model('Payment',      paymentSchema),
  OTP:          mongoose.model('OTP',          otpSchema),
  Review:       mongoose.model('Review',       reviewSchema),
  GuestReel:    mongoose.model('GuestReel',    guestReelSchema),
  Wishlist:     mongoose.model('Wishlist',     wishlistSchema),
  Contact:      mongoose.model('Contact',      contactSchema),
  SiteSetting:  mongoose.model('SiteSetting',  siteSettingSchema),
  IcalBlock:    mongoose.model('IcalBlock',    icalBlockSchema),
  IcalSource:   mongoose.model('IcalSource',   icalSourceSchema),
  TravelGuide:  mongoose.model('TravelGuide',  travelGuideSchema),
  AddonRequest: mongoose.model('AddonRequest', addonRequestSchema),
  DatePrice:    mongoose.model('DatePrice',    datePriceSchema),
  BlogPost:     mongoose.model('BlogPost',     blogPostSchema),
  Expense:         mongoose.model('Expense',         expenseSchema),
  CleaningTask:    mongoose.model('CleaningTask',    cleaningTaskSchema),
  PlatformSetting: mongoose.model('PlatformSetting', platformSettingSchema),
  Staff:           mongoose.model('Staff',           staffSchema),
  StaffTask:       mongoose.model('StaffTask',       staffTaskSchema),
  CheckinToken:    mongoose.model('CheckinToken',    checkinTokenSchema),
  PropertySOP:     mongoose.model('PropertySOP',     propertySopSchema),
  StaffIssue:      mongoose.model('StaffIssue',      staffIssueSchema),
};
