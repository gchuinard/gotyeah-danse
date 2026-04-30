'use strict';

// ── BURGER MENU ──
function toggleMenu() {
  const burger = document.getElementById('nav-burger');
  const menu = document.getElementById('mobile-menu');
  burger.classList.toggle('open');
  menu.classList.toggle('open');
  document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
}
function closeMenu() {
  document.getElementById('nav-burger').classList.remove('open');
  document.getElementById('mobile-menu').classList.remove('open');
  document.body.style.overflow = '';
}

// ── COOKIES & CARTE ──
const GMAPS_SRC = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d5495.868002373758!2d0.47542420990348516!3d44.853041881538005!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12aad076e2522021%3A0x1f638222d38695de!2sEcole%20de%20danse%20-%20Desha%20Moulin%20Attitude!5e0!3m2!1sfr!2sfr!4v1775110036882!5m2!1sfr!2sfr';

function loadMap() {
  const el = document.getElementById('contact-map');
  el.innerHTML = '<iframe src="' + GMAPS_SRC + '" style="border:0;width:100%;height:100%;" allowfullscreen loading="lazy"></iframe>';
}

function showMapPlaceholder() {
  const el = document.getElementById('contact-map');
  el.innerHTML = '<div class="map-placeholder"><p>La carte n\'est pas affichée car vous avez refusé les cookies tiers.</p><a href="https://maps.google.com/?q=Ecole+de+danse+Desha+Moulin,+Bergerac" target="_blank" rel="noopener">Voir sur Google Maps →</a></div>';
}

function acceptCookies() {
  localStorage.setItem('cookies', 'accepted');
  document.getElementById('cookie-banner').classList.remove('visible');
  loadMap();
}

function refuseCookies() {
  localStorage.setItem('cookies', 'refused');
  document.getElementById('cookie-banner').classList.remove('visible');
  showMapPlaceholder();
}

function resetCookies() {
  localStorage.removeItem('cookies');
  closePrivacy();
  showMapPlaceholder();
  setTimeout(() => document.getElementById('cookie-banner').classList.add('visible'), 300);
}

function openPrivacy() { document.getElementById('privacy-modal').classList.add('open'); }
function closePrivacy() { document.getElementById('privacy-modal').classList.remove('open'); }

// Consentement initial : détermine l'état de la carte au chargement
const _consent = localStorage.getItem('cookies');
if (_consent === 'accepted') {
  loadMap();
} else if (_consent === 'refused') {
  showMapPlaceholder();
} else {
  showMapPlaceholder();
  setTimeout(() => document.getElementById('cookie-banner').classList.add('visible'), 800);
}

// ── PLANNING — IMPRESSION ──
function printPlanning() {
  const planning = document.getElementById('planning');

  const bodyChildren = Array.from(document.body.children);
  bodyChildren.forEach(el => { if (el !== planning) el.style.display = 'none'; });

  planning.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
  planning.querySelector('.planning-tabs').style.display = 'none';

  // Mise à l'échelle automatique pour tenir sur A4 paysage (≈ 1039×710 px à 96 dpi)
  const scaleW = 1039 / planning.scrollWidth;
  const scaleH = 710 / planning.scrollHeight;
  const scale = Math.min(scaleW, scaleH, 1);
  planning.style.zoom = scale;
  const topMargin = Math.max(0, (710 - planning.scrollHeight * scale) / 2);
  planning.style.marginTop = (topMargin / scale) + 'px';

  const prevTitle = document.title;
  document.title = 'Planning — École Desha-Moulin';
  window.print();

  // Restaurer
  document.title = prevTitle;
  planning.style.zoom = '';
  planning.style.marginTop = '';
  bodyChildren.forEach(el => { el.style.display = ''; });
  planning.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '';
    el.style.transform = '';
  });
  planning.querySelector('.planning-tabs').style.display = '';
}

// ── FAQ ──
function toggleFaq(btn) {
  const item = btn.parentElement;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ── SYNC ANNONCE → HERO OVERLAY (desktop) ──
(function () {
  const src = document.querySelector('.annonce');
  const dst = document.getElementById('hero-actu');
  if (src && dst) {
    dst.innerHTML = src.innerHTML;
    if (src.style.display === 'none') dst.style.display = 'none';
  }
})();

// ── NAV SCROLL ──
// annH est lu une seule fois (pas sur chaque scroll) pour éviter le forced reflow.
// On le rafraîchit uniquement quand la hauteur peut changer : resize ou fonts.ready.
const nav = document.getElementById('nav');
const annonce = document.querySelector('.annonce');
let annH = 0; // différé dans rAF — pas de lecture offsetHeight sur le critical path

function updateNavTop() {
  if (!nav.classList.contains('scrolled'))
    nav.style.top = Math.max(0, annH - window.scrollY) + 'px';
}

function refreshAnnH() {
  annH = annonce ? annonce.offsetHeight : 0;
  updateNavTop();
}

updateNavTop();
requestAnimationFrame(refreshAnnH);
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > annH + 10);
  nav.style.top = nav.classList.contains('scrolled') ? '0' : Math.max(0, annH - window.scrollY) + 'px';
}, { passive: true });
document.fonts.ready.then(refreshAnnH);
window.addEventListener('resize', refreshAnnH);

// ── REVEAL À L'INTERSECTION ──
const obs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

// ── DÉLÉGATION D'ÉVÉNEMENTS (remplace tous les onclick=) ──
document.addEventListener('click', function (event) {
  const el = event.target.closest('[data-action]');
  if (!el) return;

  switch (el.dataset.action) {
    case 'toggle-menu':
      toggleMenu();
      break;
    case 'close-menu':
      closeMenu();
      break;
    case 'print-planning':
      printPlanning();
      break;
    case 'toggle-faq':
      toggleFaq(el);
      break;
    case 'open-privacy':
      openPrivacy();
      break;
    case 'close-privacy':
      // Ferme si clic direct sur le backdrop (overlay) ou sur le bouton ✕
      if (event.target === el) closePrivacy();
      break;
    case 'accept-cookies':
      acceptCookies();
      break;
    case 'refuse-cookies':
      refuseCookies();
      break;
    case 'reset-cookies':
      resetCookies();
      break;
  }
});
