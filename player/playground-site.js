(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__coursePlaygroundSiteInit) return;
  window.__coursePlaygroundSiteInit = true;

  var CPP_LANGS = { cpp: true, 'c++': true, cxx: true };
  var TOOLTIP = {
    en: 'Open in Execution Playground',
    ru: 'Открыть в песочнице выполнения',
  };

  function getLang() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('ru') === 0
      ? 'ru'
      : 'en';
  }

  function getTheme() {
    var theme = document.documentElement.dataset.theme;
    if (theme === 'light' || theme === 'dark') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function playgroundBaseUrl() {
    var meta = document.querySelector('meta[name="cv-playground-url"]');
    if (meta && meta.content) return meta.content;
    var asset = document.querySelector(
      'link[href*="/site-assets/"], script[src*="/site-assets/"]'
    );
    if (asset) {
      var raw = asset.getAttribute('href') || asset.getAttribute('src') || '';
      var idx = raw.indexOf('/site-assets/');
      if (idx >= 0) return raw.slice(0, idx) + '/playground/';
    }
    return '/playground/';
  }

  function buildPlaygroundHref(opts) {
    var params = new URLSearchParams();
    if (opts && typeof opts.code === 'string') {
      params.set('code', opts.code);
    }
    if (opts && opts.mode) {
      params.set('mode', opts.mode);
    }
    params.set('lang', getLang());
    params.set('theme', getTheme());
    return playgroundBaseUrl() + '?' + params.toString();
  }

  function extractCode(block) {
    var copyBtn = block.querySelector('.copy button[data-code]');
    if (copyBtn && copyBtn.dataset.code) {
      return copyBtn.dataset.code.replace(/\x7f/g, '\n');
    }
    var lines = block.querySelectorAll('pre .ec-line .code');
    if (lines.length > 0) {
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        out.push(lines[i].textContent || '');
      }
      return out.join('\n');
    }
    var pre = block.querySelector('pre');
    return pre ? pre.textContent || '' : '';
  }

  function isCppBlock(block) {
    var pre = block.querySelector('pre[data-language]');
    if (!pre) return true;
    var lang = (pre.getAttribute('data-language') || '').toLowerCase();
    return Boolean(CPP_LANGS[lang]);
  }

  function visualizationMode(visHost) {
    var script = visHost.querySelector('script[type="application/json"]');
    if (!script) return 'trace';
    try {
      var data = JSON.parse(script.textContent || '{}');
      return data && data.kind === 'layout' ? 'layout' : 'trace';
    } catch (_err) {
      return 'trace';
    }
  }

  function injectHeaderButtons() {
    var selectors = ['.header .right-group', '.mobile-preferences'];
    for (var i = 0; i < selectors.length; i++) {
      var container = document.querySelector(selectors[i]);
      if (!container || container.querySelector('.cv-rainbow-header')) continue;
      var link = document.createElement('a');
      link.className = 'cv-rainbow-link cv-rainbow-header';
      link.textContent = 'Execution Playground';
      link.href = buildPlaygroundHref({});
      link.setAttribute('data-astro-reload', '');
      var themeEl = container.querySelector('starlight-theme-select');
      if (themeEl) {
        container.insertBefore(link, themeEl);
      } else {
        container.appendChild(link);
      }
    }
  }

  function attachCodeButtons() {
    var root =
      document.querySelector('.sl-markdown-content') ||
      document.querySelector('main') ||
      document.body;
    if (!root) return;

    var nodes = root.querySelectorAll('.expressive-code, .course-visualization');
    var lastCpp = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.classList.contains('expressive-code')) {
        if (!node.closest('details') && isCppBlock(node)) {
          lastCpp = node;
        }
        continue;
      }
      if (!lastCpp || lastCpp.querySelector('.cv-ec-playground-btn')) continue;
      var copyWrap = lastCpp.querySelector('.copy');
      if (!copyWrap) continue;
      var code = extractCode(lastCpp);
      if (!code.trim()) continue;
      var mode = visualizationMode(node);
      var btn = document.createElement('a');
      btn.className = 'cv-ec-playground-btn';
      btn.href = buildPlaygroundHref({ code: code, mode: mode });
      btn.setAttribute('data-cv-code', code);
      btn.setAttribute('data-cv-mode', mode);
      btn.setAttribute('data-astro-reload', '');
      var tip = TOOLTIP[getLang()] || TOOLTIP.en;
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
      btn.innerHTML =
        '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">' +
        '<path d="M5 3.5v13l11-6.5z"/></svg>';
      copyWrap.appendChild(btn);
      lastCpp.classList.add('cv-has-playground');
    }
  }

  function syncLinkTargets() {
    var navHref = buildPlaygroundHref({});
    var navLinks = document.querySelectorAll('a.cv-rainbow-link');
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].href = navHref;
    }
    var tip = TOOLTIP[getLang()] || TOOLTIP.en;
    var codeBtns = document.querySelectorAll('a.cv-ec-playground-btn');
    for (var j = 0; j < codeBtns.length; j++) {
      var btn = codeBtns[j];
      var code = btn.getAttribute('data-cv-code') || '';
      var mode = btn.getAttribute('data-cv-mode') || 'trace';
      btn.href = buildPlaygroundHref({ code: code, mode: mode });
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
    }
  }

  function enhance() {
    injectHeaderButtons();
    attachCodeButtons();
    syncLinkTargets();
  }

  new MutationObserver(syncLinkTargets).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'lang'],
  });
  document.addEventListener('astro:page-load', enhance);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
})();
