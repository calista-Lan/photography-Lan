/* ==========================================================================
   贴照片工具：把照片直接传到 Cloudinary，连同时间 / 地点 / 一句心情一起存进去
   --------------------------------------------------------------------------
   现在的流程（不用再回头改 photos.js 了）：
     选照片 → 每行填「时间 / 地点 / 一句心情」→ 传上去
     → 大约一分钟后，照片就自动出现在页面「照片」那一页里

   原理：每次上传会把这三项写进照片的 context（元数据），
         页面再去 Cloudinary 读一份「带这个标签的全部照片」清单自动渲染。
   所以 **必须在 Cloudinary 后台打开一个开关**（一次性的）：
       Settings（齿轮）→ Security → Restricted image types
       → 把 Resource list 这一项取消勾选 → Save
     没开的话页面会安静地退回本地清单（不会报错，也不会显示乱东西）。

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

  function ready() { return !!CONFIG.cloudName && !!CONFIG.uploadPreset; }

  function say(node, text) { if (node) node.textContent = text || ""; }

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
        say(done, "贴上 " + ok + " 张了。刷新页面（或等一分钟），照片那一页就会自动出现。");
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
