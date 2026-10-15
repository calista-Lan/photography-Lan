/* ==========================================================================
   贴照片工具：把照片直接传到 Cloudinary，连同时间 / 地点 / 一句心情一起存进去
   --------------------------------------------------------------------------
   现在的流程（不用再回头改 photos.js 了）：
     选照片 → 每行填「时间 / 地点 / 一句心情」→ 传上去
     → 别人打开你的站就能看到（Cloudinary 那份清单带缓存，最多晚几分钟）

   读清单有两条路，互为备份：

     ① 云端清单（对所有人可见）—— 现在走的就是这条路
        每次上传会把这三项写进照片的 context（元数据），
        页面再去 Cloudinary 读一份「带这个标签的全部照片」清单自动渲染。
        前提是后台 Settings（齿轮）→ Security → Restricted image types
        里 Resource list 这一项必须是取消勾选的 —— 已经开好了。

        ⚠️ 那个 401 的坑：Cloudinary 的 CDN 会把一次失败连着网址一起缓存，
        开关明明打开了，老网址还是一直把当初那个 401 还回来。
        app.js 里准备了三种大小写写法挨个试，就是为了绕开这条被缓存住的老网址，
        别再改回单一网址 —— 改回去就又读不到了。

     ② 本机清单（上传完立刻可见，是兜底）
        每传成功一张，就把「地址 + 时间地点心情」记一份在这台浏览器的
        localStorage 里。云端那份清单还没刷出来、或者断网的时候，
        照片照样铺得出来。别人看不到这份，但它保证你自己的电脑不用等。

     想让全世界都看到、又不想受那份缓存影响：点下面的「导出清单代码」，
     把生成的内容整段覆盖进 photos.js，提交上去就行（写死在仓库里，最稳）。

   ⚠️ 关于"密钥写进前端"这件事：
      这个站是纯静态的 GitHub Pages，仓库里的文件全部公开，
      所以任何写进 JS 的值别人都能看到。Cloudinary 的 **unsigned preset**
      是官方为这种场景准备的：它只能"往里传文件"，拿不到删除、列举、
      改配置的权限，所以放在这里是安全的。真正的 API Secret 不要写进来。

   ⚠️ 关于口令：
      只是防止访客随手点开上传框，**不是**安全措施。真正的权限由
      Cloudinary 的 preset 决定（必要时去后台给 preset 加大小/格式限制）。
   ========================================================================== */
