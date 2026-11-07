/* SPECSOFT® — Community glow-up (community-fx.js). Self-contained, no dependencies. */
(function () {
    'use strict';

    var calm = false;
    try {
        var s = JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}') || {};
        calm = s.reduceMotion === true;
    } catch (e) { /* ignore */ }
    calm = calm || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

    /* ---------- scroll progress ---------- */
    var bar = document.createElement('div');
    bar.className = 'cx-progress';
    document.body.appendChild(bar);
    function onScroll() {
        var h = document.documentElement.scrollHeight - innerHeight;
        bar.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
    }
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- reveal on scroll ---------- */
    var revealSel = '.section-header, .cm-do-card, .cm-team-card, .cm-career-card, .cm-chat-cta, .cx-tile, .cx-quiz, .cx-lead, .cm-careers-lead';
    var items = document.querySelectorAll(revealSel);
    if (!calm && 'IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { en.target.classList.add('cx-in'); io.unobserve(en.target); }
            });
        }, { threshold: 0.12 });
        items.forEach(function (el, i) {
            el.classList.add('cx-rv');
            el.style.transitionDelay = (i % 4) * 70 + 'ms';
            io.observe(el);
        });
    }

    /* ---------- cursor spotlight + tilt ---------- */
    var cards = document.querySelectorAll('.cm-do-card, .cm-team-card, .cm-career-card, .cx-tile, .cx-quiz');
    cards.forEach(function (card) {
        var spot = document.createElement('i');
        spot.className = 'cx-spot';
        card.insertBefore(spot, card.firstChild);
        if (!fine) return;
        var tilt = !calm && !card.classList.contains('cx-quiz');
        if (tilt) card.classList.add('cx-tilt');
        card.addEventListener('pointermove', function (e) {
            var r = card.getBoundingClientRect();
            var x = e.clientX - r.left, y = e.clientY - r.top;
            card.style.setProperty('--mx', x + 'px');
            card.style.setProperty('--my', y + 'px');
            if (tilt) {
                var rx = ((y / r.height) - 0.5) * -6, ry = ((x / r.width) - 0.5) * 6;
                card.style.transform = 'perspective(800px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateY(-3px)';
            }
        });
        card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    });

    /* ---------- FIND YOUR SQUAD quiz ---------- */
    var root = document.getElementById('cxQuiz');
    if (!root) return;

    var Q = [
        { t: 'Perfect Friday night?', o: [
            ['dev', 'Shipping a feature at 2 AM, no regrets'],
            ['games', 'Ranked grind with the squad'],
            ['comm', 'Movie night in VC, popcorn included'],
            ['art', 'Sketching something nobody asked for']] },
        { t: 'Pick a superpower', o: [
            ['dev', 'Fix any bug instantly'],
            ['games', 'Never lose a 1v1 again'],
            ['comm', 'Everyone just gets along'],
            ['art', 'Turn any idea into a visual']] },
        { t: 'In a group project, you are the one who...', o: [
            ['dev', 'builds the actual thing'],
            ['games', 'playtests and breaks it'],
            ['comm', 'keeps everyone in sync'],
            ['art', 'makes it look insane']] },
        { t: 'Your most open tab right now?', o: [
            ['dev', 'Code editor + 14 Stack Overflow tabs'],
            ['games', 'Roblox, obviously'],
            ['comm', 'Discord, 99+ unread'],
            ['art', 'Figma, After Effects, or a sketchbook']] }
    ];
    var R = {
        dev:   { n: 'The Builder', team: 'DEVELOPMENT', d: 'You turn ideas into working things. Systems, tools and late-night bug hunts are your natural habitat.', apply: 'Roblox Developer' },
        games: { n: 'The Grinder', team: 'ROBLOX & GAMES', d: 'Playtests, competition and game feel are your thing. Apex Clan and Ability Arena are calling your name.', apply: 'Roblox Developer' },
        comm:  { n: 'The Connector', team: 'COMMUNITY', d: 'You make people feel at home. Moderation, events and good vibes run through you.', apply: 'Community Moderator' },
        art:   { n: 'The Visionary', team: 'CREATIVE', d: 'You see how things should look and move. UI, motion and branding are where you shine.', apply: 'UI & Motion Designer' }
    };
    var ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    var step = 0, score;

    function reset() { step = 0; score = { dev: 0, games: 0, comm: 0, art: 0 }; draw(); }

    function draw() {
        var mount = root.querySelector('.cx-mount');
        if (step >= Q.length) return result(mount);
        var q = Q[step], bars = '';
        for (var i = 0; i < Q.length; i++) bars += '<i class="' + (i <= step ? 'on' : '') + '"></i>';
        var opts = q.o.map(function (o, i) {
            return '<button type="button" class="cx-opt" data-k="' + o[0] + '"><b>' + 'ABCD'[i] + '</b><span>' + o[1] + '</span></button>';
        }).join('');
        mount.innerHTML = '<div class="cx-step"><div class="cx-q-top"><span>QUESTION ' + (step + 1) + ' / ' + Q.length + '</span><div class="cx-bars">' + bars + '</div></div>' +
            '<h3 class="cx-q-title">' + q.t + '</h3><div class="cx-opts">' + opts + '</div></div>';
    }

    function result(mount) {
        var keys = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
        var top = keys[0], r = R[top];
        var match = keys.map(function (k, i) {
            return '<span class="' + (i === 0 ? 'top' : '') + '">' + R[k].team + ' ' + Math.round(score[k] / Q.length * 100) + '%</span>';
        }).join('');
        mount.innerHTML = '<div class="cx-step cx-result"><div class="cx-res-kicker">YOUR SQUAD</div>' +
            '<div class="cx-res-name">' + r.n + '</div><span class="cx-res-team">TEAM // ' + r.team + '</span>' +
            '<p class="cx-res-desc">' + r.d + ' Open role that fits: <strong>' + r.apply + '</strong>.</p>' +
            '<div class="cx-res-actions"><a href="chats.html" class="btn-primary">CHAT WITH THE SQUAD ' + ARROW + '</a>' +
            '<a href="#careers" class="btn-secondary">SEE OPEN ROLES ' + ARROW + '</a>' +
            '<button type="button" class="btn-secondary" data-act="share">COPY MY RESULT</button>' +
            '<button type="button" class="btn-secondary" data-act="again">RETAKE</button></div>' +
            '<div class="cx-match">' + match + '</div></div>';
        root.dataset.res = r.n;
    }

    root.addEventListener('click', function (e) {
        var opt = e.target.closest('.cx-opt');
        if (opt) { score[opt.dataset.k]++; step++; draw(); return; }
        var act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'again') reset();
        if (act.dataset.act === 'share') {
            var txt = 'I got ' + root.dataset.res + ' on SPECSOFT. Find your squad: ' + location.href.split('#')[0] + '#squad';
            var done = function () { act.textContent = 'COPIED!'; setTimeout(function () { act.textContent = 'COPY MY RESULT'; }, 1600); };
            if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done); else done();
        }
    });

    reset();
})();
