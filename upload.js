/* ==========================================================================
   贴照片工具：把照片直接传到 Cloudinary，拿到链接后填进 photos.js
   --------------------------------------------------------------------------
   怎么用起来（一次性配置，3 步）：
     ① 注册 https://cloudinary.com（免费额度足够个人手账用）
     ② 打开 Dashboard，抄下最上面那个 **Cloud Name**
     ③ Settings（齿轮）→ Upload → 滚到 **Upload presets** → Add upload preset
          · Signing Mode 一定要选 **Unsigned**（选了它前端才能直传）
          · Folder 可以填 photo-notebook（不填也行）
          · 保存，然后把 preset 的名字抄下来
     ④ 把下面 CONFIG 里的四个值改成你自己的

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
    cloudName: "",                 /* ← Cloud Name，例如 "dabc12xyz" */
    uploadPreset: "",              /* ← 第 ③ 步建的 unsigned preset 名字 */
    folder: "photo-notebook",      /* ← 照片归到哪个文件夹，留空就是根目录 */
    passcode: "hjl-photo"          /* ← 改成你自己的口令 */
  };
  /* ======================================== */

  var root = document.getElementById("paste");
  if (!root) return;

  var KEY = "hjl-photo-paste-ok";          /* 只在 sessionStorage，关掉标签页就要重输 */
  var gate = document.getElementById("paste-gate");
  var codeInput = document.getElementById("paste-code");
  var tool = document.getElementById("paste-tool");
  var msg = document.getElementById("paste-msg");
  var fileInput = document.getElementById("paste-files");
  var goBtn = document.getElementById("paste-go");
  var list = document.getElementById("paste-list");
  var out = document.getElementById("paste-out");
  var outText = document.getElementById("paste-code-out");
  var copyBtn = document.getElementById("paste-copy");
  var copyMsg = document.getElementById("paste-copy-msg");

  var entries = [];                        /* 传成功的照片，攒成清单条目 */

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

  /* ---------- 选文件、一张一张传 ---------- */
  if (goBtn) {
    goBtn.addEventListener("click", function () {
      var files = Array.prototype.slice.call((fileInput && fileInput.files) || []);
      if (!files.length) { say(msg, "先选几张照片。"); return; }
      goBtn.disabled = true;
      say(msg, "");
      uploadSeq(files, 0);
    });
  }

  function uploadSeq(files, i) {
    if (i >= files.length) {
      goBtn.disabled = false;
      say(msg, entries.length ? ("传完了，" + entries.length + " 张。复制下面那几行粘进 photos.js。") : "一张都没传成功，看看下面的提示。");
      return;
    }
    uploadOne(files[i], function () { uploadSeq(files, i + 1); });
  }

  function uploadOne(file, next) {
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
    state.textContent = "0%";

    li.appendChild(name);
    li.appendChild(bar);
    li.appendChild(state);
    list.appendChild(li);

    var fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CONFIG.uploadPreset);
    if (CONFIG.folder) fd.append("folder", CONFIG.folder);

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CONFIG.cloudName + "/image/upload");

    xhr.upload.addEventListener("progress", function (e) {
      if (!e.lengthComputable) return;
      var pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = pct + "%";
      state.textContent = pct + "%";
    });

    xhr.addEventListener("load", function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }

      if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
        fill.style.width = "100%";
        state.textContent = "贴上了";
        li.classList.add("is-done");
        addEntry(file, data);
      } else {
        state.textContent = "没传成";
        li.classList.add("is-bad");
        var why = (data && data.error && data.error.message) || ("HTTP " + xhr.status);
        var err = document.createElement("span");
        err.className = "paste-err";
        err.textContent = why;
        li.appendChild(err);
      }
      next();
    });

    xhr.addEventListener("error", function () {
      state.textContent = "没传成";
      li.classList.add("is-bad");
      var err = document.createElement("span");
      err.className = "paste-err";
      err.textContent = "网络没连上；如果你是双击文件（file://）打开的，浏览器会拦掉上传，请用 https 网址打开。";
      li.appendChild(err);
      next();
    });

    xhr.send(fd);
  }

  /* ---------- 攒成可以直接粘进 photos.js 的一行 ---------- */
  function addEntry(file, data) {
    var base = file.name.replace(/\.[^.]+$/, "");
    var slug = base
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "photo";

    entries.push({ src: data.secure_url, slug: slug });

    if (!out) return;
    out.hidden = false;
    outText.value = entries.map(function (e) {
      return "        { src: '" + e.src + "', slug: '" + e.slug + "', time: '', place: '', note: '' },";
    }).join("\n");
  }

  /* ---------- 复制 ---------- */
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = outText.value || "";
      function fallback() {
        outText.focus();
        outText.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        say(copyMsg, ok ? "已复制，粘进 photos.js 就行。" : "复制没成功，手动选中上面的文字复制吧。");
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          say(copyMsg, "已复制，粘进 photos.js 就行。");
        }, fallback);
      } else {
        fallback();
      }
    });
  }
})();
