/* Lesson Board — student pages.
 * Each group folder has an index.html that sets window.LESSON_GROUP and loads this file.
 * The lessons come from feeds/<group>.json on this site (published by the board on every save),
 * or, if that file is missing or not from today, from the Google Sheet through the Apps Script feed (config.js).
 * ?present opens the projector view · ?demo uses the local preview data.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var GROUP = window.LESSON_GROUP;
  var DEMO = params.has('demo');
  var CACHE_KEY = 'lessons-feed-' + GROUP;
  var state = { feed: null, current: null, present: params.has('present'), slide: 0 };

  var ICON = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };

  var SECTION_LABEL = {};
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function fmtDate(iso, long) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  /** Section heading as HTML: the emoji sits in its own span so it keeps a little space from the title. */
  function heading(id, feed) {
    var e = id === 'phrase' ? '' : ((feed.emojis || {})[id] || '');
    return (e ? '<span class="emo">' + esc(e) + '</span>' : '') + esc(sectionTitle(id, feed));
  }
  function sectionTitle(id, feed) {
    if (id === 'phrase') return feed.group.level === 'B2.1' ? 'Saying of the day' : '☀ Collocation practice 🌙';
    return SECTION_LABEL[id] || id;
  }

  // ---------------------------------------------------------------- loading
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
    });
  }

  function today() {
    if (params.get('today')) return params.get('today');
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function fetchDemo() {
    return loadScript('../../../apps-script/Core.js').then(function () { return loadScript('../../../preview/demo-data.js'); }).then(function () {
      var db;
      try { db = JSON.parse(localStorage.getItem('lessonboard-demo-v1')); } catch (e) {}
      db = window.Core.normalise(db || JSON.parse(JSON.stringify(window.DEMO_DB)));
      return window.Core.feed(db, GROUP, today());
    });
  }

  /** Spain's date, whatever the device's time zone ("2026-10-08"). */
  function todayMadrid() {
    if (params.get('today')) return params.get('today');
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()); } catch (e) { return today(); }
  }

  /** The published copy on this site: fast. Accepted only if it was made today. */
  function fetchPublished() {
    var minute = Math.floor(Date.now() / 60000);          // a fresh copy at most once a minute
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch('../feeds/' + encodeURIComponent(GROUP) + '.json?m=' + minute, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (feed) {
        if (timer) clearTimeout(timer);
        if (!feed || feed.error || feed.today !== todayMadrid()) throw new Error('Published copy is not from today');
        return feed;
      }, function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  function fetchFeed() {
    return fetchPublished().catch(function () { return fetchGoogle(); });
  }

  function fetchGoogle() {
    var url = (window.LESSONS_CONFIG || {}).feedUrl;
    if (!url) return Promise.reject(new Error('The feed address is missing in config.js.'));
    var full = url + (url.indexOf('?') < 0 ? '?' : '&') + 'feed=' + encodeURIComponent(GROUP);
    return fetch(full).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return jsonp(full); });
  }

  function jsonp(url) {
    return new Promise(function (ok, fail) {
      var name = 'lbcb' + Date.now();
      window[name] = function (data) { delete window[name]; ok(data); };
      loadScript(url + '&callback=' + name).catch(function () { delete window[name]; fail(new Error('Could not reach the lesson feed.')); });
    });
  }

  function start() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
    if (cached && !DEMO) show(cached);
    (DEMO ? fetchDemo() : fetchFeed()).then(function (feed) {
      if (feed.error) throw new Error(feed.error);
      if (!DEMO) try { localStorage.setItem(CACHE_KEY, JSON.stringify(feed)); } catch (e) {}
      show(feed);
    }).catch(function (err) {
      if (window.console) console.error(err);
      if (!state.feed || !document.querySelector('.page')) {
        document.getElementById('app').innerHTML = '<div class="msg"><p>The lessons could not be loaded just now.</p>' +
          '<p style="font-size:13px;color:var(--ink-3)">' + esc(err.message) + '</p><button class="ibtn" onclick="location.reload()">Try again</button></div>';
      }
    });
  }

  function show(feed) {
    state.feed = feed;
    (feed.sections || []).forEach(function (s) { SECTION_LABEL[s.id] = s.label; });
    document.title = feed.group.name + ' · Lessons';
    var want = location.hash.slice(1);
    var list = feed.sessions;
    var found = list.filter(function (s) { return s.anchor === want; })[0];
    state.current = found || list[list.length - 1] || null;   // the newest: today's class, or this week's online work
    render();
  }

  // ---------------------------------------------------------------- page
  function blockHtml(b, opts) {
    opts = opts || {};
    var link = safeUrl(b.link) ? '<a class="linkbtn" href="' + esc(b.link) + '" target="_blank" rel="noopener">' + ICON.link +
      '<span>' + esc(b.linkLabel || 'Open') + '</span></a>' : '';
    var deco = b.kind === 'brainbreak' ? '🧠 ' : /^review\b/i.test(b.title || '') ? '👀 ' : '';
    var chip = b.book ? '<span class="book" title="From the book">📖 ' + esc(b.book) + '</span>' : '';
    var title = b.title || chip ? '<div class="blk-title">' + chip + deco + esc(b.title || '') + '</div>' : '';
    var img = b.image ? '<img class="blk-img" src="' + esc(b.image) + '" alt="' + esc(b.title || '') + '" loading="lazy">' : '';
    var inner = (b.continued ? '<div class="cont">Continued from last session</div>' : '') +
      (b.kind === 'image' ? img + title : title + img) +
      (b.html ? '<div class="blk-body">' + b.html + '</div>' : '') + link;
    if (b.kind === 'task' && !opts.present) {
      var key = 'tick-' + b.id, on = false;
      try { on = localStorage.getItem(key) === '1'; } catch (e) {}
      return '<div class="blk kind-task task' + (on ? ' ticked' : '') + '"><input type="checkbox" data-tick="' + esc(b.id) + '"' + (on ? ' checked' : '') +
        ' aria-label="Done"><div>' + inner + '</div></div>';
    }
    return '<div class="blk kind-' + esc(b.kind) + '">' + inner + '</div>';
  }

  function headerHtml(s) {
    var h = s.header;
    return '<div class="gframe"><div><h2>Goals</h2>' +
      (h.goals.length ? '<ul>' + h.goals.map(function (g) { return '<li>' + esc(g.text) + '</li>'; }).join('') + '</ul>' : '<p style="text-align:center;color:var(--ink-3)">—</p>') +
      '</div><div><h2>Activities</h2><ul class="acts"><li>Warm up &amp; Review</li>' +
      h.activities.map(function (a) { return '<li>' + (a.book ? '<span class="book">' + esc(a.book) + '</span>' : '') + esc(a.text) + '</li>'; }).join('') + '<li>Wrap up</li></ul></div></div>';
  }

  function grouped(s) {
    var out = [];
    (state.feed.sections || []).forEach(function (sec) {
      var list = s.blocks.filter(function (b) { return b.section === sec.id; });
      if (list.length) out.push({ id: sec.id, blocks: list });
    });
    return out;
  }

  function render() {
    var feed = state.feed, s = state.current, app = document.getElementById('app');
    document.body.className = 'theme-' + (feed.group.theme || 'sunset');
    var list = feed.sessions;
    var i = list.indexOf(s);
    var bar = '<div class="bar"><div class="who">' + esc(feed.group.name) + '<small>' + esc(feed.school || '') + (feed.school ? ' · ' : '') + 'Lessons</small></div><div class="grow"></div>' +
      '<button class="ibtn" data-go="-1"' + (i <= 0 ? ' disabled' : '') + ' aria-label="Previous session">' + ICON.left + '</button>' +
      '<button class="ibtn" data-go="1"' + (i < 0 || i >= list.length - 1 ? ' disabled' : '') + ' aria-label="Next session">' + ICON.right + '</button>' +
      (s && s.kind === 'f2f' && !s.cancelled ? '<button class="pill" data-present aria-label="Projector view">' + ICON.screen + '<span class="lbl">Project</span></button>' : '') + '</div>';

    if (!s) {
      app.innerHTML = bar + '<main><div class="msg">No lessons yet — they appear here on the day of each class.</div></main>';
      return;
    }
    var page = '<article class="page"><div class="pg-group">' + esc(s.label) +
      '<span>' + esc(fmtDate(s.date, true)) + (s.unit ? ' · ' + esc(s.unit) : '') + '</span></div>' +
      '<div class="banner' + (s.cancelled ? ' off' : '') + '"><h1>' + (s.cancelled ? 'No class<br>today' : s.kind === 'online' ? 'This week<br>online' : 'Today’s lesson<br>plan') + '</h1></div>' +
      (s.test ? '<div class="testbar">📝 ' + esc(s.test) + ' today</div>' : '') +
      (s.cancelled ? '<div class="nocl">' + (s.message ? esc(s.message).replace(/\n/g, '<br>') : 'This class won’t take place. See you next time!') + '</div>'
        : s.kind === 'f2f' ? headerHtml(s) : '');
    grouped(s).forEach(function (g) {
      var hd = s.kind === 'online' && g.id === 'tasks' ? '' : '<h2>' + heading(g.id, feed) + '</h2>';
      page += '<section class="sec" data-section="' + g.id + '">' + hd +
        g.blocks.map(function (b) { return blockHtml(b); }).join('') + '</section>';
    });
    page += '</article>';

    var archive = '<nav class="archive"><h3>All sessions</h3><ul>' + list.slice().reverse().map(function (x) {
      var first = x.cancelled ? { text: 'No class' } : x.test ? { text: '📝 ' + x.test } : x.header.activities[0] || x.blocks.filter(function (b) { return b.title; })[0];
      return '<li><a href="#' + x.anchor + '"' + (x === s ? ' class="on"' : '') + '><span><b>' + esc(x.label) + '</b>' +
        (first ? '<div class="tagline">' + esc(first.text || first.title) + '</div>' : '') + '</span><small>' + esc(fmtDate(x.date)) + '</small></a></li>';
    }).join('') + '</ul></nav>';

    app.innerHTML = bar + '<main>' + page + archive + '<p class="foot">Updated ' +
      esc(new Date(feed.generated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</p></main>';
    if (state.present) openPresent();
  }

  // ---------------------------------------------------------------- projector mode
  function slides(s) {
    var out = [{ type: 'title' }];
    grouped(s).forEach(function (g) {
      if (g.id === 'activities' && g.blocks.length > 1) {
        g.blocks.forEach(function (b) { out.push({ type: 'blocks', section: g.id, blocks: [b], small: true }); });
      } else out.push({ type: 'blocks', section: g.id, blocks: g.blocks });
    });
    return out;
  }

  function openPresent() {
    state.present = true;
    var s = state.current, feed = state.feed;
    var list = slides(s);
    state.slide = Math.max(0, Math.min(state.slide, list.length - 1));
    var sl = list[state.slide], inner;
    if (sl.type === 'title') {
      inner = '<div class="title-slide"><div class="banner"><h1>Today’s lesson plan</h1></div>' + headerHtml(s) + '</div>';
    } else {
      var cls = sl.small ? ' small' : sl.section === 'memory' ? ' memory' : '';
      inner = '<div class="slide-inner"><h2 class="sec-title' + cls + '">' + heading(sl.section, feed) + '</h2>' +
        sl.blocks.map(function (b) { return blockHtml(b, { present: true }); }).join('') + '</div>';
    }
    var el = document.querySelector('.present');
    if (!el) { el = document.createElement('div'); document.body.appendChild(el); }
    el.className = 'present theme-' + (feed.group.theme || 'sunset');
    el.innerHTML = '<div class="slide" data-next>' + inner + '</div><div class="pbar"><span class="count">' + (state.slide + 1) + ' / ' + list.length + '</span>' +
      '<div class="dots">' + list.map(function (_, k) { return '<i class="' + (k === state.slide ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<button class="ibtn" data-slide="-1" aria-label="Back">' + ICON.left + '</button><button class="ibtn" data-slide="1" aria-label="Forward">' + ICON.right + '</button>' +
      '<button class="ibtn" data-full aria-label="Full screen">' + ICON.full + '</button><button class="ibtn" data-close aria-label="Close">' + ICON.close + '</button></div>';
    fit(el.querySelector('.slide-inner'), el.querySelector('.slide'));
    el.querySelectorAll('img').forEach(function (im) {       // refit once pictures have their real size
      im.addEventListener('load', function () { fit(el.querySelector('.slide-inner'), el.querySelector('.slide')); });
    });
  }

  // Shrink long slides until they fit the screen.
  function fit(inner, box) {
    if (!inner) return;
    var scale = 1;
    inner.style.zoom = 1;
    while (inner.scrollHeight > box.clientHeight - 20 && scale > 0.45) {
      scale -= 0.07;
      inner.style.zoom = scale;
    }
  }

  function closePresent() {
    state.present = false;
    var el = document.querySelector('.present'); if (el) el.remove();
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function step(d) {
    var n = slides(state.current).length;
    state.slide = Math.max(0, Math.min(n - 1, state.slide + d));
    openPresent();
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, input, a, [data-next]');
    if (!t) return;
    if (t.dataset.go) { var l = state.feed.sessions, i = l.indexOf(state.current) + Number(t.dataset.go); if (l[i]) location.hash = l[i].anchor; }
    if (t.hasAttribute('data-present')) { state.slide = 0; openPresent(); }
    if (t.dataset.slide) step(Number(t.dataset.slide));
    if (t.hasAttribute('data-next') && !e.target.closest('a')) step(1);
    if (t.hasAttribute('data-close')) closePresent();
    if (t.hasAttribute('data-full')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
    if (t.dataset.tick) {
      try { localStorage.setItem('tick-' + t.dataset.tick, t.checked ? '1' : '0'); } catch (err) {}
      t.closest('.task').classList.toggle('ticked', t.checked);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (state.present) {
      if (['ArrowRight', 'PageDown', ' '].indexOf(e.key) >= 0) { e.preventDefault(); step(1); }
      if (['ArrowLeft', 'PageUp'].indexOf(e.key) >= 0) { e.preventDefault(); step(-1); }
      if (e.key === 'Escape' && !document.fullscreenElement) closePresent();
      if (e.key === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    } else if (e.key === 'p' && state.current && state.current.kind === 'f2f') { state.slide = 0; openPresent(); }
  });

  window.addEventListener('hashchange', function () {
    if (!state.feed) return;
    var s = state.feed.sessions.filter(function (x) { return x.anchor === location.hash.slice(1); })[0];
    if (s) { state.current = s; state.slide = 0; render(); window.scrollTo(0, 0); }
  });
  window.addEventListener('resize', function () { if (state.present) openPresent(); });

  // Refresh quietly when the page is open for a long time (e.g. projected all afternoon).
  setInterval(function () { if (!state.present && document.visibilityState === 'visible' && !DEMO) fetchFeed().then(function (f) { if (!f.error) { var h = state.current && state.current.anchor; show(f); if (h) location.hash = h; } }).catch(function () {}); }, 5 * 60 * 1000);

  start();
})();
