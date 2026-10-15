/* ==========================================================================
   《拍照手札》脚本
   --------------------------------------------------------------------------
   只做八件事：
     ① 把 photos.js 清单、本机记录和云端传上来的照片合成一份，铺成杂志式瀑布流
     ② 每张卡片带编号 / 标题 / 地点 / 日期；先铺 12 张，LOAD MORE / VIEW ALL 铺剩下的
     ③ 点一张照片 → 全屏大图（←/→ 翻，Esc 关，手机上左右滑）
     ④ 顶栏导航按滚动位置高亮
     ⑤ 滚动淡入（只播一次，可由 prefers-reduced-motion 关掉）
     ⑥ 云端已删除的照片自动从墙上撤掉，确认 404 后连本机记录一起忘掉
     ⑦ 本地图片缺 1600 那一档时自动退回 800
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

  /* ================= 2. 瀑布流瀑布流（Featured Works） =================
     布局：CSS Grid 摆 N 根列（大屏 4 / 平板 3 / 手机 2），
     卡片按「从左到右」的横向顺序轮流分进列里（第 i 张进第 i % 列数 根），
     高度跟照片原始比例走 —— 不裁切、不封顶。列数变了（转屏 / 拉窗口）就地重分。 */
  var M_PAGE = 12;                       /* 首铺张数，LOAD MORE 每次补这些 */
  var M_SIZES = "(max-width: 1200px) 44vw, 28vw";

  var mbox = document.getElementById("m-grid");
  var mEmpty = document.getElementById("m-empty");
  var mMore = document.getElementById("m-more");
  var mAllBtn = document.getElementById("m-all");
  var mRegions = document.getElementById("m-regions");
  var mAllPics = [];                     /* 合并后的全部照片，顺序即编号顺序 */
  var mShown = 0;                        /* 已经铺出来的张数 */
  var mLastCols = 0;
  var mRegion = "ALL";                   /* 当前选中的地区；ALL = 全看 */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function picLabel(p) { return [p.place, p.time].filter(Boolean).join("，") || "照片"; }
  /* 卡片标题：写了心情就用心情当标题，没写用地名，再没有就叫「无题」 */
  function picTitle(p) { return p.note || p.place || "无题"; }
  /* 说明行：地点 · 日期（标题已经用了地点的话就不重复） */
  function picMeta(p) {
    var m = [];
    if (p.place && p.place !== p.note) m.push(p.place);
    if (p.time) m.push(p.time);
    return m.join(" · ");
  }

  /* ---- 地区：直接取自「地点」那一栏（珠海 / 杭州 / 海边……）----
     拍摄地点天生就是地区，不用再维护第二份分类。
     没填地点的归到「未标地点」，好让它们能被单独筛出来补。 */
  var NO_REGION = "未标地点";
  function regionOf(p) {
    var s = String(p.place || "").trim();
    return s || NO_REGION;
  }

  function mCols() {
    var w = document.documentElement.clientWidth;
    return w >= 1200 ? 4 : w >= 900 ? 3 : 2;
  }

  /* ---- 地区条：从合并好的清单里把地区数出来（按张数从多到少）----
     「ALL」永远在第一个。只有一个地区（或一张照片刚都没有）时不显示这一排。 */
  function buildRegions() {
    if (!mRegions) return;
    var count = {}, order = [];
    mAllPics.forEach(function (p) {
      var r = regionOf(p);
      if (count[r] == null) { count[r] = 0; order.push(r); }
      count[r]++;
    });
    order.sort(function (a, b) {
      /* 「未标地点」永远排在最后，其余按张数多的在前 */
      if (a === NO_REGION) return 1;
      if (b === NO_REGION) return -1;
      return count[b] - count[a] || a.localeCompare(b);
    });

    mRegions.textContent = "";
    if (order.length < 2) {
      /* 只有一个地区，筛选没意义，整条收起来 */
      mRegions.hidden = true;
      if (order.length && mRegion !== "ALL" && mRegion !== order[0]) mRegion = "ALL";
      return;
    }
    mRegions.hidden = false;

    /* 选中的地区要是已经不存在了（照片被删/改了地点），退回 ALL */
    if (mRegion !== "ALL" && order.indexOf(mRegion) < 0) mRegion = "ALL";

    addRegionBtn("ALL", "ALL / 全部", mAllPics.length);
    order.forEach(function (r) { addRegionBtn(r, r, count[r]); });
  }

  function addRegionBtn(value, label, n) {
    var b = el("button", "m-region");
    b.type = "button";
    b.setAttribute("aria-pressed", String(value === mRegion));
    b.appendChild(document.createTextNode(label));
    b.appendChild(el("span", "m-region-n", String(n)));
    b.addEventListener("click", function () {
      if (mRegion === value) return;
      mRegion = value;
      var btns = mRegions.querySelectorAll(".m-region");
      Array.prototype.forEach.call(btns, function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
      renderWall(mAllPics.slice());   /* 用同一份清单重铺，只看被选中的那一档 */
    });
    mRegions.appendChild(b);
  }

  /* 当前该铺出来的照片：ALL 就是全部，否则只留选中那个地区的 */
  function wallPics(all) {
    if (mRegion === "ALL") return all.slice();
    return all.filter(function (p) { return regionOf(p) === mRegion; });
  }


  /* 把墙上现有的卡片按横向顺序分进 N 根列。每次都重建列容器，卡片节点原样搬过去；
     顺序记在节点上（__no），搬动不打乱阅读顺序。 */
  function mDistribute(force) {
    if (!mbox) return;
    var cols = mCols();
    if (!force && cols === mLastCols) return;
    mLastCols = cols;
    mbox.style.setProperty("--cols", cols);
    var items = Array.prototype.slice.call(mbox.querySelectorAll(".m-item"));
    items.sort(function (a, b) { return (a.__no || 0) - (b.__no || 0); });
    mbox.textContent = "";
    var buckets = [];
    for (var i = 0; i < cols; i++) {
      var c = el("div", "mcol");
      mbox.appendChild(c);
      buckets.push(c);
    }
    items.forEach(function (it, i) { buckets[i % cols].appendChild(it); });
  }

  function makeItem(p, no) {
    var fig = el("figure", "m-item reveal has-pic");
    fig.__p = p;
    fig.__no = no;

    var btn = el("button", "m-media");
    btn.type = "button";
    btn.setAttribute("aria-label", "看大图：" + picLabel(p));

    var img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = picLabel(p);
    fillImg(img, p, 800, M_SIZES);
    /* 原始宽高（云端清单带、上传时也会记下）先写进标记，
       浏览器据它把比例占好 —— 图片还没到，版式也不跳 */
    if (p.w && p.h) { img.width = p.w; img.height = p.h; }
    img.addEventListener("load", function () {
      /* 本地照片一开始不知道尺寸，图到了补上，之后的重排就不跳了 */
      if (!img.getAttribute("width") && img.naturalWidth) {
        img.width = img.naturalWidth;
        img.height = img.naturalHeight;
      }
    });

    var retried = false;
    img.addEventListener("error", function () {
      /* 第一次失败：本地图可能只做了 800 这一档，退回单档再试一次 */
      if (!retried && !p.src) {
        retried = true;
        img.removeAttribute("srcset");
        img.sizes = "";
        img.src = picUrl(p, 800);
        return;
      }
      /* 还是取不到：这一格整个从墙上撤掉（瀑布流里不留「待填」块）。
         云端那张要再确认一次是不是真 404 —— 真删了才把本机记录一起抹掉；
         万一只是网抖一下，记录留着，下次打开还能再试。 */
      if (fig.parentNode) fig.parentNode.removeChild(fig);
      if (p.src) confirmGone(p.src, function () { dropMine(p.src); });
      mAfterDrop();
    });

    /* 悬停提示圆标：只做透明度 —— 里面有字，位置和大小一律不动 */
    var hint = el("span", "m-hint", "VIEW PHOTO");
    hint.setAttribute("aria-hidden", "true");
    btn.appendChild(img);
    btn.appendChild(hint);
    fig.appendChild(btn);

    /* 图下说明：编号 | 标题 +（地点 · 日期） */
    var cap = el("figcaption", "m-cap");
    cap.appendChild(el("span", "m-no", pad2(no)));
    var body = el("span", "m-cap-body");
    body.appendChild(el("span", "m-c-title", picTitle(p)));
    var meta = picMeta(p);
    if (meta) body.appendChild(el("span", "m-c-meta", meta));
    cap.appendChild(body);
    fig.appendChild(cap);

    btn.addEventListener("click", function () { openLb(fig); });
    return fig;
  }

  /* 撤掉格子之后编号会断档，按剩余卡片的显示顺序就地重排（01、02、03……） */
  function mRenumber() {
    if (!mbox) return;
    var items = Array.prototype.slice.call(mbox.querySelectorAll(".m-item"));
    items.sort(function (a, b) { return (a.__no || 0) - (b.__no || 0); });
    items.forEach(function (it, i) {
      it.__no = i + 1;
      var n = it.querySelector(".m-no");
      if (n) n.textContent = pad2(i + 1);
    });
  }

  function mAfterDrop() {
    mRenumber();
    if (mEmpty) mEmpty.hidden = !!(mbox && mbox.querySelector(".m-item"));
    updateHeroYear();
  }

  /* ---- 照片真没了就别留空壳：再确认一次 404，才把本机那份记录也抹掉 ----
     （不抹的话，它每回打开都来把这一格重铺一遍） */
  function confirmGone(src, then) {
    try {
      var x = new XMLHttpRequest();
      x.open("HEAD", src, true);
      x.timeout = 8000;
      x.onloadend = function () { if (x.status === 404) then(); };
      x.send();
    } catch (e) {}
  }

  /* 从本机记录里抹掉一张（云端已确认删掉的时候用） */
  function dropMine(src) {
    if (!src) return;
    try {
      var arr = readMine().filter(function (p) { return srcKey(p.src) !== srcKey(src); });
      localStorage.setItem(MINE_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  /* ---- 铺墙：把合并好的清单整面重铺（幂等 —— 传完照片 / 删了照片 / 换地区都走这里）----
     mAllPics 始终是完整清单；实际铺出来的是 wallPics() 那一档。 */
  function renderWall(pics) {
    if (!mbox) return;
    mAllPics = (pics || []).filter(function (p) { return !!(p.src || p.slug); });
    buildRegions();
    var show = wallPics(mAllPics);
    mbox.textContent = "";
    mShown = Math.min(M_PAGE, show.length);
    for (var i = 0; i < mShown; i++) mbox.appendChild(makeItem(show[i], i + 1));
    mDistribute(true);
    mUpdateButtons();
    if (mEmpty) mEmpty.hidden = mAllPics.length > 0;
    updateHeroYear();
    watchReveal(mbox.querySelectorAll(".reveal"));
    sweep();
  }

  function mUpdateButtons() {
    var left = wallPics(mAllPics).length - mShown;
    if (mMore) mMore.hidden = left <= 0;
    if (mAllBtn) mAllBtn.hidden = left <= 0;
  }

  /* LOAD MORE / VIEW ALL 共用：把还没铺的补出来（VIEW ALL 一次补完） */
  function mAppendNext(all) {
    if (!mbox) return;
    var show = wallPics(mAllPics);
    var start = mShown;
    mShown = all ? show.length : Math.min(mShown + M_PAGE, show.length);
    var fresh = [];
    for (var i = start; i < mShown; i++) fresh.push(makeItem(show[i], i + 1));
    fresh.forEach(function (it) { mbox.appendChild(it); });
    mDistribute(true);
    mUpdateButtons();
    watchReveal(fresh);
    sweep();
  }

  if (mMore) mMore.addEventListener("click", function () { mAppendNext(false); });
  if (mAllBtn) mAllBtn.addEventListener("click", function () { mAppendNext(true); });

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
    return Array.prototype.slice.call(document.querySelectorAll(".m-item.has-pic"));
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

    /* 上一行：地点 / 时间。下面两栏：DATE / LOCATION。中间：一句心情 */
    if (lbTitle) lbTitle.textContent = [p.place, p.time].filter(Boolean).join(" / ") || "照片";
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
    tick = setTimeout(function () { tick = null; sweep(); spy(); mDistribute(); }, 60);
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


  /* ================= 6. 封面：右上角那行年份 =================
     首屏不放照片了（原来这里会挑最新一张铺满全屏，已随封面照片一起去掉）。
     年份是从所有照片的「时间」里数出来的，跟瀑布流用的是同一份数据。 */
  var heroYear = document.getElementById("hero-year");
  var heroSection = document.getElementById("hero");

  /* 右上角那行年份：从所有照片的时间里数出来，没写时间就不显示 */
  function updateHeroYear() {
    if (!heroYear) return;
    var years = [];
    each(document.querySelectorAll(".m-item.has-pic"), function (n) {
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

  /* ================= 7. 渲染清单 =================
     photos.js 里手写的本地照片（slug 那种）先收进来，
     等云端 + 本机记录合并好后一起铺 —— 顺序：新的在前（created 降序），本地手写的殿后。 */
  var LOCAL_PICS = [];
  DATA.forEach(function (g) {
    (g.photos || []).forEach(function (p) {
      if (p.slug) {
        LOCAL_PICS.push({
          slug: p.slug,
          time: String(p.time || ""),
          place: String(p.place || ""),
          note: String(p.note || "")
        });
      }
    });
  });

  if (mbox) loadCloudPhotos();

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
          w: Number(p.w) || 0,
          h: Number(p.h) || 0,
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

  /* ---- 同一张照片重复传了两遍 ----
     重复的判据不是地址（两次上传的地址必然不同），而是「时间 + 地点 + 心情」
     三项完全一样、图幅也一样。碰上了就只留最早传的那一张，
     不然瀑布流里就会出现两张一模一样的图（这正是之前那个问题）。

     注意：这里只是**不重复显示**，云端那两份都还在 ——
     要真删掉多余的那些，跑 photo-admin.py 选 2。
     这样分两步是有意的：万一判断错了，你随时能把隐藏的那张找回来。 */
  function dedupeByContent(list) {
    var seen = {}, out = [];
    list.forEach(function (p) {
      var k = [
        String(p.time || "").trim(),
        String(p.place || "").trim(),
        String(p.note || "").trim(),
        String(p.w || ""),
        String(p.h || "")
      ].join("\u0000");
      if (seen[k]) return;          /* 前面已经有同一张了，这张不铺 */
      seen[k] = 1;
      out.push(p);
    });
    return out;
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
    if (!mbox) return;
    var urls = listUrls();
    if (!urls.length) { renderWall(dedupeByContent(readMine()).concat(LOCAL_PICS)); return; }
    tryList(urls, 0);
  }

  /* 一个一个试：哪个先返回 200 就用哪个；全都不行就只剩本机那份 */
  function tryList(urls, i) {
    if (i >= urls.length) { renderWall(dedupeByContent(readMine()).concat(LOCAL_PICS)); return; }

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
        renderWall(dedupeByContent(mergePics(cloudPics, readMine())).concat(LOCAL_PICS));
        return;
      }
      tryList(urls, i + 1);
    };

    xhr.send();
  }


  /* 给上传那边的脚本用：传完叫一声，瀑布流就地重铺，不用手动刷新 */
  window.HJL_REFRESH_PHOTOS = function () {
    if (mbox) loadCloudPhotos();
  };

  function fromCloud(r) {
    var UP = window.HJL_UPLOAD_CONFIG || {};
    var cx = (r.context && r.context.custom) || {};
    return {
      src: "https://res.cloudinary.com/" + String(UP.cloudName || "").toLowerCase() +
           "/image/upload/" + (r.public_id || "") + "." + (r.format || "jpg"),
      w: Number(r.width) || 0,
      h: Number(r.height) || 0,
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
