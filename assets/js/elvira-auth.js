/* =========================================================
   Elvira Technologies — shared session/header script
   Include this on every page that has the site header.
   It talks to /api/session to find out if someone is logged in,
   swaps "Log in" for an avatar + dropdown menu, enforces the
   Roblox-verification / blocked-account redirects, and renders
   the site-wide status bar + information window.
   ========================================================= */
(function () {
  var CURRENT_PAGE = (window.location.pathname.split('/').pop() || 'index.html');

  function toNode(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Header: avatar / login ----------
  function buildUserMenu(session) {
    var name = session.discordUsername || 'Account';
    var avatar = session.avatarUrl || 'https://i.ibb.co/YTDKf9D7/image.png';
    var managementLink =
      session.role === 'admin' || session.role === 'staff'
        ? '<a href="managementarea.html">Management Area</a>'
        : '';

    return toNode(
      '<div class="user-menu" id="userMenu">' +
        '<button class="user-menu__trigger" id="userMenuTrigger" type="button" aria-haspopup="true" aria-expanded="false">' +
          '<img class="user-menu__avatar" src="' + escapeHtml(avatar) + '" alt="">' +
          '<span class="user-menu__name">' + escapeHtml(name) + '</span>' +
          '<span class="material-symbols-outlined user-menu__chevron">expand_more</span>' +
        '</button>' +
        '<div class="user-menu__dropdown" id="userMenuDropdown">' +
          '<a href="dashboard.html">My dashboard</a>' +
          '<a href="dashboard.html#licenses">My licenses</a>' +
          managementLink +
          '<button type="button" id="logoutBtn">Log out</button>' +
        '</div>' +
      '</div>'
    );
  }

  function initHeader(session) {
    var nav = document.getElementById('mainNav');
    if (!nav) return;
    var loginBtn = document.getElementById('loginBtn') || nav.querySelector('.login-btn');

    if (!session.loggedIn) {
      return; // Keep the default "Log in" button, which links straight to Discord OAuth.
    }

    if (loginBtn) loginBtn.remove();
    if (document.getElementById('userMenu')) return; // Already built.

    var menu = buildUserMenu(session);
    nav.appendChild(menu);

    var trigger = document.getElementById('userMenuTrigger');
    var dropdown = document.getElementById('userMenuDropdown');

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.toggle('open');
      trigger.classList.toggle('open', isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', function () {
      dropdown.classList.remove('open');
      trigger.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    });

    document.getElementById('logoutBtn').addEventListener('click', function () {
      window.location.href = '/api/auth/logout';
    });
  }

  // ---------- Site-wide status bar + information window ----------
  var STATUS_BAR_CSS =
    '#elviraStatusBar{position:fixed;top:0;left:0;width:100%;min-height:44px;background:#fff;' +
    'border-bottom:1px solid #E6E6E6;color:#000;font-family:"Inter",sans-serif;font-size:14px;' +
    'font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;' +
    'padding:10px 20px;text-align:center;z-index:2000;}' +
    '#elviraStatusBar a{color:#000;font-weight:700;text-decoration:underline;}' +
    '#elviraInfoOverlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;' +
    'align-items:center;justify-content:center;z-index:2100;padding:20px;}' +
    '#elviraInfoWindow{background:#2D2D2D;max-width:520px;width:100%;padding:40px 32px;position:relative;}' +
    '#elviraInfoWindow h2{font-family:"Inter",sans-serif;font-weight:700;font-size:38px;color:#fff;margin:0 0 14px;}' +
    '#elviraInfoWindow p{font-family:"Inter",sans-serif;font-weight:400;font-size:18px;color:#fff;' +
    'line-height:1.5;margin:0 0 26px;white-space:pre-line;}' +
    '#elviraInfoWindow .elvira-info-btns{display:flex;gap:12px;flex-wrap:wrap;}' +
    '#elviraInfoWindow .elvira-info-btns a{background:#fff;color:#000;font-family:"Inter",sans-serif;' +
    'font-weight:500;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:8px;}' +
    '#elviraInfoClose{position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;' +
    'color:#fff;font-family:"Google Sans",Arial,sans-serif;font-size:22px;line-height:1;padding:6px;}' +
    '@media(max-width:600px){#elviraInfoWindow{padding:28px 22px;} #elviraInfoWindow h2{font-size:28px;}}';

  function injectStatusBarCss() {
    if (document.getElementById('elviraStatusBarStyle')) return;
    var style = document.createElement('style');
    style.id = 'elviraStatusBarStyle';
    style.textContent = STATUS_BAR_CSS;
    document.head.appendChild(style);
  }

  function renderStatusBar(statusBar) {
    if (!statusBar || !statusBar.text) return;
    injectStatusBarCss();

    var bar = document.createElement('div');
    bar.id = 'elviraStatusBar';
    var html = '<span>' + escapeHtml(statusBar.text) + '</span>';
    if (statusBar.linkEnabled && statusBar.linkUrl && statusBar.linkText) {
      html += ' <a href="' + escapeHtml(statusBar.linkUrl) + '">' + escapeHtml(statusBar.linkText) + '</a>';
    }
    bar.innerHTML = html;
    document.body.prepend(bar);

    requestAnimationFrame(function () {
      var barHeight = bar.offsetHeight;
      var header = document.querySelector('header.site-header');
      var currentPadding = parseInt(getComputedStyle(document.body).paddingTop, 10) || 0;
      document.body.style.paddingTop = (currentPadding + barHeight) + 'px';
      if (header) header.style.top = barHeight + 'px';
    });
  }

  function renderInfoWindow(infoWindow) {
    if (!infoWindow || !infoWindow.title) return;
    if (infoWindow.pagesMode === 'selected' && infoWindow.pages.indexOf(CURRENT_PAGE) === -1) return;

    injectStatusBarCss();

    var overlay = document.createElement('div');
    overlay.id = 'elviraInfoOverlay';

    var closeBtnHtml = infoWindow.closable ? '<button id="elviraInfoClose" aria-label="Close">\u2715</button>' : '';
    var buttonsHtml = '';
    [infoWindow.button1, infoWindow.button2].forEach(function (btn) {
      if (btn && btn.text && btn.url) {
        buttonsHtml += '<a href="' + escapeHtml(btn.url) + '">' + escapeHtml(btn.text) + '</a>';
      }
    });

    overlay.innerHTML =
      '<div id="elviraInfoWindow">' +
        closeBtnHtml +
        '<h2>' + escapeHtml(infoWindow.title) + '</h2>' +
        (infoWindow.subtext ? '<p>' + escapeHtml(infoWindow.subtext) + '</p>' : '') +
        (buttonsHtml ? '<div class="elvira-info-btns">' + buttonsHtml + '</div>' : '') +
      '</div>';

    document.body.appendChild(overlay);

    if (infoWindow.closable) {
      var close = function () { overlay.remove(); };
      document.getElementById('elviraInfoClose').addEventListener('click', close);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
    }
  }

  function loadSiteConfig() {
    fetch('/api/public/site-config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (config) {
        renderStatusBar(config.statusBar);
        renderInfoWindow(config.infoWindow);
      })
      .catch(function () {
        // Backend not reachable yet — just skip the status bar / info window.
      });
  }

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    // Pages with their own full-screen flow that must never be interrupted
    // by the status bar, the info window, or the block/verification redirects.
    var skipSiteWideChecks = CURRENT_PAGE === 'block.html' || CURRENT_PAGE === 'onboarding.html';

    if (!skipSiteWideChecks) loadSiteConfig();

    fetch('/api/session', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (session) {
        window.elviraSession = session;
        initHeader(session);

        if (session.loggedIn && session.blocked && CURRENT_PAGE !== 'block.html') {
          window.location.href = 'block.html';
          return;
        }

        // A logged-in user who has not verified Roblox yet must not be able
        // to use the dashboard or the Management Area — send them to
        // onboarding instead, every time, until it's complete.
        var needsRoblox = CURRENT_PAGE === 'dashboard.html' || CURRENT_PAGE === 'managementarea.html';
        if (needsRoblox && (!session.loggedIn || !session.robloxVerified)) {
          window.location.href = session.loggedIn ? 'onboarding.html' : 'index.html';
          return;
        }

        if (CURRENT_PAGE === 'managementarea.html' && session.role !== 'admin' && session.role !== 'staff') {
          window.location.href = 'dashboard.html';
          return;
        }

        document.dispatchEvent(new CustomEvent('elvira:session', { detail: session }));
      })
      .catch(function () {
        // The backend/API isn't deployed or configured yet — let the
        // static pages keep working normally without a session.
        document.dispatchEvent(new CustomEvent('elvira:session', { detail: { loggedIn: false } }));
      });
  });
})();
