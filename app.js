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

  /* 本机记着「已经被我删掉、别再铺出来」的地址。
     放 sessionStorage：这一趟浏览有效就够了，下次打开时云端清单也该刷过来了。
     真去云端删要的 API Key / Secret 都归 upload.js 管（只可能从本机读到，
     绝不会跟着页面发出去）—— 这边只管「先别铺」。 */
  var HIDDEN_KEY = "hjl-photo-hidden-v1";

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
  var mBody = document.querySelector(".m-body");
  var mAllPics = [];                     /* 合并后的全部照片，顺序即编号顺序 */
  var mShown = 0;                        /* 已经铺出来的张数 */
  var mLastCols = 0;
  var mRegion = "ALL";                   /* 当前选中的地区；ALL = 全看 */
  var mHidden = {};                      /* 本地记着「别再铺」的地址，见 hideSrc */

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

  /* ---- 地区栏：从合并好的清单里把地区数出来（按张数从多到少）----
     「ALL」永远在第一个。只有一个地区（或一张照片都没有）时整列收起来。 */
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

    /* 竖排那一列收起来的时候，画廊得一路铺到左边 ——
       不然宽屏上左边会空出 168px 的一条沟。
       这个类由这里统一管，免得 CSS 和 JS 各判一遍条件、以后改漏一处。 */
    if (mBody) mBody.classList.toggle("is-one-col", order.length < 2);

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
    /* 地名单独包一层：竖排之后这一行是「地名居左、张数居右」的两栏，
       裸的文本节点不好控制 */
    b.appendChild(el("span", "m-region-label", label));
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

  /* ---- 拍摄时间：给分好区的照片再切一层 ----
     ALL 视图不切（整片瀑布流连着看更舒服）；
     选中某个地区后才在里面按时间分节，新的在前，
     没写时间的归到「未标时间」，摆在最后好回头补。 */
  var NO_TIME = "未标时间";

  /* 时间是手打的，同一个月可能写成 2026.9 / 2026.09 / 2026/09 / 2026-09 ——
     不归拢的话会被当成四个不同的分组。这里统一成 2026.09 再分。
     抓不到年月的写法（比如「某个周日下午」）原样保留，不硬掰成年份。 */
  function normTime(s) {
    var t = String(s || "").trim();
    if (!t) return "";
    var m = t.match(/((?:19|20)\d{2})\s*[\/\-年.]\s*(\d{1,2})/);
    if (m) {
      var mo = m[2].length < 2 ? "0" + m[2] : m[2];
      return m[1] + "." + mo;
    }
    return t;
  }

  function timeKey(p) {
    return normTime(p.time) || NO_TIME;
  }

  /* 当前该铺出来的照片：ALL 就是全部，否则只留选中那个地区的 */
  function wallPics(all) {
    if (mRegion === "ALL") return all.slice();
    return all.filter(function (p) { return regionOf(p) === mRegion; });
  }

  function timeBlocks(pics) {
    if (mRegion === "ALL") return [{ label: "", pics: pics }];

    var buckets = {}, order = [];
    pics.forEach(function (p) {
      var k = timeKey(p);
      if (buckets[k] == null) { buckets[k] = []; order.push(k); }
      buckets[k].push(p);
    });
    order.sort(function (a, b) {
      if (a === NO_TIME) return 1;
      if (b === NO_TIME) return -1;
      return b.localeCompare(a);          /* 时间倒序：新的那组在最上面 */
    });
    return order.map(function (k) { return { label: k, pics: buckets[k] }; });
  }


  /* 把墙上现有的卡片按横向顺序分进 N 根列。每次都重建列容器，卡片节点原样搬过去；
     顺序记在节点上（__no），搬动不打乱阅读顺序。 */
  function mDistribute(force) {
    if (!mbox) return;
    var cols = mCols();
    if (!force && cols === mLastCols) return;
    mLastCols = cols;

    /* 每个时间组各自有一张 .mgrid，挨个排；
       原本是整个一张大网格，现在多了时间分组这一层 */
    each(mbox.querySelectorAll(".mgrid"), function (grid) {
      grid.style.setProperty("--cols", cols);
      var items = Array.prototype.slice.call(grid.querySelectorAll(".m-item"));
      items.sort(function (a, b) { return (a.__no || 0) - (b.__no || 0); });
      grid.textContent = "";
      var buckets = [];
      for (var i = 0; i < cols; i++) {
        var c = el("div", "mcol");
        grid.appendChild(c);
        buckets.push(c);
      }
      items.forEach(function (it, i) { buckets[i % cols].appendChild(it); });
    });
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
      /* 兜底：清单里没记尺寸的图（老的本机记录就是），等它真加载出来
         才发现是个 1x1 的测试图 —— 这种铺开就是一块灰底占着格子，撤掉。
         上面 dropJunk 拦的是「清单里写了尺寸」的那些，这道拦漏网的。 */
      if (img.naturalWidth && img.naturalWidth <= 2 && img.naturalHeight <= 2) {
        if (fig.parentNode) fig.parentNode.removeChild(fig);
        mAfterDrop();
        return;
      }
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

    /* 删掉这一张：挂一行最淡的小按钮。
       云端那份删不删得掉取决于有没有 API Key（见 upload.js 的说明），
       但不管删没删云端的，本地这一份立刻就不铺了 —— 点了就要看得见变化，
       不然会以为没生效、反复点。 */
    var ops = el("span", "m-ops");
    var del = el("button", "m-del", "删除");
    del.type = "button";
    del.setAttribute("aria-label", "删掉这张照片：" + picLabel(p));
    del.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (del.dataset.armed !== "1") {
        /* 两段式：第一下只是预备，手滑点错还有得退 */
        del.dataset.armed = "1";
        del.classList.add("is-armed");
        del.textContent = "再点一次确认";
        setTimeout(function () {
          del.dataset.armed = "";
          del.classList.remove("is-armed");
          del.textContent = "删除";
        }, 4000);
        return;
      }
      del.disabled = true;
      del.textContent = "删除中……";
      removePhoto(p, function (ok, msg) {
        if (!ok) {
          del.disabled = false;
          del.dataset.armed = "";
          del.classList.remove("is-armed");
          del.textContent = "删除";
          if (window.HJL_DEL_MSG) window.HJL_DEL_MSG(msg);
          return;
        }
        /* 不管云端删没删成，本机这一趟都不再铺它了 —— 清单有缓存，
           不记这一笔的话它会当场"复活"回来。
           注意先 hideSrc 再 paint：paint 是从 mAllPics 重画的，
           而 mAllPics 是上一次的清单，里面还有这张。 */
        hideSrc(p.src);
        mAllPics = applyHidden(mAllPics);
        mShown = Math.min(mShown, wallPics(mAllPics).length);
        paint();
        if (window.HJL_DEL_MSG) window.HJL_DEL_MSG(msg);
      });
    });
    ops.appendChild(del);
    body.appendChild(ops);

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

  /* ================= 删一张照片 =================
     两件事分开做，是有意的：

       · hideSrc()  —— 只标在本地（sessionStorage），当场就不铺了。
         清单（Cloudinary 的 list 接口）是有缓存的，云端删掉之后这里还可能
         连着好几分钟读到旧清单；不多记这一笔的话，被删的那张会"复活"回来。

       · removePhoto() —— 真去云端删。删 Cloudinary 的照片要签名，
         签名要 API Secret，而 Secret 不能写进公开网页。
         真正的删法是 upload.js 那边（你在「贴一张新照片」区存过 Secret 才走它），
         这里只是把请求转过去；那边没有就退成「只在本机不显示」。

     说白了：没有凭证时，「删除」= 只在你这台电脑上不再显示；
     真正的删除要么在 upload.js 里存好 Key + Secret，要么跑 photo-admin.py 选 5。 */

  function hideSrc(src) {
    if (!src) return;
    mHidden[srcKey(src)] = 1;
    try {
      var raw = sessionStorage.getItem(HIDDEN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(arr) !== "[object Array]") arr = [];
      if (arr.indexOf(srcKey(src)) < 0) arr.push(srcKey(src));
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  function readHidden() {
    var out = {};
    try {
      var raw = sessionStorage.getItem(HIDDEN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(arr) === "[object Array]") {
        arr.forEach(function (k) { out[k] = 1; });
      }
    } catch (e) {}
    return out;
  }

  mHidden = readHidden();

  /* 真去云端删。真正的删除只在 upload.js 里实现了一次（那边才有
     API Key / Secret 的读取和签名），这里转过去；那边不在就退成
     「只在本机不显示」。 */
  function removePhoto(p, done) {
    var src = p && p.src;

    /* photos.js 里手写的（只有 slug，没有云端地址）：把那一行删掉才算数 */
    if (!src) {
      done(true, "这张的地址不在云端（清单里手写的），本地先不显示；要永久删掉得改 photos.js。");
      return;
    }

    if (typeof window.HJL_DELETE_PHOTO === "function") {
      window.HJL_DELETE_PHOTO(src, done);
      return;
    }
    done(true, "这次只是本机不再显示。要真删掉云端那张，跑 photo-admin.py 选 5。");
  }

  /* ---- 没有画面的图不占格子 ----
     1x1 那种测试图（早先试传留下的）它的元数据是齐的，看着像一张正常照片，
     铺到墙上却只是一块灰底 —— 图片拉满整格、里面什么都没有。
     按尺寸把它挡在墙外面：宽高都 ≤2px 的，一律不铺。
     注意不知道尺寸的要放过（photos.js 手写的本地照片就没有 w/h）。 */
  function dropJunk(list) {
    return list.filter(function (p) {
      var w = Number(p.w) || 0, h = Number(p.h) || 0;
      if (!w || !h) return true;
      return !(w <= 2 && h <= 2);
    });
  }

  /* ---- 铺墙：整面重铺（幂等 —— 传完照片 / 删了照片 / 换地区都走这里）----
     mAllPics 始终是完整清单；实际铺出来的是筛选后的前 mShown 张，
     按「地区 → 时间」两层分节摆好。
     三条清单（云端 / 本机 / 手写）都在这里汇合，所以「去空图」只在这一处做。 */
  function renderWall(pics) {
    if (!mbox) return;
    mAllPics = dropJunk((pics || []).filter(function (p) { return !!(p.src || p.slug); }));
    buildRegions();
    mShown = Math.min(M_PAGE, wallPics(mAllPics).length);
    paint();
    if (mEmpty) mEmpty.hidden = mAllPics.length > 0;
    updateHeroYear();
  }

  /* 按当前 mShown 把整面墙重画一遍。
     每次都重建（不走增量）是有意的：分页、切地区、撤格三种情况
     共用同一段渲染代码，省得增量分支写错。照片数量不大，代价可以接受。 */
  function paint() {
    if (!mbox) return;
    var blocks = timeBlocks(wallPics(mAllPics));
    mbox.textContent = "";

    var no = 0;
    blocks.forEach(function (b) {
      if (no >= mShown && !b.pics.length) return;
      var pics = b.pics.slice(0, Math.max(0, mShown - no));
      if (!pics.length) return;              /* 这一节还没轮到，先不画标题 */

      var sec = el("section", "mg-group");
      if (b.label) sec.appendChild(el("h3", "mg-title", b.label));
      var grid = el("div", "mgrid");
      sec.appendChild(grid);
      mbox.appendChild(sec);

      pics.forEach(function (p) {
        no++;
        grid.appendChild(makeItem(p, no));
      });
    });

    mDistribute(true);
    mUpdateButtons();
    watchReveal(mbox.querySelectorAll(".reveal"));
    sweep();
  }

  function mUpdateButtons() {
    var left = wallPics(mAllPics).length - mShown;
    if (mMore) mMore.hidden = left <= 0;
    if (mAllBtn) mAllBtn.hidden = left <= 0;
  }

  /* LOAD MORE / VIEW ALL 共用：多铺几张（VIEW ALL 一次铺完），然后整面重画 */
  function mAppendNext(all) {
    if (!mbox) return;
    var total = wallPics(mAllPics).length;
    mShown = all ? total : Math.min(mShown + M_PAGE, total);
    paint();
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

  /* 顶栏是 fixed 的，会盖住页面最上面那一条。跳到某个区块时，目标顶端必须落在
     顶栏下面，否则内容看不见、链接也点不到（手机微信里「贴照片」点不开就是这个）。
     CSS 的 scroll-margin-top 在老内核（微信 X5 等）里根本不生效，所以这里自己算位置：
     目标在文档里的 y 减去顶栏高度再滚过去 —— 全程只用 scrollTo，没有任何新特性依赖。 */
  function barH() {
    var bar = document.querySelector(".bar");
    return bar ? bar.getBoundingClientRect().height : 0;
  }
  /* 老内核不认 scrollTo 的 { behavior } 写法，传对象会静默失败，所以先探一下 */
  var CAN_SMOOTH = !!("scrollBehavior" in document.documentElement.style);

  function scrollToId(id) {
    var t = document.getElementById(id);
    if (!t) return;
    var y = (window.pageYOffset || document.documentElement.scrollTop || 0) +
            t.getBoundingClientRect().top - (barH() + 16);
    if (y < 0) y = 0;
    if (reduce || !CAN_SMOOTH) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: "smooth" });
  }

  if (heroSection) {
    heroSection.addEventListener("click", function () { scrollToId("photos"); });
  }
  var heroEnter = document.getElementById("hero-enter");
  if (heroEnter) heroEnter.addEventListener("click", function () { scrollToId("photos"); });

  /* 顶栏那几个锚点也交给 scrollToId：让浏览器自己跳的话，它会把
     scroll-padding-top 和 scroll-margin-top 叠在一起算，落点比预想的低一截
     （实测多出整整 80px）。统一走 JS 这条路的落点才是「刚好在顶栏下面」。 */
  each(document.querySelectorAll('.nav a[href^="#"]'), function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      if (document.getElementById(id)) { e.preventDefault(); scrollToId(id); }
    });
  });

  /* ---- 贴照片：折叠开关自己接管 ----
     两件事在这里兜底：
     1) <details> 的原生展开在个别内核（微信内置浏览器）上会失灵，点了不动；
     2) 折叠标题要是正好停在 fixed 顶栏底下，点下去打在顶栏上，也像"点了没反应"。
     所以自己开关；展开后若标题还被顶栏压着，就把它挪到顶栏下面再交给用户。 */
  var pasteBox = document.getElementById("paste");
  var pasteSum = pasteBox ? pasteBox.querySelector("summary") : null;

  function openPaste(open) {
    if (!pasteBox) return;
    pasteBox.open = (typeof open === "boolean") ? open : !pasteBox.open;
    if (pasteBox.open && pasteSum) {
      var top = pasteSum.getBoundingClientRect().top;
      var want = barH() + 16;
      if (top < want) window.scrollBy(0, top - want);
    }
    if (pasteBox.open) {
      /* 展开后 sweep 一次，免得里面的东西停在淡入的 0 透明度上 */
      setTimeout(sweep, 60);
    }
  }

  if (pasteSum) {
    pasteSum.addEventListener("click", function (e) {
      e.preventDefault();          /* 不让原生再切一次，否则等于切两下、看着像没开 */
      openPaste();
    });
  }

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
      /* 自己删过的，先拦下来 —— 云端的清单有缓存，这一笔能挡住"复活" */
      if (p.src && mHidden[srcKey(p.src)]) return;
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


  /* ---- 自己删过的那些，从清单里摘掉 ----
     写在 dedupeByContent 后面是有原因的：那个函数里也过了一道 mHidden，
     但它只在**合并那一刻**过。而「贴一张新照片」那一区删掉一张之后
     会直接叫 HJL_REFRESH_PHOTOS 重读清单，那时候 mHidden 已经填好了；
     万一是被别的地方调起来的（比如本机记录先铺出来），
     这一层再兜一次，保证隐藏的那张不会换个入口又冒出来。 */
  function applyHidden(list) {
    var keys = Object.keys(mHidden);
    if (!keys.length) return list;
    return list.filter(function (p) {
      return !(p.src && mHidden[srcKey(p.src)]);
    });
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
    if (!urls.length) { renderWall(applyHidden(dedupeByContent(readMine())).concat(LOCAL_PICS)); return; }
    tryList(urls, 0);
  }

  /* 一个一个试：哪个先返回 200 就用哪个；全都不行就只剩本机那份 */
  function tryList(urls, i) {
    if (i >= urls.length) { renderWall(applyHidden(dedupeByContent(readMine())).concat(LOCAL_PICS)); return; }

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
        renderWall(applyHidden(dedupeByContent(mergePics(cloudPics, readMine()))).concat(LOCAL_PICS));
        return;
      }
      tryList(urls, i + 1);
    };

    xhr.send();
  }


  /* 给上传那边的脚本用：传完叫一声，瀑布流就地重铺，不用手动刷新。
     那边删掉/改完一张也走这里（删掉的那张会先在本地记一笔，见 hideSrc）；
     顺带把「已经传上去的照片」那份列表也重建一遍，两处保持同步。 */
  window.HJL_REFRESH_PHOTOS = function () {
    if (mbox) loadCloudPhotos();
    if (window.HJL_REBUILD_EDIT) window.HJL_REBUILD_EDIT();
  };

  /* 给上传那边用：本地记一笔「别再铺这张」，并且从墙上撤掉 */
  window.HJL_HIDE_SRC = function (src) {
    hideSrc(src);
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
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-go");
      scrollToId(id);
      /* 从页脚点「贴照片」过去：滚到位再展开（平滑滚动是异步的，等一下） */
      if (id === "paste" && pasteBox) {
        setTimeout(function () { openPaste(true); }, (reduce || !CAN_SMOOTH) ? 0 : 560);
      }
    });
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