(function () {
  "use strict";

  /* ============ 你只需要改这一段 ============ */
  var CONFIG = {
    cloudName: "KPVs88E6",            /* ← Cloud Name，例如 "dabc12xyz" */
    uploadPreset: "个人摄影网站",       /* ← unsigned preset 的名字（中文也行） */
    folder: "photo-notebook",         /* ← 照片归到哪个文件夹，留空就是根目录 */
    tag: "photo-notebook",            /* ← 读取清单用的标签，跟 APP 那边一致 */
    passcode: "Cshinipapa"            /* ← 改成你自己的口令 */
  };
  /* ======================================== */

  /* 给渲染那边用：页面启动时据此去取云端清单（所以本文件要在 app.js 之前加载） */
  window.HJL_UPLOAD_CONFIG = CONFIG;

  /* 本机清单存在 localStorage 里的键名 —— app.js 读的是同一个名字，改要两边一起改 */
  var MINE_KEY = "hjl-photo-mine-v1";
  window.HJL_MINE_KEY = MINE_KEY;

  var root = document.getElementById("paste");
  if (!root) return;

  var KEY = "hjl-photo-paste-ok";          /* 只在 sessionStorage，关掉标签页就要重输 */
  var gate = document.getElementById("paste-gate");
  var codeInput = document.getElementById("paste-code");
  var tool = document.getElementById("paste-tool");
  var msg = document.getElementById("paste-msg");
  var done = document.getElementById("paste-done");
  var fileInput = document.getElementById("paste-files");
  var goBtn = document.getElementById("paste-go");
  var list = document.getElementById("paste-list");

  var rows = [];                            /* 每一行：文件 + 它那三个输入框 */

  var mineInfo = document.getElementById("paste-mine-info");
  var exportBtn = document.getElementById("paste-export");
  var wipeBtn = document.getElementById("paste-wipe");
  var outBox = document.getElementById("paste-out");
  var outMsg = document.getElementById("paste-out-msg");

  var editBox = document.getElementById("paste-edit");
  var editList = document.getElementById("paste-edit-list");
  var editMsg = document.getElementById("paste-edit-msg");

  /* 删除那一支把进度写回这一区自己的一行小字上。
     不写回上面那个 paste-msg：那一行常常在屏幕外，写完看不见，
     会以为按钮点了没反应。 */
  function sayEdit(t) {
    if (editMsg) editMsg.textContent = t || "";
  }

  function ready() { return !!CONFIG.cloudName && !!CONFIG.uploadPreset; }

  /* ---------- 本机清单：这台电脑传过的照片留一份底 ---------- */
  function readMine() {
    try {
      var raw = localStorage.getItem(MINE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(arr) !== "[object Array]") return [];
      return arr.filter(function (p) {
        return p && typeof p.src === "string" && p.src.indexOf("https://") === 0;
      });
    } catch (e) { return []; }
  }

  function saveMine(arr) {
    try { localStorage.setItem(MINE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  /* 同一张地址只留一条（后传的信息更准，覆盖掉旧的） */
  function remember(item) {
    var arr = readMine().filter(function (p) { return p.src !== item.src; });
    arr.push(item);
    saveMine(arr);
    showMineCount();
  }

  function showMineCount() {
    if (!mineInfo) return;
    var n = readMine().length;
    mineInfo.textContent = n ? "本机记着 " + n + " 张照片。" : "本机还没记下照片。";
  }

  function qs(v) {
    return "'" + String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }

  /* 导出成 photos.js 能直接用的内容，方便提交出去给所有人看 */
  function exportCode() {
    var arr = readMine();
    if (!arr.length) return "";
    var order = [], buckets = {}, titles = {};
    arr.forEach(function (p) {
      var tm = String(p.time || "").trim().slice(0, 7);
      var pl = String(p.place || "").trim();
      var key = (tm || "无") + "\u0000" + pl;
      if (!buckets[key]) {
        buckets[key] = [];
        order.push(key);
        titles[key] = tm ? (pl ? tm + " " + pl : tm) : "（还没写时间的）";
      }
      buckets[key].push(p);
    });
    var L = ["window.HJL_PHOTOS = {", "  groups: ["];
    order.forEach(function (key, gi) {
      L.push("    {");
      L.push("      title: " + qs(titles[key]) + ",");
      L.push("      desc: '',");
      L.push("      photos: [");
      buckets[key].forEach(function (p, pi, all) {
        L.push("        { src: " + qs(p.src) + ", time: " + qs(p.time) +
               ", place: " + qs(p.place) + ", note: " + qs(p.note) + " }" +
               (pi < all.length - 1 ? "," : ""));
      });
      L.push("      ]");
      L.push("    }" + (gi < order.length - 1 ? "," : ""));
    });
    L.push("  ]", "};");
    return L.join("\n");
  }

  if (exportBtn && outBox) {
    exportBtn.addEventListener("click", function () {
      var code = exportCode();
      if (!code) { say(outMsg, "本机还没有照片可以导出。"); if (outBox) outBox.hidden = true; return; }
      outBox.value = code;
      outBox.hidden = false;
      outBox.select();
      var copied = false;
      try { copied = document.execCommand && document.execCommand("copy"); } catch (e) {}
      /* navigator.clipboard 在 file:// 下用不了，两条路都试一下，都不行就让用户手选 */
      if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () {
          say(outMsg, "已经复制好了。把整段内容覆盖进 photos.js，提交上去，所有人都能看到。");
        }, function () {
          say(outMsg, "复制不了自动粘贴板，方框里的字已经选好了，按 Ctrl+C 复制，整段覆盖进 photos.js。");
        });
        return;
      }
      say(outMsg, copied
        ? "已经复制好了。把整段内容覆盖进 photos.js，提交上去，所有人都能看到。"
        : "方框里的字已经选好了，按 Ctrl+C 复制，整段覆盖进 photos.js。");
    });
  }

  if (wipeBtn) {
    wipeBtn.addEventListener("click", function () {
      var n = readMine().length;
      if (!n) { say(outMsg, "本机本来就没有记录。"); return; }
      if (wipeBtn.dataset.armed !== "1") {
        wipeBtn.dataset.armed = "1";
        wipeBtn.textContent = "再点一次，确认清空";
        say(outMsg, "只清本机记录，云端的照片不动。");
        setTimeout(function () {
          wipeBtn.dataset.armed = "";
          wipeBtn.textContent = "清空本机记录";
        }, 4000);
        return;
      }
      saveMine([]);
      wipeBtn.dataset.armed = "";
      wipeBtn.textContent = "清空本机记录";
      if (outBox) outBox.hidden = true;
      say(outMsg, "清掉了 " + n + " 条本机记录（云端照片还在）。");
      showMineCount();
      if (window.HJL_REFRESH_PHOTOS) window.HJL_REFRESH_PHOTOS();
    });
  }

  showMineCount();

  /* ============ 编辑已上传的照片 ============
     改的是云端那条照片的 context（time / place / note）。
     Cloudinary 的「改元数据」接口要签名，签名要 API Secret ——
     Secret 绝不能写进公开网页。所以这里只在用户**自己粘了**
     adminKey（API Key，权限受限、可以随时在后台吊销）时启用：
       · 没粘：这一区照样能改，只是改的是本机那份记录（自己电脑立刻生效），
               云端那条要跑 photo-admin.py 选 3。
       · 粘了：请求带上 api_key + 预设，云端那条一起改掉。
     说白了 —— 这是给站主自己用的便利入口，不是给访客的。 */

  var ADMIN_KEY_LS = "hjl-photo-adminkey-v1";

  function adminKey() {
    try { return String(localStorage.getItem(ADMIN_KEY_LS) || "").trim(); } catch (e) { return ""; }
  }

  /* 云端那张照片的 public_id：从 secure_url 里切出来 */
  function publicIdOf(src) {
    var m = String(src || "").match(/\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
    return m ? m[1] : "";
  }

  /* 编辑列表的数据源：本机记录优先；没有就退回瀑布流里已铺出来的那些
     （云端清单由 app.js 读，读到的照片挂在格子节点上） */
  function editSource() {
    var mine = readMine();
    if (mine.length) return mine;
    var out = [];
    var cells = document.querySelectorAll(".m-item.has-pic");
    Array.prototype.forEach.call(cells, function (c) {
      var p = c.__p;
      if (p && p.src) out.push({
        src: p.src, time: p.time, place: p.place, note: p.note, created: p.created
      });
    });
    return out;
  }

  function rebuildEditList() {
    if (!editBox || !editList) return;
    var arr = editSource();
    if (!arr.length) { editBox.hidden = true; editList.innerHTML = ""; return; }
    editBox.hidden = false;
    editList.innerHTML = "";

    arr.forEach(function (p) {
      var li = document.createElement("li");

      var row = document.createElement("button");
      row.type = "button";
      row.className = "pe-row";
      row.setAttribute("aria-expanded", "false");

      var thumb = document.createElement("span");
      thumb.className = "pe-thumb";
      var im = document.createElement("img");
      im.alt = "";
      im.loading = "lazy";
      im.src = String(p.src).replace("/image/upload/", "/image/upload/c_scale,w_120,q_auto/");
      thumb.appendChild(im);

      var text = document.createElement("span");
      text.className = "pe-text";
      var ti = document.createElement("span");
      ti.className = "pe-title";
      ti.textContent = (p.note || p.place || "无题");
      var me = document.createElement("span");
      me.className = "pe-meta";
      me.textContent = [p.place, p.time].filter(Boolean).join(" · ") || "还没填时间地点";
      text.appendChild(ti);
      text.appendChild(me);

      row.appendChild(thumb);
      row.appendChild(text);
      li.appendChild(row);
      editList.appendChild(li);

      /* 点开就地变成三项表单 —— 不新开页、不弹窗 */
      row.addEventListener("click", function () {
        var open = li.querySelector(".pe-form");
        if (open) { open.remove(); row.setAttribute("aria-expanded", "false"); return; }
        row.setAttribute("aria-expanded", "true");
        li.appendChild(buildEditForm(p, li, row));
      });
    });
  }

  function buildEditForm(p, li, row) {
    var form = document.createElement("div");
    form.className = "pe-form";
    var meta = document.createElement("p");
    meta.className = "paste-meta";
    var fields = {};
    [["time", "时间", "2026.09"], ["place", "地区 / 地点", "珠海"],
     ["note", "一句心情", "风大得睁不开眼"]].forEach(function (f) {
      var lab = document.createElement("label");
      lab.appendChild(document.createTextNode(f[1]));
      var inp = document.createElement("input");
      inp.type = "text";
      inp.value = p[f[0]] || "";
      inp.placeholder = f[2];
      inp.autocomplete = "off";
      lab.appendChild(inp);
      meta.appendChild(lab);
      fields[f[0]] = inp;
    });
    form.appendChild(meta);

    var acts = document.createElement("p");
    acts.className = "pe-actions";
    var save = document.createElement("button");
    save.type = "button";
    save.textContent = "保存";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    var del = document.createElement("button");
    del.type = "button";
    del.className = "pe-del";
    del.textContent = "删除这张";
    acts.appendChild(save);
    acts.appendChild(cancel);
    acts.appendChild(del);
    form.appendChild(acts);

    cancel.addEventListener("click", function () {
      form.remove();
      row.setAttribute("aria-expanded", "false");
    });

    /* 删除：两段式确认。云端能不能真删掉取决于有没有 API Secret，
       但本机这一份立刻就不铺了 —— 点了必须看得见变化 */
    del.addEventListener("click", function () {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.classList.add("is-armed");
        del.textContent = "再点一次确认";
        setTimeout(function () {
          del.dataset.armed = "";
          del.classList.remove("is-armed");
          del.textContent = "删除这张";
        }, 4000);
        return;
      }
      del.disabled = true;
      sayEdit("正在删除……");
      pushDelete(p.src, function (ok, detail) {
        del.disabled = false;
        del.dataset.armed = "";
        del.classList.remove("is-armed");
        del.textContent = "删除这张";
        if (!ok) { sayEdit("没删成：" + detail); return; }
        /* 本机记录抹掉 + 告诉瀑布流这一张别再铺（清单有缓存，不记这一笔会复活） */
        saveMine(readMine().filter(function (x) { return x.src !== p.src; }));
        showMineCount();
        if (window.HJL_HIDE_SRC) window.HJL_HIDE_SRC(p.src);
        if (window.HJL_REFRESH_PHOTOS) window.HJL_REFRESH_PHOTOS();
        sayEdit(detail);
        rebuildEditList();
      });
    });

    save.addEventListener("click", function () {
      var next = {
        src: p.src,
        w: p.w, h: p.h,
        time: ctxSafe(fields.time.value),
        place: ctxSafe(fields.place.value),
        note: ctxSafe(fields.note.value),
        created: p.created || new Date().toISOString()
      };
      save.disabled = true;
      say(editMsg, "正在保存……");
      pushEdit(p.src, next, function (ok, detail) {
        save.disabled = false;
        if (!ok) { say(editMsg, "没改成：" + detail); return; }
        /* 本机那份先就地更新，站点立刻能看到新信息 */
        remember(next);
        showMineCount();
        say(editMsg, "保存好了。" + detail);
        rebuildEditList();
        if (window.HJL_REFRESH_PHOTOS) window.HJL_REFRESH_PHOTOS();
      });
    });

    return form;
  }

  /* 把新信息推到云端。带 api_key 时云端那条一起改；没带就只改本机记录 */  function pushEdit(src, next, done) {
    var pid = publicIdOf(src);
    var ak = adminKey();
    if (!pid) { done(false, "这个地址里认不出照片编号。"); return; }

    if (!ak) {
      done(true, "（只改了本机记录，云端那条跑 photo-admin.py 选 3 改。）");
      return;
    }

    var fd = new FormData();
    fd.append("file", onePixel());
    fd.append("upload_preset", CONFIG.uploadPreset);
    fd.append("public_id", pid);
    fd.append("context", "time=" + next.time + "|place=" + next.place + "|note=" + next.note);

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CONFIG.cloudName + "/image/upload");
    xhr.addEventListener("load", function () {
      if (xhr.status >= 200 && xhr.status < 300) { done(true, "（云端也更新了。）"); return; }
      var d = null;
      try { d = JSON.parse(xhr.responseText); } catch (e) {}
      var why = (d && d.error && d.error.message) || ("HTTP " + xhr.status);
      done(true, "（本机改了，云端那条没成：" + why + "）");
    });
    xhr.addEventListener("error", function () {
      done(true, "（本机改了，云端那条没连上，稍后再试。）");
    });
    xhr.send(fd);
  }

  /* Cloudinary 的 multipart 里必须有 file 字段；配合 public_id 时
     只重写元数据、图片不动。这里给一个占位文件就够。 */
  function onePixel() {
    return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "meta.png", { type: "image/png" });
  }

  /* 本机记录：这台电脑传过的照片留一份底，也能导出成 photos.js */
  var ADMIN_SECRET_LS = "hjl-photo-adminsecret-v1";

  /* ============ 删掉一张 ============
     Cloudinary 的销毁接口必须签名，签名要 API Secret。
     Secret 写进公开网页等于把账号交出去，所以这里只在**你自己**
     于本机存过 Secret（localStorage，只在这台电脑上）时才真删云端那条。
     没存的话：本机记录抹掉、墙上也不再显示 —— 但云端那张还在，
     要永久删掉跑 photo-admin.py 选 5。

     瀑布流那边的「删除」也走这里（HJL_DELETE_PHOTO），
     免得两处各写一份签名逻辑、以后改漏一处。 */

  function adminSecret() {
    try { return String(localStorage.getItem(ADMIN_SECRET_LS) || "").trim(); } catch (e) { return ""; }
  }

  function pushDelete(src, done) {
    var pid = publicIdOf(src);
    if (!pid) { done(false, "这个地址里认不出照片编号。"); return; }

    var secret = adminSecret();
    if (!secret) {
      done(true, "本机已经不再显示了。云端那张没删 —— 跑 photo-admin.py 选 5，" +
                 "或先在本机存好 API Key 和 Secret。");
      return;
    }

    var ts = String(Math.floor(Date.now() / 1000));
    var base = secret + adminKey();
    /* 签名 = 把「要签的字段按字典序拼好 + 密钥」做一次 sha1。
       密钥是 Secret 在前、Key 在后（Cloudinary 的规定）。 */
    sha1Hex("public_id=" + pid + "&timestamp=" + ts + "&invalidate=true" + base)
      .then(function (sig) {
        var body = "public_id=" + encodeURIComponent(pid) +
                   "&timestamp=" + encodeURIComponent(ts) +
                   "&invalidate=true" +
                   "&api_key=" + encodeURIComponent(adminKey()) +
                   "&signature=" + encodeURIComponent(sig);
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CONFIG.cloudName + "/resources/image/upload/delete_by_token");
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.addEventListener("load", function () {
          var d = null;
          try { d = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && d && d.result === "ok") {
            done(true, "删掉了，云端也清干净了。");
          } else {
            var why = (d && d.error && d.error.message) || ("HTTP " + xhr.status);
            done(true, "本机已经不显示了，云端那条没删成（" + why + "）。可以走 photo-admin.py 选 5。");
          }
        });
        xhr.addEventListener("error", function () {
          done(true, "本机已经不显示了，云端那条没连上。可以走 photo-admin.py 选 5。");
        });
        xhr.send(body);
      });
  }

  /* SHA-1：优先用浏览器的 WebCrypto（只有 https / localhost 才给用），
     本地双击打开时退回自己实现的那一份 */
  function sha1Hex(str) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
      var buf = new TextEncoder().encode(str);
      return crypto.subtle.digest("SHA-1", buf).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        }).join("");
      });
    }
    return Promise.resolve(plainSha1(str));
  }

  /* 没有 WebCrypto 时的兜底实现（本地 file:// 预览会走到这里） */
  function plainSha1(s) {
    function rl(n, b) { return (n << b) | (n >>> (32 - b)); }
    function add(a, b) { return (a + b) | 0; }
    var msg = [], utf = unescape(encodeURIComponent(s)), i;
    for (i = 0; i < utf.length; i++) msg.push(utf.charCodeAt(i));
    var l = msg.length;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var bits = l * 8;
    for (i = 7; i >= 0; i--) msg.push((bits / Math.pow(2, i * 8)) & 0xff);

    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
        h3 = 0x10325476, h4 = 0xC3D2E1F0;
    var w = new Array(80);
    for (var j = 0; j < msg.length; j += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (msg[j + i * 4] << 24) | (msg[j + i * 4 + 1] << 16) |
               (msg[j + i * 4 + 2] << 8) | msg[j + i * 4 + 3];
      }
      for (i = 16; i < 80; i++) w[i] = rl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var t = add(add(add(rl(a, 5), f), add(add(e, k), w[i])), 0);
        e = d; d = c; c = rl(b, 30); b = a; a = t;
      }
      h0 = add(h0, a); h1 = add(h1, b); h2 = add(h2, c);
      h3 = add(h3, d); h4 = add(h4, e);
    }
    return [h0, h1, h2, h3, h4].map(function (n) {
      return ("00000000" + (n >>> 0).toString(16)).slice(-8);
    }).join("");
  }

  rebuildEditList();
  window.HJL_REBUILD_EDIT = rebuildEditList;
  /* 瀑布流那边的删除走这条回话：提示落在这一区自己那行小字上 */
  window.HJL_DEL_MSG = sayEdit;

  /* 瀑布流那边的「删除」按钮转到这里来执行：本机的记录由它抹掉，
     云端的删除由这里统一带签名（那边没有 Secret）。
     抹本机记录这件事两边都做一遍是安全的 —— 内部都是按地址过滤后重写。 */
  window.HJL_DELETE_PHOTO = function (src, done) {
    pushDelete(src, function (ok, detail) {
      if (ok) {
        saveMine(readMine().filter(function (x) { return x.src !== src; }));
        showMineCount();
      }
      done(ok, detail);
    });
  };


  if (!ready()) {
    say(msg, "还没配置好：打开 upload.js，把 cloudName 和 uploadPreset 两个值填上。");
    if (goBtn) goBtn.disabled = true;
  } else if (window.sessionStorage && sessionStorage.getItem(KEY) === "1") {
    openTool();
  }

  function openTool() {
    if (gate) gate.hidden = true;
    if (tool) tool.hidden = false;
  }

  /* ---------- 口令 ---------- */
  if (gate) {
    gate.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!ready()) {
        say(msg, "还没配置好：先填 upload.js 里的 cloudName 和 uploadPreset。");
        return;
      }
      if ((codeInput.value || "").trim() === CONFIG.passcode) {
        try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
        say(msg, "");
        openTool();
      } else {
        say(msg, "口令不对，再想想。");
      }
    });
  }

  /* ---------- 选好文件后，给每张照片排一行（时间 / 地点 / 心情） ---------- */
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      list.innerHTML = "";
      rows = [];
      say(msg, "");
      say(done, "");

      files.forEach(function (file) {
        var li = document.createElement("li");

        var name = document.createElement("span");
        name.className = "paste-name";
        name.textContent = file.name;

        var bar = document.createElement("span");
        bar.className = "paste-bar";
        var fill = document.createElement("i");
        bar.appendChild(fill);

        var state = document.createElement("span");
        state.className = "paste-state";
        state.textContent = "待传";

        /* 三项元数据：跟着这张照片一起存进 Cloudinary */
        var meta = document.createElement("p");
        meta.className = "paste-meta";
        var fields = {};
        [["time", "时间", "2026.09"],
         ["place", "地点", "海边"],
         ["note", "一句心情", "风大得睁不开眼"]].forEach(function (f) {
          var lab = document.createElement("label");
          lab.appendChild(document.createTextNode(f[1]));
          var inp = document.createElement("input");
          inp.type = "text";
          inp.placeholder = f[2];
          inp.autocomplete = "off";
          inp.className = "m-" + f[0];
          lab.appendChild(inp);
          meta.appendChild(lab);
          fields[f[0]] = inp;
        });

        li.appendChild(name);
        li.appendChild(bar);
        li.appendChild(state);
        li.appendChild(meta);
        list.appendChild(li);

        rows.push({ file: file, li: li, fill: fill, state: state, f: fields });
      });
    });
  }

  /* ---------- 传上去 ---------- */
  if (goBtn) {
    goBtn.addEventListener("click", function () {
      if (!rows.length) { say(msg, "先点「选照片」挑几张。"); return; }
      goBtn.disabled = true;
      say(msg, "");
      say(done, "");
      uploadSeq(0);
    });
  }

  function uploadSeq(i) {
    if (i >= rows.length) {
      goBtn.disabled = false;
      var ok = rows.filter(function (r) { return r.ok; }).length;
      if (!ok) {
        say(msg, "一张都没传成功，看看每行下面的提示。");
      } else {
        say(done, "贴上 " + ok + " 张了。");
        /* 不用手动刷新：告诉渲染那边再来一遍 */
        if (window.HJL_REFRESH_PHOTOS) window.HJL_REFRESH_PHOTOS();
        else try { location.reload(); } catch (e) {}
      }
      return;
    }
    uploadOne(rows[i], function () { uploadSeq(i + 1); });
  }

  /* context 的格式是 key=value 用竖线隔开，用户填的 | 和 = 会把它弄坏 */
  function ctxSafe(v) {
    return String(v || "").replace(/[\r\n]+/g, " ").replace(/[|=]/g, " ").trim();
  }

  function uploadOne(row, next) {
    var fill = row.fill;
    var state = row.state;
    var li = row.li;

    var fd = new FormData();
    fd.append("file", row.file);
    fd.append("upload_preset", CONFIG.uploadPreset);
    if (CONFIG.folder) fd.append("folder", CONFIG.folder);
    if (CONFIG.tag) fd.append("tags", CONFIG.tag);

    /* 时间 / 地点 / 一句心情：存成照片的元数据，页面直接读出来用 */
    var ctx = ["time", "place", "note"].map(function (k) {
      return k + "=" + ctxSafe(row.f[k].value);
    }).join("|");
    if (ctx !== "time=|place=|note=") fd.append("context", ctx);

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CONFIG.cloudName + "/image/upload");

    xhr.upload.addEventListener("progress", function (e) {
      if (!e.lengthComputable) return;
      var pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = pct + "%";
      state.textContent = pct + "%";
    });

    function bad(why) {
      state.textContent = "没传成";
      li.classList.add("is-bad");
      var err = document.createElement("span");
      err.className = "paste-err";
      err.textContent = why;
      li.appendChild(err);
      next();
    }

    xhr.addEventListener("load", function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }

      if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
        fill.style.width = "100%";
        state.textContent = "贴上了";
        li.classList.add("is-done");
        row.ok = true;

        /* 云端清单读不出来也别慌：这台电脑上先记一份，照片立刻就能看到 */
        remember({
          src: data.secure_url,
          w: data.width || 0,
          h: data.height || 0,
          time: ctxSafe(row.f.time.value),
          place: ctxSafe(row.f.place.value),
          note: ctxSafe(row.f.note.value),
          created: data.created_at || new Date().toISOString()
        });
      } else {
        bad((data && data.error && data.error.message) || ("HTTP " + xhr.status));
      }
      next();
    });

    xhr.addEventListener("error", function () {
      bad("网络没连上；如果你是双击文件（file://）打开的，浏览器会拦掉上传，请用 https 网址打开。");
    });

    xhr.addEventListener("abort", function () { bad("传了一半被中断了。"); });

    xhr.send(fd);
  }
})();
