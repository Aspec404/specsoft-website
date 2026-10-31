/* SPECSOFT® Studio guard: Studio is PC only.
   Phones and tablets are blocked. Phones/tablets that pretend to be a PC ("desktop site" mode) are caught by
   looking at the HARDWARE instead of the user agent: a touch device whose main input is touch-only, a small
   physical screen with touch, or an iPad/iPhone asking for the desktop site (Macintosh + multi-touch).
   NOTE: this is a friendly gate, not security. Someone can still fake it with developer tools; everything that
   matters (saving, loading, RLS) is protected by Supabase on the server. Must be loaded in <head>, before the rest. */
(function () {
    'use strict';
    function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
    var ua = navigator.userAgent || '', uad = navigator.userAgentData, tp = navigator.maxTouchPoints || 0;
    var mobileUA = /Android|iPhone|iPod|iPad|Mobile|Windows Phone|IEMobile|Opera Mini|BlackBerry|webOS/i.test(ua) || !!(uad && uad.mobile === true);
    var touchOnly = mq('(pointer: coarse)') && mq('(hover: none)') && !mq('(any-pointer: fine)');
    var smallScreen = Math.min(screen.width || 9999, screen.height || 9999) < 700;
    var iosDesktop = /Macintosh/.test(ua) && tp > 1;                    // real Macs report 0 touch points; iPads and iPhones in desktop mode report 5
    var disguised = !mobileUA && tp > 0 && (touchOnly || smallScreen || iosDesktop);
    if (!mobileUA && !disguised) return;

    window.__STUDIO_BLOCKED = disguised ? 'desktop-mode' : 'mobile';
    var title = disguised ? 'haha. nice try.' : 'Studio is PC only';
    var text = disguised
        ? 'Desktop mode does not fool us. Studio is a full development environment that needs a keyboard, a mouse and a big screen, so go open it on a computer.'
        : 'SPECSOFT Studio is a full development environment that needs a keyboard, a mouse and a big screen. It is not supported on phones or tablets. Please open it on a PC.';
    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + ' | SPECSOFT\u00ae Studio</title><style>' +
        'html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0a0a0a;color:#f2f2f2;font-family:"Space Grotesk",system-ui,sans-serif;padding:24px;box-sizing:border-box}' +
        '.b{max-width:460px;text-align:center}.t{font:500 .72rem "JetBrains Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#8a8a8a;margin:0 0 18px}' +
        'h1{font-size:2.2rem;line-height:1.1;margin:0 0 14px}p{color:#b5b5b5;line-height:1.6;margin:0 0 26px}' +
        '.a{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}a{color:#f2f2f2;border:1px solid #666;padding:10px 16px;text-decoration:none;font:500 .85rem "JetBrains Mono",monospace}a:active{background:#f2f2f2;color:#0a0a0a}' +
        '</style></head><body><main class="b"><p class="t">SPECSOFT\u00ae Studio</p><h1>' + title + '</h1><p>' + text + '</p>' +
        '<div class="a"><a href="index.html">Back to SPECSOFT</a><a href="projects.html">Projects hub</a></div></main></body></html>';
    document.open(); document.write(html); document.close();          // replaces the page; the scripts after this one never run
})();
