(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SpectraLinkGuard = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CANONICAL_SPECSOFT_SITE = 'https://specsoftdev.netlify.app';
  const SPEC_HOSTS = new Set([
    'specsoft.co.uk',
    'www.specsoft.co.uk',
    'specsoftdev.netlify.app',
    'www.specsoftdev.netlify.app'
  ]);

  function sanitizeSpecsoftLinks(text) {
    if (typeof text !== 'string' || !text) return text;

    return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, function (url) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (SPEC_HOSTS.has(host) || /(^|\.)specsoft(\.|$)/i.test(host)) {
          return CANONICAL_SPECSOFT_SITE;
        }
      } catch (e) {}
      return url;
    });
  }

  return { CANONICAL_SPECSOFT_SITE, sanitizeSpecsoftLinks };
}));
