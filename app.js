/* ==========================================================================
   《拍照手札》脚本
   --------------------------------------------------------------------------
   只做八件事：
     ① 把 photos.js 清单、以及云端传上来的照片渲染成照片墙
     ② 把最新的一张照片铺成封面，右上角算出照片跨越的年份
     ③ 点一张照片 → 全屏大图（←/→ 翻，Esc 关，手机上左右滑）
     ④ 顶栏导航按滚动位置高亮
     ⑤ 滚动淡入（只播一次，可由 prefers-reduced-motion 关掉）
     ⑥ 云端清单和这台电脑记录的照片合起来铺
     ⑦ 本地图片缺 1600 那一档时自动退回 800，两档都没有才显示占位块
     ⑧ 页脚年份、返回封面 / 浏览画廊 / 返回顶部
   没有任何自动播放的动画，没有外部依赖。
   ========================================================================== */
(function () {
  "use strict";

  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* 本机清单的键名，必须和 upload.js 里的那个一致。
     放在最上面是有原因的： var 只提升声明、不提升赋值，
     写在下面会让**第一次**渲染读到一个还没赋值的名字 —— 上次就栽在这儿。 */
  var MINE_KEY = window.HJL_MINE_KEY || "hjl-photo-mine-v1";

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
  /* 跟 CSS 里 --photo-w 对齐：宽屏封顶 227；窄屏两列各约 46vw，跟着列走 */
  var GRID_SIZES = "(max-width: 900px) 46vw, 227px";

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
      /* 云端照片（带 p.src 的）取不到 —— 十有八九是已经在 Cloudinary 上删掉了。
         这一格直接从墙上撤掉，别留一块灰扑扑的「待填」在那儿，看着像没删干净。 */
      if (p.src) {
        dropCell(fig);
        confirmGone(p.src, function () { dropMine(p.src); });
        return;
      }

      /* 本地图（photos/xxx.jpg 那种）还是失败：换成占位块。
         这种空位是有意留着的，所以保留，只是不再让它出现在大图里 */
      fig.classList.remove("has-pic");
      fig.classList.add("is-empty");
      delete fig.__p;
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      var fallback = el("div", "thumb");
      fallback.appendChild(el("span", "ph", "待填"));
      fig.insertBefore(fallback, fig.firstChild);
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

  /* ---- 照片没了就别留空壳 ----
     云端那张取不到时：先把这一格从墙上撤掉，再去确认一次是不是真的 404 ——
     确实删了就把本机那份记录也一起抹掉（不抹的话，它每回打开都来把灰块重铺一遍）；
     万一只是网抖一下，记录留着，下次打开还能再试。 */
  function dropCell(fig) {
    var grid = fig.parentNode;
    if (grid && grid.removeChild) grid.removeChild(fig);
    pruneEmptyGroup(grid);
    updateHeroYear();
    buildRail();
  }

  function confirmGone(src, then) {
    try {
      var x = new XMLHttpRequest();
      x.open("HEAD", src, true);
      x.timeout = 8000;
      x.onloadend = function () { if (x.status === 404) then(); };
      x.send();
    } catch (e) {}
  }

  /* 一格不剩的分组连标题一起撤掉；整面墙都空了，就把「还没有照片。」放回来 */
  function pruneEmptyGroup(grid) {
    if (!grid || grid.querySelector(".cell")) return;
    var sec = grid.parentNode;
    if (sec && sec.parentNode) sec.parentNode.removeChild(sec);
    if (groupsBox && !groupsBox.querySelector(".cell") && !groupsBox.querySelector(".wall-empty")) {
      groupsBox.appendChild(el("p", "wall-empty", "还没有照片。"));
    }
  }

  /* 从本机记录里抹掉一张（云端已确认删掉的时候用） */
  function dropMine(src) {
    if (!src) return;
    try {
      var arr = readMine().filter(function (p) { return srcKey(p.src) !== srcKey(src); });
      localStorage.setItem(MINE_KEY, JSON.stringify(arr));
    } catch (e) {}
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

  /* ================= 6. 封面：右上角那行年份 =================
     首屏不放照片了（原来这里会挑最新一张铺满全屏，已随封面照片一起去掉）。
     年份是从所有照片的「时间」里数出来的，跟照片墙用的是同一份数据。 */
  var heroYear = document.getElementById("hero-year");
  var heroSection = document.getElementById("hero");

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
      groupsBox.appendChild(el("p", "wall-empty", "还没有照片。"));
    }

    updateHeroYear();
    buildRail();

    /* 云端传上来的照片：自己去取清单，自动渲染，不用再改 photos.js */
    loadCloudPhotos();
  }

  /* ---- 本机清单：这台电脑上亲手传过的照片 ----
     存在 localStorage 里。照片本体照样在云端，这里只记「地址 + 时间地点心情」，
     所以就算 Cloudinary 那份清单读不出来，你自己的电脑也立刻看得到。
     键名由 upload.js 设进 window，两个文件必须是同一个名字。 */
  function readMine() {
    try {
      var raw = window.localStorage && localStorage.getItem(MINE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (Object.prototype.toString.call(arr) !== "[object Array]") return [];
      return arr.filter(function (p) {
        /* 只认 https 开头的图片地址，别的来源一律丢掉，别拿它当 src 用 */
        return p && typeof p.src === "string" && p.src.indexOf("https://") === 0;
      }).map(function (p) {
        return {
          src: p.src,
          time: String(p.time || ""),
          place: String(p.place || ""),
          note: String(p.note || ""),
          created: String(p.created || "")
        };
      });
    } catch (e) { return []; }
  }

  /* 同一张照片会有两种地址写法 ——
     上传接口给的 secure_url 带一段 /v1790689384/ 版本号，
     云端清单拼出来的地址不带。要是拿整串去比，两边对不上，
     同一张照片就会在墙上铺两遍。所以比之前先把版本号抹掉。 */
  function srcKey(src) {
    return String(src || "").replace(/\/v\d+\//, "/");
  }

  /* 两份清单合起来：同一张只留一条（本机那条信息更全，优先） */
  function mergePics(cloudPics, mine) {
    var out = mine.slice();
    var seen = {};
    out.forEach(function (p) { seen[srcKey(p.src)] = 1; });
    cloudPics.forEach(function (p) {
      var k = srcKey(p.src);
      if (!seen[k]) { seen[k] = 1; out.push(p); }
    });
    out.sort(function (a, b) { return (b.created || "").localeCompare(a.created || ""); });
    return out;
  }

  /* 按「时间 + 地点」分组铺到照片墙最前面。
     铺过的都带 .grp-saved 标记 —— 传完照片会再来一次，先收拾干净，
     不然同样的照片会叠一遍。 */
  function renderSaved(pics) {
    if (!groupsBox) return;
    each(groupsBox.querySelectorAll(".grp-saved"), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    if (!pics.length) return;

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
      made.push(addGroup({ title: titles[key], desc: "", photos: buckets[key] }));
    });

    var first = groupsBox.firstChild;
    made.forEach(function (sec) { sec.classList.add("grp-saved"); groupsBox.insertBefore(sec, first); });

    /* 本地清单（photos.js）里如果写着同一张照片，别显示两遍 ——
       导出的代码贴回去、本机那份又没清的时候，两边就会同时撞上 */
    var seenSrc = {};
    pics.forEach(function (p) { if (p.src) seenSrc[srcKey(p.src)] = 1; });
    if (Object.keys(seenSrc).length) {
      each(groupsBox.querySelectorAll(".grp:not(.grp-saved)"), function (sec) {
        var left = 0;
        each(sec.querySelectorAll(".cell"), function (c) {
          if (c.__p && c.__p.src && seenSrc[srcKey(c.__p.src)]) {
            if (c.parentNode) c.parentNode.removeChild(c);
            return;
          }
          left++;
        });
        /* 这一组整组都是重复的那几张 → 连标题一起撤掉 */
        if (!left && sec.parentNode) sec.parentNode.removeChild(sec);
      });
    }

    /* 有真照片了，本地那一堆「待填」占位分组就先收起来，别喧宾夺主 */
    localGrps.forEach(function (o) {
      if (o.empty && o.sec && o.sec.parentNode) o.sec.parentNode.removeChild(o.sec);
    });
    each(groupsBox.querySelectorAll(".wall-empty"), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });

    made.forEach(function (sec) { watchReveal(sec.querySelectorAll(".reveal")); });
    buildRail();
    updateHeroYear();
    sweep();
  }

  /* ---- 照片清单：去 Cloudinary 要那份「按标签列出全部资源」的清单 ----
     要得到它，后台 Settings → Security → Restricted image types
     里的 Resource list 必须是取消勾选的。要不到也没关系，本机那份照样能铺出来。

     ⚠️ 这里为什么要准备三种写法挨个试：
     Cloudinary 的 CDN 会把一次失败（比如那个 401）连着网址一起缓存很久 ——
     开关明明已经打开了，老网址还是一直把当初那个报错还回来。
     而换一种大小写就是一条没被缓存过的新网址，能直接回源拿到真清单。
     所以：先试标准写法，不行就试首字母大写，再不行全大写。 */
  function listUrls() {
    var UP = window.HJL_UPLOAD_CONFIG || {};
    var cloud = String(UP.cloudName || "");
    var tag = String(UP.tag || "");
    if (!cloud || !tag) return [];

    /* photo-notebook → Photo-Notebook */
    var capped = tag.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z])/g, function (m, sep, ch) {
      return sep + ch.toUpperCase();
    });

    return [
      "https://res.cloudinary.com/" + cloud.toLowerCase() + "/image/list/" + encodeURIComponent(tag) + ".json",
      "https://res.cloudinary.com/" + cloud + "/image/list/" + encodeURIComponent(capped) + ".json",
      "https://res.cloudinary.com/" + cloud + "/image/list/" + encodeURIComponent(tag.toUpperCase()) + ".json"
    ];
  }

  function loadCloudPhotos() {
    if (!groupsBox) return;
    var urls = listUrls();
    if (!urls.length) { renderSaved(readMine()); return; }
    tryList(urls, 0);
  }

  /* 一个一个试：哪个先返回 200 就用哪个；全都不行就只剩本机那份 */
  function tryList(urls, i) {
    if (i >= urls.length) { renderSaved(readMine()); return; }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", urls[i], true);
    xhr.timeout = 10000;

    /* 超时 / 断网也会走到 onloadend，这时候 status 是 0，接着试下一个 */
    xhr.onloadend = function () {
      if (xhr.status === 200) {
        var cloudPics = [];
        try {
          var data = JSON.parse(xhr.responseText);
          cloudPics = ((data && data.resources) || []).map(fromCloud).filter(function (p) { return !!p.src; });
        } catch (e) { cloudPics = []; }
        renderSaved(mergePics(cloudPics, readMine()));
        return;
      }
      tryList(urls, i + 1);
    };

    xhr.send();
  }


  /* 给上传那边的脚本用：传完叫一声，照片墙就地重铺，不用手动刷新 */
  window.HJL_REFRESH_PHOTOS = function () {
    if (groupsBox) loadCloudPhotos();
  };

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
