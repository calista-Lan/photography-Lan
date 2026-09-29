/* ==========================================================================
   《拍照手札》脚本
   --------------------------------------------------------------------------
   只做八件事：
     ① 把 photos.js 清单、以及云端传上来的照片渲染成照片墙
     ② 把最新的一张照片铺成封面，右上角算出照片跨越的年份
     ③ 点一张照片 → 全屏大图（←/→ 翻，Esc 关，手机上左右滑）
     ④ 顶栏导航按滚动位置高亮
     ⑤ 滚动淡入（只播一次，可由 prefers-reduced-motion 关掉）
     ⑥ 云端清单取不到时，安静退回本地清单（不报错、不留空白）
     ⑦ 本地图片缺 1600 那一档时自动退回 800，两档都没有才显示占位块
     ⑧ 页脚年份、返回封面 / 浏览画廊 / 返回顶部
   没有任何自动播放的动画，没有外部依赖。
   ========================================================================== */
(function () {
  "use strict";

  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   /* 一律 textContent，防注入 */
    return n;
  }

  /* ================= 1. 清单与图片地址 ================= */
  var DATA = (window.HJL_PHOTOS && window.HJL_PHOTOS.groups) || [];

  function picUrl(p, w) {
    if (p.src) return sized(p.src, w);        /* 云端链接：就地插尺寸参数 */
    return "photos/" + p.slug + "-" + w + ".jpg";
  }

  /* Cloudinary 的链接可以插 c_scale + q_auto：只缩放和压缩，不动画面色彩 */
  function sized(url, w) {
    if (!/res\.cloudinary\.com\/.+\/image\/upload\//.test(url)) return url;
    return url.replace("/image/upload/", "/image/upload/c_scale,w_" + w + ",q_auto/");
  }

  /* 云端的两档尺寸一定存在，可以直接给 srcset；
     本地文件不一定做了 1600 那一档，所以只给 800，失败再说 */
  function fillImg(img, p, w, sizes) {
    img.removeAttribute("srcset");
    img.sizes = sizes || "";
    img.src = picUrl(p, w);
    if (p.src) img.srcset = picUrl(p, 800) + " 800w, " + picUrl(p, 1600) + " 1600w";
  }

  /* ================= 2. 照片墙 ================= */
  /* 跟 CSS 里 --photo-w 对齐：宽屏封顶 340，中间档按列宽估，窄屏两列各约 46vw */
  var GRID_SIZES = "(max-width: 900px) 46vw, (max-width: 1300px) 28vw, 340px";

  /* 分组下面那一行 date: —— 有拍摄时间就写时间跨度，没有就写张数。
     组名本身已经是「2026.09」这种时候，就别再重复一遍，改报张数 */
  function dateLineOf(title, photos) {
    var seen = [], times = [];
    (photos || []).forEach(function (p) {
      var t = (p.time || "").trim();
      if (!t) return;
      var key = t.slice(0, 7);
      if (seen.indexOf(key) < 0) { seen.push(key); times.push(t); }
    });
    var n = (photos || []).filter(function (p) { return !!(p.src || p.slug); }).length;
    if (times.length === 1 && title && title.indexOf(seen[0]) >= 0) return n + " 张";
    if (times.length) return times.join(" / ");
    return n ? n + " 张" : "";
  }

  function makeCell(p, i, groupTitle) {
    /* 两列错落：单数往里缩，双数往外让（缩多少写在 CSS 里，窄屏自动取消） */
    var fig = el("figure", "cell reveal " + (i % 2 === 0 ? "a" : "b"));
    fig.__grp = groupTitle || "";

    /* 没填 slug 也没 src：一块占位纸，不参与大图浏览 */
    if (!p.slug && !p.src) {
      fig.classList.add("is-empty");
      var ph = el("div", "thumb");
      ph.appendChild(el("span", "ph", "待填"));
      fig.appendChild(ph);
      return fig;
    }

    fig.classList.add("has-pic");
    fig.__p = p;

    var btn = el("button", "thumb");
    btn.type = "button";
    btn.setAttribute("aria-label", "看大图：" + ([p.place, p.time].filter(Boolean).join("，") || "照片"));

    var img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = [p.place, p.time].filter(Boolean).join("，") || "照片";
    fillImg(img, p, 800, GRID_SIZES);

    /* 第一次失败：本地图可能只做了 800 这一档，退回单档再试一次 */
    var retried = false;
    img.addEventListener("error", function () {
      if (!retried && !p.src) {
        retried = true;
        img.removeAttribute("srcset");
        img.sizes = "";
        img.src = picUrl(p, 800);
        return;
      }
      /* 还是失败：换成占位块，并且不再让它出现在大图里 */
      fig.classList.remove("has-pic");
      fig.classList.add("is-empty");
      delete fig.__p;
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      var fallback = el("div", "thumb");
      fallback.appendChild(el("span", "ph", "待填"));
      fig.insertBefore(fallback, fig.firstChild);
      updateHero();          /* 封面正好是这张的话，换一张 */
    });

    btn.appendChild(img);
    fig.appendChild(btn);

    /* 缩略图下只留一句心情；时间地点留给大图那两栏 */
    if (p.note) {
      var cap = el("figcaption", "cap");
      cap.appendChild(el("p", "c-note", p.note));
      fig.appendChild(cap);
    }

    btn.addEventListener("click", function () { openLb(fig); });
    return fig;
  }

  function addGroup(opt) {
    var sec = el("section", "grp");

    var head = el("header", "grp-head reveal");
    head.appendChild(el("h3", "grp-title", opt.title));
    var dl = dateLineOf(opt.title, opt.photos);
    if (dl) head.appendChild(el("p", "grp-date", "date: " + dl));
    if (opt.desc) {
      var intro = el("div", "grp-desc");
      String(opt.desc).split("\n").forEach(function (line) {
        intro.appendChild(el("p", null, line));
      });
      head.appendChild(intro);
    }
    sec.appendChild(head);

    var grid = el("div", "grid");
    var shown = 0;
    (opt.photos || []).forEach(function (p) {
      grid.appendChild(makeCell(p, shown++, opt.title));
    });
    sec.appendChild(grid);
    return sec;
  }

  /* ================= 3. 全屏大图 ================= */
  var lb = document.getElementById("lb");
  var lbImg = document.getElementById("lb-img");
  var lbTitle = document.getElementById("lb-title");
  var lbNote = document.getElementById("lb-note");
  var lbTime = document.getElementById("lb-time");
  var lbPlace = document.getElementById("lb-place");
  var lbX = document.getElementById("lb-x");
  var lbPrev = document.getElementById("lb-prev");
  var lbNext = document.getElementById("lb-next");
  var current = -1;
  var lastFocus = null;
  var curP = null;
  var curW = 1600;
  var swiped = false;

  /* 大图里也一样：本地图缺 1600 就退回 800 */
  if (lbImg) {
    lbImg.addEventListener("error", function () {
      if (curP && !curP.src && curW > 800) {
        curW = 800;
        lbImg.src = picUrl(curP, 800);
      }
    });
  }

  /* 大图的可浏览序列＝当前 DOM 里有真照片的格子，顺序和页面一致 */
  function picCells() {
    return Array.prototype.slice.call(document.querySelectorAll(".cell.has-pic"));
  }

  function renderLb(i) {
    if (!lb || !lbImg) return;
    var list = picCells();
    if (!list.length) return;
    if (i < 0) i = list.length - 1;
    if (i >= list.length) i = 0;
    current = i;

    var cell = list[i];
    var p = cell.__p || {};
    curP = p;
    curW = 1600;
    fillImg(lbImg, p, 1600, "92vw");
    lbImg.alt = [p.place, p.time].filter(Boolean).join("，") || "照片";

    /* 上一行：这张照片属于哪一组。下面两栏：时间 / 地点。中间：一句心情 */
    if (lbTitle) lbTitle.textContent = cell.__grp || "";
    if (lbNote) {
      if (p.note) { lbNote.textContent = p.note; lbNote.hidden = false; }
      else { lbNote.textContent = ""; lbNote.hidden = true; }
    }
    if (lbTime) lbTime.textContent = p.time || "—";
    if (lbPlace) lbPlace.textContent = p.place || "—";

    var many = list.length > 1;
    if (lbPrev) lbPrev.hidden = !many;
    if (lbNext) lbNext.hidden = !many;
  }

  function openLb(fig) {
    if (!lb || lb.hidden === false) return;
    var i = picCells().indexOf(fig);
    if (i < 0) return;
    lastFocus = document.activeElement;
    renderLb(i);
    lb.hidden = false;
    document.documentElement.classList.add("lb-open");
    if (lbX) lbX.focus();
  }

  function closeLb() {
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    document.documentElement.classList.remove("lb-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
    current = -1;
  }

  if (lbX) lbX.addEventListener("click", closeLb);
  if (lbPrev) lbPrev.addEventListener("click", function () { renderLb(current - 1); });
  if (lbNext) lbNext.addEventListener("click", function () { renderLb(current + 1); });

  /* 点空白处关掉（滑动过就不算点击） */
  if (lb) {
    lb.addEventListener("click", function (e) {
      if (swiped) { swiped = false; return; }
      if (e.target === lb || e.target.classList.contains("lb-stage")) closeLb();
    });

    /* 手机：左右滑翻张 */
    var sx = 0, sy = 0, tracking = false;
    lb.addEventListener("pointerdown", function (e) {
      tracking = true; swiped = false; sx = e.clientX; sy = e.clientY;
    });
    lb.addEventListener("pointerup", function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swiped = true;
        renderLb(current + (dx < 0 ? 1 : -1));
      }
    });
  }

  /* 键盘：Esc 关，← → 翻 */
  document.addEventListener("keydown", function (e) {
    if (!lb || lb.hidden) return;
    if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); closeLb(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); renderLb(current - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); renderLb(current + 1); }
  });

  /* 焦点锁在大图里，不要 tab 到背后的链接上去 */
  document.addEventListener("focusin", function (e) {
    if (lb && !lb.hidden && !lb.contains(e.target) && lbX) lbX.focus();
  });

  /* ================= 4. 滚动淡入 ================= */
  var io = null;
  var ioFired = false;

  if (!reduce && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      ioFired = true;
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -6% 0px" });
  }

  function each(nodes, fn) { Array.prototype.forEach.call(nodes, fn); }

  function watchReveal(nodes) {
    var arr = Array.prototype.slice.call(nodes);
    if (!arr.length) return;
    if (reduce || !io) { each(arr, function (n) { n.classList.add("in"); }); return; }
    each(arr, function (n) { io.observe(n); });
  }

  /* 兜底：自己按滚动位置判断。宁可没动效，也不能把内容藏死 —— 这是这个站的规矩 */
  function sweep() {
    var left = 0;
    each(document.querySelectorAll(".reveal:not(.in)"), function (n) {
      var r = n.getBoundingClientRect();
      /* 只要顶端已经越过「视口底往上 16px」这条线就显示 —— 包括已经被滚过去的那些。
         一次跳转（点导航、带锚点进来）会跳过中间的内容，观察器看不到它们，
         如果不把「已经过去的」也算进来，那些内容就会永远停在 0 透明度上。 */
      if (r.top < window.innerHeight - 16) n.classList.add("in");
      else left++;
    });
    return left;
  }

  /* 节流用定时器，不用 requestAnimationFrame —— 万一 rAF 不回调
     （无头浏览器、后台标签页），淡入和高亮就永远不推进 */
  var tick = null;
  function onScroll() {
    if (tick) return;
    tick = setTimeout(function () { tick = null; sweep(); spy(); railSpy(); railOn(); }, 60);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  /* ================= 5. 顶栏高亮 ================= */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav a[href^='#']"));
  var navSecs = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); });

  function spy() {
    var line = window.innerHeight * 0.35;
    var best = -1, bestTop = -Infinity;
    navSecs.forEach(function (s, i) {
      if (!s) return;
      var top = s.getBoundingClientRect().top;
      if (top <= line && top > bestTop) { bestTop = top; best = i; }
    });
    navLinks.forEach(function (a, i) {
      if (i === best) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  /* ================= 5b. 侧边分类：时间 + 地点 =================
     每渲染出一组就照着这组重建一次分类条。点一条滚到那一组，
     滚到哪一组哪一条点亮 —— 和参考站那根竖着排的列表一个意思。 */
  var rail = document.getElementById("rail");
  var railItems = [];

  function buildRail() {
    if (!rail) return;
    var secs = Array.prototype.slice.call(document.querySelectorAll("#groups .grp"));
    rail.textContent = "";
    railItems = [];
    secs.forEach(function (sec) {
      /* 只收「真有照片」的分组：photos.js 里还没填的那种占位分组不进条子，
         要不然会列出一排一模一样的「（分组标题待填）」 */
      if (!sec.querySelector(".cell.has-pic")) return;
      var t = sec.querySelector(".grp-title");
      var label = t ? (t.textContent || "").trim() : "";
      if (!label) return;
      var b = el("button", "rail-item", label);
      b.type = "button";
      b.setAttribute("aria-label", "跳到这一组：" + label);
      b.addEventListener("click", function () {
        sec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        railSpy(); railOn();
        /* 平滑滚动要一会儿才停，落地后再同步一次 ——
           不等滚动事件（有些环境下它不可靠），点完条子就立刻亮到那一条 */
        setTimeout(function () { railSpy(); railOn(); }, 420);
      });
      rail.appendChild(b);
      railItems.push({ btn: b, sec: sec });
    });
    rail.hidden = railItems.length === 0;
    railSpy();
    railOn();
  }

  /* 点亮：取「已经滚过视口上方 35% 那条线」的最后一组 */
  function railSpy() {
    if (!railItems.length) return;
    var line = window.innerHeight * 0.35;
    var best = 0;
    railItems.forEach(function (it, i) {
      if (it.sec.getBoundingClientRect().top <= line) best = i;
    });
    railItems.forEach(function (it, i) {
      if (i === best) it.btn.setAttribute("aria-current", "true");
      else it.btn.removeAttribute("aria-current");
    });
  }

  /* 只在照片区里露出来：封面和页脚那里不该看到它（窄屏它是横排，不受这条控制） */
  function railOn() {
    if (!rail || !railItems.length) return;
    var wall = document.getElementById("photos");
    if (!wall) return;
    var r = wall.getBoundingClientRect();
    rail.classList.toggle("is-on", r.bottom > 140 && r.top < window.innerHeight - 140);
  }

  /* ================= 6. 封面：最新一张照片 + 跨越的年份 ================= */
  var heroImg = document.getElementById("hero-img");
  var heroYear = document.getElementById("hero-year");
  var heroSection = document.getElementById("hero");

  function updateHero() {
    if (!heroImg) return;
    var first = document.querySelector(".cell.has-pic");
    if (!first || !first.__p) { heroImg.hidden = true; return; }
    var p = first.__p;
    var url = picUrl(p, 1600);
    if (heroImg.getAttribute("src") === url) return;
    heroImg.hidden = true;
    heroImg.src = url;
    heroImg.alt = [p.place, p.time].filter(Boolean).join("，") || "封面照片";
    heroImg.hidden = false;
  }

  if (heroImg) {
    heroImg.addEventListener("load", function () { heroImg.hidden = false; });
    /* 封面这张没取到：认了，留一屏深色底，字照样看得见 */
    heroImg.addEventListener("error", function () { heroImg.hidden = true; });
  }

  /* 右上角那行年份：从所有照片的时间里数出来，没写时间就不显示 */
  function updateHeroYear() {
    if (!heroYear) return;
    var years = [];
    each(document.querySelectorAll(".cell.has-pic"), function (n) {
      var t = (n.__p && n.__p.time) || "";
      var m = t.match(/(19|20)\d{2}/);
      if (m && years.indexOf(m[0]) < 0) years.push(m[0]);
    });
    years.sort();
    if (!years.length) { heroYear.hidden = true; heroYear.textContent = ""; return; }
    heroYear.textContent = years.length > 1 ? years[0] + " — " + years[years.length - 1] : years[0];
    heroYear.hidden = false;
  }

  function scrollToId(id) {
    var t = document.getElementById(id);
    if (t) t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  if (heroSection) {
    heroSection.addEventListener("click", function () { scrollToId("photos"); });
  }
  var heroEnter = document.getElementById("hero-enter");
  if (heroEnter) heroEnter.addEventListener("click", function () { scrollToId("photos"); });

  /* ================= 7. 渲染本地清单 ================= */
  var groupsBox = document.getElementById("groups");
  var localGrps = [];

  if (groupsBox) {
    DATA.forEach(function (g) {
      var photos = g.photos || [];
      var real = photos.filter(function (p) { return !!(p.src || p.slug); });
      var sec = addGroup({
        title: g.title || "（分组标题待填）",
        desc: g.desc || "",
        photos: photos
      });
      groupsBox.appendChild(sec);
      localGrps.push({ sec: sec, empty: real.length === 0 });   /* 全是占位块的分组先记住 */
    });

    if (!DATA.length) {
      groupsBox.appendChild(el("p", "wall-empty", "还没有照片。往下滚到页面最底，有一段「贴一张新照片」。"));
    }

    updateHero();
    updateHeroYear();
    buildRail();

    /* 云端传上来的照片：自己去取清单，自动渲染，不用再改 photos.js */
    loadCloudPhotos();
  }

  /* 云端清单读不出来的时候留一行小字 —— 原来是完全静默的，
     传了照片却看不到、又没有任何提示，最容易让人以为照片丢了 */
  var cloudNote = null;
  function noteCloudFail(status) {
    if (!groupsBox || cloudNote) return;
    /* 访客（没输过上传口令）且页面本来就有真照片 → 不打扰，什么都不加 */
    var owner = false;
    try { owner = !!(window.sessionStorage && sessionStorage.getItem("hjl-photo-paste-ok") === "1"); } catch (e) {}
    if (!owner && document.querySelectorAll(".cell.has-pic").length) return;
    cloudNote = el("p", "wall-note", status === 401
      ? "云端的照片没读出来：Cloudinary 后台 Settings → Security → Restricted image types 里的 Resource list 还勾着。取消勾选、Save，一分钟后再刷一次。"
      : "云端的照片没读出来（可能是断网）。现在显示的是本地清单。");
    groupsBox.insertBefore(cloudNote, groupsBox.firstChild);
  }

  /* ---- 云端照片：读 Cloudinary 的「按标签列出全部资源」清单 ----
     需要后台把 Settings → Security → Restricted image types 里的 Resource list
     取消勾选。取不到（没开开关 / 断网 / 还没传过）就安静退回本地清单。 */
  function loadCloudPhotos() {
    var UP = window.HJL_UPLOAD_CONFIG;
    if (!groupsBox || !UP || !UP.cloudName || !UP.tag) return;

    var host = "https://res.cloudinary.com/" + String(UP.cloudName).toLowerCase();
    var xhr = new XMLHttpRequest();
    xhr.open("GET", host + "/image/list/" + encodeURIComponent(UP.tag) + ".json", true);
    xhr.timeout = 12000;

    /* 超时 / 断网也会走到 onloadend，status 是 0 */
    xhr.onloadend = function () {
      if (xhr.status !== 200) { noteCloudFail(xhr.status); return; }
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { noteCloudFail(xhr.status); return; }
      var res = (data && data.resources) || [];
      if (!res.length) return;   /* 清单是空的：还没传过照片，不算出错，不提示 */

      var pics = res.map(fromCloud).filter(function (p) { return !!p.src; });
      pics.sort(function (a, b) { return (b.created || "").localeCompare(a.created || ""); });
      if (!pics.length) return;

      /* 按「时间 + 地点」自动分组：时间写 2026.09、地点写 杭州
         就是一组「2026.09 杭州」；地点空着就只按时间分。 */
      var order = [];
      var buckets = {};
      var titles = {};
      pics.forEach(function (p) {
        var tm = (p.time || "").trim().slice(0, 7);
        var pl = (p.place || "").trim();
        var key = (tm || "没写时间") + "\u0000" + pl;
        if (!buckets[key]) {
          buckets[key] = [];
          order.push(key);
          titles[key] = tm ? (pl ? tm + " " + pl : tm) : "（还没写时间的）";
        }
        buckets[key].push(p);
      });

      var made = [];
      order.forEach(function (key) {
        made.push(addGroup({
          title: titles[key],
          desc: "",
          photos: buckets[key]
        }));
      });

      /* 新的排前面 */
      var first = groupsBox.firstChild;
      made.forEach(function (sec) { groupsBox.insertBefore(sec, first); });

      /* 云端有真照片了，本地那一堆「待填」占位分组就先收起来，别喧宾夺主 */
      localGrps.forEach(function (o) {
        if (o.empty && o.sec && o.sec.parentNode) o.sec.parentNode.removeChild(o.sec);
      });
      each(groupsBox.querySelectorAll(".wall-empty"), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });

      made.forEach(function (sec) { watchReveal(sec.querySelectorAll(".reveal")); });
      buildRail();
      updateHero();          /* 云端最新的那张就是封面 */
      updateHeroYear();
      sweep();
    };

    xhr.send();
  }

  function fromCloud(r) {
    var UP = window.HJL_UPLOAD_CONFIG || {};
    var cx = (r.context && r.context.custom) || {};
    return {
      src: "https://res.cloudinary.com/" + String(UP.cloudName || "").toLowerCase() +
           "/image/upload/" + (r.public_id || "") + "." + (r.format || "jpg"),
      time: cx.time || "",
      place: cx.place || "",
      note: cx.note || "",
      created: r.created_at || ""
    };
  }

  /* ================= 8. 页脚 ================= */
  var footYear = document.getElementById("foot-year");
  if (footYear) footYear.textContent = String(new Date().getFullYear());

  each(document.querySelectorAll("[data-go]"), function (b) {
    b.addEventListener("click", function () { scrollToId(b.getAttribute("data-go")); });
  });

  var backTop = document.getElementById("back-to-top");
  if (backTop) {
    backTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

  /* ================= 9. 起跑 ================= */
  watchReveal(document.querySelectorAll(".reveal"));
  spy();

  /* 观察器一直没回调（个别内核 / 无头浏览器），那就全显示 */
  setTimeout(function () {
    sweep();
    if (!ioFired) each(document.querySelectorAll(".reveal:not(.in)"), function (n) { n.classList.add("in"); });
  }, 2600);
})();
