/* =========================================================
   Elvira Technologies — shopping cart
   Include AFTER elvira-auth.js on every page that has the header.
   - Cart icon (white) next to the login button / user menu with a counter badge.
   - Half-page white drawer; the rest of the page is #2d2d2d at 80%.
   - Only product IDs are stored in the browser. Prices are always
     recalculated by the server, so nothing here can change what you pay.
   ========================================================= */
(function () {
  var KEY = 'elviraCart';
  var MAX = 25;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function euro(n) { return '\u20AC' + (Math.round((n || 0) * 100) / 100).toFixed(2); }

  // ---------- storage ----------
  function read() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (id) { return UUID.test(id); }).slice(0, MAX) : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* storage blocked */ }
    updateBadge();
    document.dispatchEvent(new CustomEvent('elvira:cart', { detail: { ids: list.slice() } }));
  }

  var Cart = {
    ids: read,
    has: function (id) { return read().indexOf(id) !== -1; },
    add: function (id) {
      if (!UUID.test(id)) return false;
      var list = read();
      if (list.indexOf(id) === -1) list.push(id);
      write(list);
      return true;
    },
    remove: function (id) { write(read().filter(function (x) { return x !== id; })); },
    clear: function () { write([]); },
    // "Buy now": pay for this one product without touching the saved cart.
    buy: function (id) {
      if (!UUID.test(id)) return;
      sessionStorage.setItem('elviraCheckout', JSON.stringify([id]));
      window.location.href = 'yourorder.html';
    },
    open: function () { openDrawer(); },
    close: function () { closeDrawer(); }
  };
  window.ElviraCart = Cart;

  // ---------- styles ----------
  var CSS =
    '.ev-cart-btn{position:relative;background:none;border:none;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;margin-left:8px;transition:background .2s ease;}' +
    '.ev-cart-btn:hover{background:rgba(255,255,255,.12);}' +
    '.ev-cart-btn .material-symbols-outlined{font-size:28px;color:#fff;line-height:1;}' +
    '.ev-cart-badge{position:absolute;top:2px;right:0;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#fff;color:#000;font:600 12px/20px Inter,sans-serif;text-align:center;display:none;box-shadow:0 0 0 2px #2d2d2d;}' +
    '.ev-cart-badge.show{display:block;}' +
    '#evCartOverlay{position:fixed;inset:0;background:rgba(45,45,45,.8);z-index:3000;display:none;justify-content:flex-end;}' +
    '#evCartOverlay.open{display:flex;}' +
    '#evCartPanel{position:relative;background:#fff;width:50%;min-width:380px;max-width:100%;height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 32px rgba(0,0,0,.25);animation:evSlide .25s ease;font-family:Inter,sans-serif;color:#000;}' +
    '@keyframes evSlide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}' +
    '#evCartClose{position:absolute;top:14px;right:16px;background:none;border:none;cursor:pointer;font:400 26px/1 "Google Sans",Arial,sans-serif;color:#000;padding:8px;}' +
    '#evCartPanel h2{font-size:28px;font-weight:700;padding:28px 56px 18px 28px;}' +
    '#evCartList{flex:1;overflow-y:auto;padding:0 28px;}' +
    '.ev-item{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid #E6E6E6;transition:opacity .25s ease,transform .25s ease;}' +
    '.ev-item.removing{opacity:0;transform:translateX(24px);}' +
    '.ev-item__link{display:flex;align-items:center;gap:14px;flex:1;min-width:0;text-decoration:none;color:inherit;}' +
    '.ev-item__img{width:64px;height:64px;border-radius:8px;object-fit:cover;background:#F7F7F7;flex-shrink:0;}' +
    '.ev-item__name{font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.ev-item__price{font-size:15px;margin-top:4px;}' +
    '.ev-item__price s{color:#828282;margin-right:6px;}' +
    '.ev-item__check{width:24px;height:24px;accent-color:#000;cursor:pointer;flex-shrink:0;}' +
    '.ev-empty{padding:48px 0;text-align:center;color:#828282;font-size:17px;}' +
    '#evCartFoot{padding:20px 28px 28px;border-top:1px solid #E6E6E6;}' +
    '.ev-total{display:flex;justify-content:space-between;font-size:22px;font-weight:700;}' +
    '.ev-saved{font-size:13px;color:#828282;margin-top:4px;}' +
    '#evPay{margin-top:18px;width:100%;background:#000;color:#fff;border:none;border-radius:8px;padding:16px 0;font:500 18px Inter,sans-serif;cursor:pointer;transition:opacity .2s ease;}' +
    '#evPay:disabled{opacity:.35;cursor:not-allowed;}' +
    '@media(max-width:768px){#evCartPanel{width:100%;min-width:0;}#evCartPanel h2{font-size:24px;padding-left:20px;}#evCartList{padding:0 20px;}#evCartFoot{padding:16px 20px 24px;}}';

  function ensureAssets() {
    if (!document.getElementById('evCartStyle')) {
      var st = document.createElement('style');
      st.id = 'evCartStyle';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!document.querySelector('link[href*="Material+Symbols"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@48,400,0,0';
      document.head.appendChild(l);
    }
  }

  // ---------- header icon ----------
  var btn, badge;

  function updateBadge() {
    if (!badge) return;
    var n = read().length;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('show', n > 0);
  }

  function placeButton() {
    var nav = document.getElementById('mainNav');
    if (!nav || !btn) return;
    var anchor = nav.querySelector('#userMenu') || nav.querySelector('#loginBtn') || nav.querySelector('.login-btn');
    if (anchor) nav.insertBefore(btn, anchor);
    else if (btn.parentNode !== nav) nav.appendChild(btn);
  }

  function buildButton() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ev-cart-btn';
    btn.setAttribute('aria-label', 'Shopping cart');
    btn.innerHTML = '<span class="material-symbols-outlined">shopping_cart</span><span class="ev-cart-badge"></span>';
    badge = btn.querySelector('.ev-cart-badge');
    btn.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(); });
    placeButton();
    updateBadge();
  }

  // ---------- drawer ----------
  var overlay, listEl, totalEl, savedEl, payBtn, items = [];

  function buildDrawer() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'evCartOverlay';
    overlay.innerHTML =
      '<aside id="evCartPanel" role="dialog" aria-modal="true" aria-label="Shopping cart">' +
        '<button id="evCartClose" type="button" aria-label="Close cart">\u2715</button>' +
        '<h2>Your cart</h2>' +
        '<div id="evCartList"></div>' +
        '<div id="evCartFoot">' +
          '<div class="ev-total"><span>Total</span><span id="evTotal">\u20AC0.00</span></div>' +
          '<div class="ev-saved" id="evSaved"></div>' +
          '<button id="evPay" type="button" disabled>Pay</button>' +
        '</div>' +
      '</aside>';
    document.body.appendChild(overlay);
    listEl = overlay.querySelector('#evCartList');
    totalEl = overlay.querySelector('#evTotal');
    savedEl = overlay.querySelector('#evSaved');
    payBtn = overlay.querySelector('#evPay');

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDrawer(); });
    overlay.querySelector('#evCartClose').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    // Unticking a product removes it from the cart.
    listEl.addEventListener('change', function (e) {
      var box = e.target.closest('.ev-item__check');
      if (!box || box.checked) return;
      var row = box.closest('.ev-item');
      var id = row.getAttribute('data-id');
      row.classList.add('removing');
      Cart.remove(id);
      items = items.filter(function (i) { return i.id !== id; });
      setTimeout(render, 240);
    });

    payBtn.addEventListener('click', function () {
      var ids = read();
      if (!ids.length) return;
      sessionStorage.setItem('elviraCheckout', JSON.stringify(ids));
      window.location.href = 'yourorder.html';
    });
  }

  function render() {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<div class="ev-empty">Your cart is empty.</div>';
      totalEl.textContent = euro(0);
      savedEl.textContent = '';
      payBtn.disabled = true;
      return;
    }
    var total = 0, saved = 0;
    listEl.innerHTML = items.map(function (i) {
      total += i.final;
      saved += Math.max(0, i.original - i.final);
      var price = i.final < i.original ? '<s>' + euro(i.original) + '</s>' + euro(i.final) : euro(i.final);
      return (
        '<div class="ev-item" data-id="' + esc(i.id) + '">' +
          '<a class="ev-item__link" href="product.html?id=' + encodeURIComponent(i.id) + '">' +
            '<img class="ev-item__img" src="' + esc(i.image || 'https://i.ibb.co/v4Fk3Cjf/image.png') + '" alt="">' +
            '<div style="min-width:0"><div class="ev-item__name">' + esc(i.name) + '</div><div class="ev-item__price">' + price + '</div></div>' +
          '</a>' +
          '<input class="ev-item__check" type="checkbox" checked aria-label="Keep ' + esc(i.name) + ' in the cart">' +
        '</div>'
      );
    }).join('');
    totalEl.textContent = euro(total);
    savedEl.textContent = saved > 0 ? 'You save ' + euro(saved) + ' in total' : '';
    payBtn.disabled = false;
  }

  function load() {
    var ids = read();
    if (!ids.length) { items = []; render(); return; }
    listEl.innerHTML = '<div class="ev-empty">Loading\u2026</div>';
    fetch('/api/shop/cart?ids=' + encodeURIComponent(ids.join(',')), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        items = (data.items || []);
        // Products that no longer exist are dropped from the cart.
        var alive = items.map(function (i) { return i.id; });
        if (alive.length !== ids.length) write(alive);
        render();
      })
      .catch(function () { listEl.innerHTML = '<div class="ev-empty">Could not load your cart. Please try again.</div>'; });
  }

  function openDrawer() {
    buildDrawer();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    load();
  }
  function closeDrawer() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    ensureAssets();
    buildButton();
    // elvira-auth.js swaps the login button for the user menu after /api/session answers.
    document.addEventListener('elvira:session', placeButton);
    window.addEventListener('storage', function (e) { if (e.key === KEY) updateBadge(); });
  });
})();
