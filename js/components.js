/* ── StayDekho shared components ────────────────────── */

const LOGO_SVG = `
  <svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle class="lens" cx="10" cy="10" r="8.2" stroke="currentColor" stroke-width="2.6"/>
    <line class="handle" x1="16.2" y1="16.2" x2="24" y2="24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`;

const LOGO_HTML = `
  <a href="index.html" class="nav-logo">
    <span class="logo-wordmark">
      <span class="logo-stay">Stay</span><span class="logo-dekh">Dekh</span>
      <span class="logo-o">${LOGO_SVG}</span>
    </span>
  </a>`;

function buildNav() {
  const user = getUser ? getUser() : null;
  const loggedIn = !!(localStorage.getItem('sd_token'));
  const page = location.pathname.split('/').pop() || 'index.html';

  const links = [
    { href: 'index.html',    label: 'Home' },
    { href: 'listings.html', label: 'Explore' },
    { href: 'about.html',    label: 'About' },
  ];

  const navLinksHTML = links.map(l =>
    `<li><a href="${l.href}" class="${page === l.href ? 'active' : ''}">${l.label}</a></li>`
  ).join('');

  let authHTML;
  if (loggedIn && user) {
    const isAdminUser = user.role === 'admin';
    authHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <a href="${isAdminUser ? 'admin.html' : 'guest-dashboard.html'}" class="nav-login">
          ${isAdminUser ? 'Admin' : (user.name || 'Account').split(' ')[0]}
        </a>
        <button onclick="(window.api||{logout:()=>{localStorage.removeItem('sd_token');localStorage.removeItem('sd_user');location.href='login.html'}}).logout()"
          class="nav-login" style="cursor:pointer">Logout</button>
      </div>`;
  } else {
    authHTML = `<a href="login.html" class="nav-login">Login</a>`;
  }

  // Mobile drawer links
  const drawerLinksHTML = links.map(l =>
    `<a href="${l.href}" class="${page === l.href ? 'active' : ''}">${l.label}</a>`
  ).join('');
  const drawerAuthHTML = loggedIn && user
    ? `<a href="${(user && user.role === 'admin') ? 'admin.html' : 'guest-dashboard.html'}" style="color:#f08080">${(user.name||'Account').split(' ')[0]}</a>
       <a href="#" onclick="doLogout();return false" style="color:rgba(255,255,255,.5);font-size:1rem">Logout</a>`
    : `<a href="login.html">Login</a>`;

  return `
    <nav id="navbar" class="nav-top">
      <div class="nav-inner">
        ${LOGO_HTML}
        <ul class="nav-links">${navLinksHTML}</ul>
        <div class="nav-auth-desktop">${authHTML}</div>
        <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu" onclick="document.getElementById('mobile-nav-drawer').classList.add('open')">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
    <div class="mobile-nav-drawer" id="mobile-nav-drawer">
      <button class="mobile-nav-close" onclick="document.getElementById('mobile-nav-drawer').classList.remove('open')" aria-label="Close">✕</button>
      ${drawerLinksHTML}
      ${drawerAuthHTML}
    </div>`;
}

function buildFooter() {
  return `
    <footer>
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="index.html" class="nav-logo" style="text-decoration:none;color:#fff">
              <span class="logo-wordmark" style="color:#fff">
                <span class="logo-stay">Stay</span><span class="logo-dekh">Dekh</span>
                <span class="logo-o">${LOGO_SVG}</span>
              </span>
            </a>
            <p>Premium, directly managed group stays across India. Founded in Udaipur with a belief that every group deserves a beautiful, hassle-free stay.</p>
          </div>
          <div class="footer-col">
            <h4>Discover</h4>
            <ul>
              <li><a href="listings.html">All Stays</a></li>
              <li><a href="listings.html">Pool Villas</a></li>
              <li><a href="listings.html">Heritage Stays</a></li>
              <li><a href="listings.html">Group Homes</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Company</h4>
            <ul>
              <li><a href="about.html">About Us</a></li>
              <li><a href="travel-guide.html">Travel Guide</a></li>
              <li><a href="careers.html">Careers</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="contact.html">Contact Us</a></li>
              <li><a href="help.html">Help Center</a></li>
              <li><a href="cancellation.html">Cancellation Policy</a></li>
              <li><a href="safety.html">Safety</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>© 2026 StayDekho. All rights reserved. Made with love in Udaipur.</p>
          <div class="footer-social">
            <a href="${(window.SD && window.SD.social && window.SD.social.instagram) || 'https://www.instagram.com/stay_dekho/'}" target="_blank" rel="noopener" aria-label="Instagram">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
            </a>
            <a href="${(window.SD && window.SD.social && window.SD.social.twitter) || 'https://twitter.com/staydekho'}" target="_blank" rel="noopener" aria-label="Twitter">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>
            </a>
            <a href="${(window.SD && window.SD.whatsapp_link) || 'https://wa.me/918769905983'}" target="_blank" rel="noopener" aria-label="WhatsApp">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>`;
}

// ── Floating Call + WhatsApp CTA ─────────────────────
function injectFloatingCTA() {
  if (document.getElementById('sd-float-cta')) return;
  const cfg = window.SD || {};
  const phone    = cfg.phone_tel     || 'tel:';
  const wa       = cfg.whatsapp_link || '#';

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #sd-float-cta {
      position: fixed; bottom: 90px; right: 20px;
      display: flex; flex-direction: column; gap: 12px; z-index: 9998;
    }
    .sd-fab {
      display: flex; align-items: center; justify-content: flex-end;
      gap: 0; border-radius: 50px; color: #fff; text-decoration: none;
      box-shadow: 0 4px 18px rgba(0,0,0,.22);
      transition: all .3s cubic-bezier(.4,0,.2,1);
      overflow: hidden; width: 52px; height: 52px; padding: 0 14px;
      font-family: Inter, sans-serif; font-size: 13px; font-weight: 700;
    }
    .sd-fab svg { flex-shrink: 0; }
    .sd-fab-label {
      max-width: 0; overflow: hidden; white-space: nowrap;
      opacity: 0; transition: max-width .3s ease, opacity .25s ease, margin .3s ease;
      margin-left: 0;
    }
    .sd-fab:hover { width: auto; padding: 0 18px 0 14px; gap: 8px; }
    .sd-fab:hover .sd-fab-label { max-width: 120px; opacity: 1; margin-left: 0; }
    .sd-fab-wa   { background: #25D366; }
    .sd-fab-call { background: #8B1717; }
    @media (max-width: 600px) {
      #sd-float-cta { bottom: 80px; right: 16px; }
      .sd-fab { width: 46px; height: 46px; }
    }
  `;
  document.head.appendChild(style);

  // Inject buttons
  const wrap = document.createElement('div');
  wrap.id = 'sd-float-cta';
  wrap.innerHTML = `
    <a href="${wa}" target="_blank" rel="noopener" class="sd-fab sd-fab-wa" aria-label="WhatsApp">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.861L.057 23.428a.75.75 0 0 0 .916.916l5.567-1.476A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.707 9.707 0 0 1-4.953-1.357l-.355-.21-3.676.974.986-3.589-.231-.369A9.712 9.712 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
      </svg>
      <span class="sd-fab-label">WhatsApp</span>
    </a>
    <a href="${phone}" class="sd-fab sd-fab-call" aria-label="Call Us">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.574 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
      <span class="sd-fab-label">Call Us</span>
    </a>
  `;
  document.body.appendChild(wrap);
}

// ── Inject nav + footer ───────────────────────────────
(function inject() {
  const navEl = document.getElementById('nav-placeholder');
  if (navEl) navEl.outerHTML = buildNav();

  const footerEl = document.getElementById('footer-placeholder');
  if (footerEl) footerEl.outerHTML = buildFooter();

  injectFloatingCTA();

  // Navbar scroll behavior
  const navbar = document.getElementById('navbar');
  if (navbar) {
    function updateNav() {
      const scrolled = window.scrollY > 60;
      navbar.classList.toggle('nav-scrolled', scrolled);
      navbar.classList.toggle('nav-top', !scrolled);
    }
    window.addEventListener('scroll', updateNav, { passive: true });
    updateNav();
  }

  // Reveal animations (IntersectionObserver)
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        const children = e.target.querySelectorAll(':scope > *');
        children.forEach((c, i) => {
          setTimeout(() => c.classList.add('visible'), i * 70);
        });
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal, .reveal-left, .stagger').forEach(el => io.observe(el));

  // Auto-close mobile drawer when window is resized to desktop width
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      const drawer = document.getElementById('mobile-nav-drawer');
      if (drawer) drawer.classList.remove('open');
    }
  }, { passive: true });

  // Make body visible (some pages hide it on load)
  document.body.classList.add('loaded');
  document.body.style.opacity = '1';
})();

// ── Shared logout helper ──────────────────────────────
function doLogout() {
  localStorage.removeItem('sd_token');
  localStorage.removeItem('sd_user');
  window.location.href = 'login.html';
}
window.doLogout = doLogout;
