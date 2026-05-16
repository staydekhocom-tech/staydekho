const _h = window.location.hostname;
const API = (!_h || _h === 'localhost' || _h === '127.0.0.1')
  ? 'http://localhost:5000/api'
  : 'https://staydekho-production.up.railway.app/api';

function getToken()   { return localStorage.getItem('sd_token'); }
function getUser()    { return JSON.parse(localStorage.getItem('sd_user') || 'null'); }
function isAdmin()    { return getUser()?.role === 'admin'; }
function isLoggedIn() { return !!getToken(); }

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function uploadRequest(method, path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { method, headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const api = {
  sendOtp:   (phone)      => request('POST', '/auth/send-otp',   { phone }),
  verifyOtp: (phone, otp, name) => request('POST', '/auth/verify-otp', { phone, otp, name }).then(d => {
    localStorage.setItem('sd_token', d.token);
    localStorage.setItem('sd_user',  JSON.stringify(d.user));
    return d;
  }),

  register: (body) => request('POST', '/auth/register', body),
  login: (email, password) => request('POST', '/auth/login', { email, password }).then(d => {
    localStorage.setItem('sd_token', d.token);
    localStorage.setItem('sd_user', JSON.stringify(d.user));
    return d;
  }),
  logout: () => {
    localStorage.removeItem('sd_token');
    localStorage.removeItem('sd_user');
    window.location.href = 'login.html';
  },
  me: () => request('GET', '/auth/me').then(d => d.user || d),
  updateMe: (body) => request('PUT', '/auth/me', body).then(d => {
    if (d.user) localStorage.setItem('sd_user', JSON.stringify(d.user));
    return d.user || d;
  }),
  isLoggedIn,
  requireLogin: () => {
    showToast('Please login to continue', 'info');
    setTimeout(() => { window.location.href = 'login.html?redirect=' + encodeURIComponent(location.href); }, 800);
  },

  listProperties: (params = {}) => {
    const mapped = { ...params };
    if (mapped.q) { mapped.location = mapped.q; delete mapped.q; }
    Object.keys(mapped).forEach(k => (mapped[k] == null || mapped[k] === '') && delete mapped[k]);
    const q = new URLSearchParams(mapped).toString();
    return request('GET', `/properties${q ? '?' + q : ''}`);
  },
  getProperty:    (id)       => request('GET',    `/properties/${id}`),
  createProperty: (body)     => request('POST',   '/properties', body),
  updateProperty: (id, body) => request('PUT',    `/properties/${id}`, body),
  deleteProperty: (id)       => request('DELETE', `/properties/${id}`),

  listBookings:  ()     => request('GET',  '/bookings'),
  getBooking:    (id)   => request('GET',  `/bookings/${id}`),
  createBooking: (body) => {
    const b = { ...body };
    if (b.check_in)  { b.checkin  = b.check_in;  delete b.check_in; }
    if (b.check_out) { b.checkout = b.check_out; delete b.check_out; }
    return request('POST', '/bookings', b);
  },
  updateBookingStatus: (id, status) => request('PUT',    `/bookings/${id}/status`, { status }),
  cancelBooking:       (id)         => request('DELETE', `/bookings/${id}`),

  toggleWishlist: async (propertyId) => {
    const id = String(propertyId); // MongoDB ObjectId is a string — never convert to Number
    if (isLoggedIn()) {
      const ids = await request('GET', '/wishlist/ids').then(d => d.ids).catch(() => []);
      if (ids.includes(id)) {
        return request('DELETE', `/wishlist/${id}`);
      } else {
        return request('POST', `/wishlist/${id}`);
      }
    }
    const key = 'sd_wishlist';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const idx  = list.indexOf(id);
    const wishlisted = idx === -1;
    if (wishlisted) list.push(id);
    else            list.splice(idx, 1);
    localStorage.setItem(key, JSON.stringify(list));
    return Promise.resolve({ wishlisted });
  },
  getWishlistIds: () => {
    if (isLoggedIn()) return request('GET', '/wishlist/ids').then(d => d.ids).catch(() => []);
    return Promise.resolve(JSON.parse(localStorage.getItem('sd_wishlist') || '[]'));
  },
  getWishlist: () => JSON.parse(localStorage.getItem('sd_wishlist') || '[]'),

  createOrder:   (booking_id) => request('POST', '/payments/create-order', { booking_id }),
  verifyPayment: (body)       => request('POST', '/payments/verify', body),
  listPayments:  ()           => request('GET',  '/payments'),

  myListings:   ()    => api.listProperties(),
  hostBookings: ()    => api.listBookings(),

  myBookings: () => api.listBookings(),
  myTrips: () => api.listBookings().then(d => {
    const bookings = (d.bookings || []).map(b => ({
      ...b,
      title:      b.property_name || b.title || 'Property',
      main_image: JSON.parse(b.property_images || '[]')[0] || null,
      check_in:   b.checkin  || b.check_in,
      check_out:  b.checkout || b.check_out,
      total:      b.amount   || b.total || 0,
    }));
    return { bookings };
  }),
  wishlist: () => {
    if (isLoggedIn()) return request('GET', '/wishlist');
    const ids = JSON.parse(localStorage.getItem('sd_wishlist') || '[]');
    if (!ids.length) return Promise.resolve({ properties: [] });
    return api.listProperties().then(d => ({
      properties: (d.properties || []).filter(p => ids.includes(p.id))
    }));
  },

  listReviews:   (property_id) => request('GET', `/reviews?property_id=${property_id}`),
  createReview:  (body)        => request('POST', '/reviews', body),
  deleteReview:  (id)          => request('DELETE', `/reviews/${id}`),

  submitContact: (body) => request('POST', '/contact', body),

  forgotPassword: (phone)                  => request('POST', '/auth/forgot-password', { phone }),
  resetPassword:  (phone, otp, password)   => request('POST', '/auth/reset-password',  { phone, otp, password }),

  googleLogin: (credential) => request('POST', '/auth/google', { credential }).then(d => {
    localStorage.setItem('sd_token', d.token);
    localStorage.setItem('sd_user',  JSON.stringify(d.user));
    return d;
  }),

  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return uploadRequest('POST', '/uploads/image', fd);
  },

  getAvailability:  (property_id)         => request('GET',  `/properties/${property_id}/availability`),
  getDatePrices:    (property_id)         => request('GET',  `/properties/${property_id}/date-prices`),
  saveDatePrices:   (property_id, prices) => request('POST', `/properties/${property_id}/date-prices`, { prices }),

  adminStats:    () => request('GET', '/admin/stats'),
  adminUsers:    () => request('GET', '/admin/users'),
  adminReviews:  () => request('GET', '/admin/reviews'),
  adminToday:    () => request('GET', '/admin/today'),
  adminBookings: (params = {}) => {
    Object.keys(params).forEach(k => (params[k] == null || params[k] === '') && delete params[k]);
    const q = new URLSearchParams(params).toString();
    return request('GET', `/admin/bookings${q ? '?' + q : ''}`);
  },

  getSiteSettings:    () => request('GET', '/site-settings'),
  getPublicStats:     () => request('GET', '/site-settings/public-stats'),
  updateSiteSettings: (settings) => request('PUT', '/site-settings', { settings }),

  uploadBrochure: (propertyId, file) => {
    const fd = new FormData();
    fd.append('brochure', file);
    return uploadRequest('POST', `/uploads/brochure/${propertyId}`, fd);
  },
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return uploadRequest('POST', '/uploads/avatar', fd);
  },

  icalForProperty:    (id)        => request('GET',    `/ical/property/${id}`),
  addIcalSource:      (id, body)  => request('POST',   `/ical/property/${id}/sources`, body),
  deleteIcalSource:   (id)        => request('DELETE', `/ical/sources/${id}`),
  syncIcal:           (body = {}) => request('POST',   '/ical/sync', body),

  listGuides:    ()        => request('GET',    '/guides'),
  getGuide:      (slug)    => request('GET',    `/guides/${slug}`),
  createGuide:   (body)    => request('POST',   '/guides', body),
  updateGuide:   (id, b)   => request('PUT',    `/guides/${id}`, b),
  deleteGuide:   (id)      => request('DELETE', `/guides/${id}`),

  listBlogPosts:  (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString();
    return request('GET', `/blog${q ? '?' + q : ''}`);
  },
  getBlogPost:    (slug)       => request('GET',    `/blog/${slug}`),
  createBlogPost: (body)       => request('POST',   '/blog', body),
  updateBlogPost: (id, body)   => request('PUT',    `/blog/${id}`, body),
  deleteBlogPost: (id)         => request('DELETE', `/blog/${id}`),

  listMyAddonRequests: ()         => request('GET',  '/addons/mine'),
  createAddonRequest:  (body)     => request('POST', '/addons', body),
  listAddonRequests:   ()         => request('GET',  '/addons'),
  setAddonStatus:      (id, s)    => request('PUT',  `/addons/${id}/status`, { status: s }),

  listReels:    ()          => request('GET', '/reels'),
  listAllReels: ()          => request('GET', '/reels/all'),
  createReel:   (fd)        => uploadRequest('POST',  '/reels',        fd),
  updateReel:   (id, fd)    => uploadRequest('PUT',   `/reels/${id}`, fd),
  deleteReel:   (id)        => request('DELETE', `/reels/${id}`),

  openRazorpay({ order_id, amount, currency, key_id, booking, onSuccess, onError }) {
    const options = {
      key:         key_id,
      amount,
      currency,
      name:        'StayDekho',
      description: `Booking — ${booking.property_name || booking.title || 'Villa Stay'}`,
      order_id,
      prefill: {
        name:    booking.guest_name  || getUser()?.name  || '',
        email:   booking.guest_email || getUser()?.email || '',
        contact: booking.guest_phone || getUser()?.phone || '',
      },
      theme: { color: '#8B1717' },
      handler: async (response) => {
        try {
          const result = await api.verifyPayment({
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            booking_id:          booking.id,
          });
          if (onSuccess) onSuccess(result);
        } catch (err) {
          if (onError) onError(err);
        }
      },
      modal: {
        ondismiss: () => { if (onError) onError(new Error('Payment cancelled')); }
      }
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  }
};

function showToast(msg, type = 'info') {
  if (window._toastTimeout) clearTimeout(window._toastTimeout);
  let t = document.getElementById('_sd_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_sd_toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-family:Inter,sans-serif;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.15);transition:opacity .3s;max-width:320px';
    document.body.appendChild(t);
  }
  const colors = { success: '#16a34a', error: '#dc2626', info: '#1d4ed8' };
  t.style.background = colors[type] || '#1d4ed8';
  t.style.color      = '#fff';
  t.style.opacity    = '1';
  t.textContent      = msg;
  window._toastTimeout = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

window.api        = api;
window.getToken   = getToken;
window.getUser    = getUser;
window.isAdmin    = isAdmin;
window.isLoggedIn = isLoggedIn;
window.showToast  = window.showToast || showToast;