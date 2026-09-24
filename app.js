/* ==========================================================================
   《拍照手札》脚本（单页版）
   整本手账就一个页面：封面 → 照片 → 关于 → 版权页，靠右边的索引标签翻。
   只做五件事：
     ① 把 photos.js 清单渲染成相纸
     ② 点一张照片 → 就在原地摊开成一大张（再点收起）
     ③ 索引标签按滚动位置高亮
     ④ 滚动入场（可由 prefers-reduced-motion 关掉）
     ⑤ 回主页的链接统一填地址
   没有任何自动播放的动画，没有外部依赖。
   ========================================================================== */
(function () {
  "use strict";

  var HOME_URL = "https://calista-lan.github.io/hjl-lesson/";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;      /* 一律用 textContent，防注入 */
    return n;
  }

  /* ================= 1. 索引标签：翻到哪一页就高亮哪一枚 ================= */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab[href^='#']"));
  var secs = tabs.map(function (t) { return document.querySelector(t.getAttribute("href")); });

  function spy() {
    /* 取「已经滚过页面上方 35% 这条线」的最后一节 */
    var line = window.innerHeight * 0.35;
    var best = 0, bestTop = -Infinity;
    secs.forEach(function (s, i) {
      if (!s) return;
      var top = s.getBoundingClientRect().top;
      if (top <= line && top > bestTop) { bestTop = top; best = i; }
    });
    tabs.forEach(function (t, i) {
      if (i === best) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
  }

  /* 节流用定时器，不用 requestAnimationFrame —— 万一 rAF 不回调（无头浏览器、
     后台标签页），高亮就永远卡在第一个标签上了 */
  var spyTimer = null;
  function onScroll() {
    if (spyTimer) return;
    spyTimer = setTimeout(function () { spyTimer = null; spy(); }, 60);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  spy();

  /* ================= 2. 读清单 ================= */
  var DATA = (window.HJL_PHOTOS && window.HJL_PHOTOS.groups) || [];
  var flat = [];

  DATA.forEach(function (g, gi) {
    (g.photos || []).forEach(function (p, pi) {
      p._id = "p" + (gi + 1) + "-" + (pi + 1);   /* 稳定的编号，例如 p1-2 */
      p._gi = gi;
      flat.push(p);
    });
  });

  function picUrl(slug, w) {
    return "photos/" + slug + "-" + w + ".jpg";
  }

  /* 照片铺开的节奏：宽度三档轮流、倾角大部分是 0，只有少数歪一点 */
  var SIZES = ["l", "m", "s", "m", "l", "s"];
  var TILTS = [0, -1.6, 0.9, 0, -2.1, 0.7];
  var FIXES = ["tape", "corner", "clip"];

  /* ================= 3. 生成一张相纸 ================= */
  function makePlate(p, idx) {
    var fig = el("figure", "plate plate--" + (p.size || SIZES[idx % SIZES.length]) + " reveal");
    if (idx % 2 === 1) fig.classList.add("plate--drop");   /* 往下错开 */
    if (idx % 5 === 3) fig.classList.add("plate--lap");    /* 压着旁边那张 */
    fig.style.setProperty("--tilt", (TILTS[idx % TILTS.length] || 0) + "deg");

    /* 固定件：胶带 / 相角 / 回形针，轮流用 */
    var fix = el("span", "fix fix--" + FIXES[idx % FIXES.length]);
    fix.setAttribute("aria-hidden", "true");
    fig.appendChild(fix);

    /* 照片本体：用 button 好让键盘也能打开（Enter / 空格） */
    var btn = el("button", "plate-link");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "看大图：" + ([p.place, p.time].filter(Boolean).join("，") || "照片"));

    if (p.slug) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = picUrl(p.slug, 800);
      img.srcset = picUrl(p.slug, 800) + " 800w, " + picUrl(p.slug, 1600) + " 1600w";
      img.sizes = "(max-width: 720px) 92vw, 46vw";
      img.setAttribute("data-sizes-small", img.sizes);
      img.alt = [p.place, p.time].filter(Boolean).join("，") || "照片，说明待填";
      /* 图片没找到就退回纸色占位块 */
      img.addEventListener("error", function () {
        btn.classList.add("is-empty");
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      btn.appendChild(img);
    } else {
      btn.classList.add("is-empty");
    }
    fig.appendChild(btn);

    /* 相纸下方的说明：时间地点用衬线，一句心情用手写（摊开后会被铅笔圈一下） */
    var cap = el("figcaption");
    cap.appendChild(el("span", "meta",
      [p.time, p.place].filter(Boolean).join(" · ") || "（时间与地点待填）"));

    var box = el("div", "looped");
    box.appendChild(el("span", "note", p.note || "（一句心情待填）"));
    cap.appendChild(box);

    cap.appendChild(el("span", "hint", "点开看大图"));
    fig.appendChild(cap);

    btn.addEventListener("click", function () { toggle(fig); });
    return fig;
  }

  /* ================= 4. 摊开 / 收起（同一时刻只摊开一张） ================= */
  var opened = null;

  function setOpen(fig, on) {
    var btn = fig.querySelector(".plate-link");
    var hint = fig.querySelector(".hint");
    var img = fig.querySelector("img");

    fig.classList.toggle("is-open", on);
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (hint) hint.textContent = on ? "点一下收起" : "点开看大图";
    /* 摊开后占的版面宽了，告诉浏览器可以换大图 */
    if (img) {
      if (on) {
        img.sizes = "(max-width: 900px) 92vw, 60vw";
      } else if (img.getAttribute("data-sizes-small")) {
        img.sizes = img.getAttribute("data-sizes-small");
      }
    }
  }

  function toggle(fig) {
    var willOpen = !fig.classList.contains("is-open");
    if (opened && opened !== fig) setOpen(opened, false);   /* 手账一次只摊开一页 */
    setOpen(fig, willOpen);
    opened = willOpen ? fig : null;

    /* 摊开后把它挪到眼前，不然大图可能露在屏幕外面。
       关掉动效的机器就别平滑滚了，直接定位 */
    if (willOpen) {
      try {
        fig.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      } catch (e) {
        fig.scrollIntoView();
      }
    }
  }

  /* Esc 收起 */
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "Esc") && opened) {
      setOpen(opened, false);
      opened = null;
    }
  });

  /* ================= 5. 把分组渲染出来 ================= */
  var groupsBox = document.getElementById("groups");
  if (groupsBox) {
    DATA.forEach(function (g, gi) {
      var sec = el("section", "grp");
      sec.id = "group-" + (gi + 1);

      var head = el("header", "grp-head reveal");
      head.appendChild(el("p", "grp-tag", "第 " + (gi + 1) + " 组"));
      head.appendChild(el("h2", "grp-title", g.title || "（分组标题待填）"));
      head.appendChild(el("p", "grp-desc", g.desc || "（这个分组的一句话说明待填）"));
      sec.appendChild(head);

      var spread = el("div", "spread");
      (g.photos || []).forEach(function (p) {
        /* 用全站序号决定宽窄与倾角，这样跨组也是错落的，不会每组都长一个样 */
        spread.appendChild(makePlate(p, flat.indexOf(p)));
      });
      sec.appendChild(spread);
      groupsBox.appendChild(sec);
    });

    if (!DATA.length) {
      groupsBox.appendChild(el("p", "lead-desc", "（清单里还没有照片，去 photos.js 里加）"));
    }
  }

  /* ================= 6. 滚动入场：一次性的，且随时可以关掉 ================= */
  var items = document.querySelectorAll(".reveal");

  if (reduce) {
    Array.prototype.forEach.call(items, function (n) { n.classList.add("in"); });
  } else if ("IntersectionObserver" in window) {
    var ioFired = false;      /* 观察器到底有没有回调过 */
    var io = new IntersectionObserver(function (entries) {
      ioFired = true;
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(items, function (n) { io.observe(n); });

    /* 兜底三：万一观察器压根不回调，就自己按滚动位置判断（rAF 节流） */
    var ticking = false;
    function sweep() {
      ticking = false;
      if (ioFired) return;
      Array.prototype.forEach.call(items, function (n) {
        if (n.classList.contains("in")) return;
        var r = n.getBoundingClientRect();
        if (r.top < window.innerHeight - 20 && r.bottom > 0) n.classList.add("in");
      });
    }
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(sweep);
      else setTimeout(sweep, 60);
    }, { passive: true });

    /* 兜底一：把 2.5 秒后已经落在视口里的先显示出来 */
    setTimeout(function () {
      var shown = 0;
      Array.prototype.forEach.call(items, function (n) {
        var r = n.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          n.classList.add("in");
          shown++;
        }
      });
      /* 兜底二：观察器一次都没回调（个别内核/无头浏览器），
         那就全显示 —— 宁可不动效，也不能把内容藏死 */
      if (shown === 0) {
        Array.prototype.forEach.call(items, function (n) { n.classList.add("in"); });
      }
    }, 2500);
  } else {
    Array.prototype.forEach.call(items, function (n) { n.classList.add("in"); });
  }

  /* ================= 7. 回主页的链接统一写在这里 ================= */
  Array.prototype.forEach.call(document.querySelectorAll("[data-home]"), function (a) {
    if (!a.getAttribute("href")) a.href = HOME_URL;
  });
})();
