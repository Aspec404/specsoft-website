/* ==========================================================================
   SPECSOFT® index-content.js  -  live data for the new homepage sections

   - BY THE NUMBERS  -> public_site_stats()   (real counts, animated count-up)
   - THE TEAM        -> public_team_roster()  (real staff_members + profiles)
   - SELECTED WORK   -> a few more real rows from profile_projects, appended
                        after the existing Project Spectra card
   - FAQ             -> pure DOM accordion, no network needed

   Needs supabase-homepage.sql installed, and the Supabase SDK already on the
   page (same CDN tag used by roles.js / notifications.js). If that script
   never loads (blocked, offline, whatever), every function here just no-ops
   or shows a plain status line instead of breaking the page.
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var _sb = null;
    function client() {
        if (_sb) return _sb;
        try {
            _sb = window.getSupabaseClient ? window.getSupabaseClient() : (
                (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
                    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null
            );
        } catch (e) { _sb = null; }
        return _sb;
    }

    function statusEl(text) {
        var p = document.createElement('p');
        p.className = 'team-status';
        p.textContent = text;
        return p;
    }

    /* ----------------------------------------------------------------------
       FAQ accordion
       ---------------------------------------------------------------------- */
    function initFaq() {
        document.querySelectorAll('.faq-item').forEach(function (item) {
            var q = item.querySelector('.faq-q');
            var list = item.closest('.faq-list');
            if (!q) return;
            q.addEventListener('click', function () {
                var wasOpen = item.classList.contains('is-open');
                if (list) {
                    list.querySelectorAll('.faq-item.is-open').forEach(function (open) {
                        if (open !== item) open.classList.remove('is-open');
                    });
                }
                item.classList.toggle('is-open', !wasOpen);
            });
        });
    }

    /* ----------------------------------------------------------------------
       BY THE NUMBERS — real counts, animated once in view
       ---------------------------------------------------------------------- */
    function animateCount(el, to, duration) {
        var start = null;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min(1, (ts - start) / duration);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(to * eased).toLocaleString();
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = to.toLocaleString();
        }
        requestAnimationFrame(step);
    }

    function initStats() {
        var grid = document.getElementById('statsGrid');
        var sb = client();
        if (!grid || !sb) return;

        sb.rpc('public_site_stats', {}).then(function (res) {
            if (res.error || !res.data) return;
            var data = res.data;
            var tiles = grid.querySelectorAll('.stat-tile');
            var started = false;
            function reveal() {
                if (started) return;
                started = true;
                tiles.forEach(function (tile) {
                    var val = Number(data[tile.dataset.stat] || 0);
                    var span = tile.querySelector('.stat-value');
                    if (span) animateCount(span, val, 900);
                });
            }
            if ('IntersectionObserver' in window) {
                var io = new IntersectionObserver(function (entries) {
                    entries.forEach(function (e) { if (e.isIntersecting) { reveal(); io.disconnect(); } });
                }, { threshold: 0.3 });
                io.observe(grid);
            } else reveal();
        }).catch(function () {});
    }

    /* ----------------------------------------------------------------------
       THE TEAM — real staff_members, live
       ---------------------------------------------------------------------- */
    function initials(name) {
        return (name || '?').trim().slice(0, 2).toUpperCase();
    }

    function buildTeamCard(m) {
        var card = document.createElement('div');
        card.className = 'team-card';

        var avatar = document.createElement('div');
        avatar.className = 'team-avatar';
        if (m.avatar_url) {
            var img = document.createElement('img');
            img.src = m.avatar_url; img.alt = ''; img.loading = 'lazy';
            avatar.appendChild(img);
        } else {
            avatar.textContent = initials(m.display_name || m.username);
        }

        var name = document.createElement('div');
        name.className = 'team-name';
        name.textContent = m.display_name || ('@' + m.username);

        var headline = document.createElement('div');
        headline.className = 'team-headline';
        headline.textContent = m.headline || '';

        var level = document.createElement('span');
        level.className = 'team-level' + (m.level === 'owner' ? ' is-owner' : '');
        level.textContent = (m.level || '').toUpperCase();

        card.appendChild(avatar);
        card.appendChild(name);
        card.appendChild(headline);
        card.appendChild(level);
        return card;
    }

    function initTeam() {
        var grid = document.getElementById('teamGrid');
        if (!grid) return;
        var sb = client();
        if (!sb) {
            grid.innerHTML = '';
            grid.appendChild(statusEl('Team roster unavailable right now — check back soon.'));
            return;
        }

        sb.rpc('public_team_roster', {}).then(function (res) {
            if (res.error) {
                grid.innerHTML = '';
                grid.appendChild(statusEl('Could not load the team right now.'));
                return;
            }
            var rows = Array.isArray(res.data) ? res.data : [];
            grid.innerHTML = '';
            if (!rows.length) {
                grid.appendChild(statusEl('No public staff listed yet.'));
                return;
            }
            rows.forEach(function (member, i) {
                var card = buildTeamCard(member);
                grid.appendChild(card);
                if (window.SpecFX) {
                    window.SpecFX.reveal(card, Math.min(i % 4, 3) * 70);
                    window.SpecFX.tilt(card, { maxDeg: 5 });
                }
            });
        }).catch(function () {
            grid.innerHTML = '';
            grid.appendChild(statusEl('Could not load the team right now.'));
        });
    }

    /* ----------------------------------------------------------------------
       SELECTED WORK — a few more real projects, appended after Project Spectra
       ---------------------------------------------------------------------- */
    function buildProjectCard(p) {
        var a = document.createElement('a');
        a.className = 'project-card';
        a.href = p.url || '#';
        if (p.url) { a.target = '_blank'; a.rel = 'noopener'; }

        var imgWrap = document.createElement('div');
        imgWrap.className = 'project-image';
        if (p.cover_url) {
            var img = document.createElement('img');
            img.src = p.cover_url; img.alt = ''; img.loading = 'lazy';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            imgWrap.appendChild(img);
        } else {
            var ph = document.createElement('div');
            ph.className = 'placeholder-img';
            imgWrap.appendChild(ph);
        }

        var info = document.createElement('div');
        info.className = 'project-info';

        var meta = document.createElement('div');
        meta.className = 'project-meta';
        var type = document.createElement('span');
        type.className = 'project-type';
        type.textContent = (p.tags && p.tags[0]) ? p.tags[0].toUpperCase() : 'PROJECT';
        var year = document.createElement('span');
        year.className = 'project-year';
        year.textContent = p.created_at ? new Date(p.created_at).getFullYear() : '';
        meta.appendChild(type); meta.appendChild(year);

        var h3 = document.createElement('h3');
        h3.textContent = p.title || 'Untitled';
        var desc = document.createElement('p');
        desc.textContent = p.summary || '';

        var tagsWrap = document.createElement('div');
        tagsWrap.className = 'project-tags';
        (p.tags || []).slice(0, 3).forEach(function (t) {
            var s = document.createElement('span');
            s.textContent = t;
            tagsWrap.appendChild(s);
        });

        info.appendChild(meta);
        info.appendChild(h3);
        info.appendChild(desc);
        info.appendChild(tagsWrap);
        a.appendChild(imgWrap);
        a.appendChild(info);
        return a;
    }

    function initExtraProjects() {
        var grid = document.getElementById('projectGrid');
        var sb = client();
        if (!grid || !sb) return;

        sb.from('profile_projects')
            .select('id,title,summary,url,cover_url,tags,created_at,pinned')
            .order('pinned', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(6)
            .then(function (res) {
                if (res.error || !Array.isArray(res.data)) return;
                var existingTitles = Array.prototype.map.call(
                    grid.querySelectorAll('.project-card h3'), function (h) { return h.textContent.trim().toLowerCase(); }
                );
                res.data.forEach(function (p, i) {
                    if (p.title && existingTitles.indexOf(p.title.trim().toLowerCase()) !== -1) return;
                    var card = buildProjectCard(p);
                    grid.appendChild(card);
                    if (window.SpecFX) {
                        window.SpecFX.reveal(card, Math.min(i % 4, 3) * 70);
                        window.SpecFX.tilt(card, { maxDeg: 5 });
                    }
                });
            }).catch(function () {});
    }

    function start() {
        try { initFaq(); } catch (e) {}
        try { initStats(); } catch (e) {}
        try { initTeam(); } catch (e) {}
        try { initExtraProjects(); } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
