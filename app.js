(function () {
  "use strict";

  var API_URL = window.API_URL || "";

  // ---------- State ----------
  var manifest = null;
  var staticQuestions = [];   // câu hỏi gốc của chương đang chọn
  var extraQuestions = [];    // câu hỏi bổ sung (Google Sheet) của chương đang chọn
  var currentStats = null;    // {totalDone, last5, wrongIds}
  var selectedCount = null;

  var quiz = null; // {questions, index, mode, answers:[{id,correct}]}
  var lastLeaderboardData = null; // cache dữ liệu bảng xếp hạng gần nhất, để tô đậm tên của em khi gõ tên
  var pinVerified = false;   // tên + mã hiện tại đã được backend xác nhận khớp (hoặc đăng ký mới) chưa
  var pinCheckToken = 0;     // chống việc phản hồi cũ (gõ nhanh) ghi đè kết quả của lần kiểm tra mới hơn
  var pinDebounceTimer = null;
  var lastChapterProgressData = null; // {chapters:[{chapter,uniqueDone,wrongCount}]} - cache để vẽ lại khi đổi Lớp mà không cần gọi API lại
  var streakCelebratedThisVisit = false; // tránh hiện lại banner chúc mừng nhiều lần trong cùng 1 lượt ghé trang

  // ---------- Chế độ Đối đầu 1vs1 ----------
  var DUEL_QUESTION_COUNT = 10;
  var DUEL_WAIT_SECONDS = 60;
  var DUEL_TIME_LIMIT_SECONDS = 300;
  var appMode = "solo";          // "solo" | "duel" — tab đang chọn ở màn hình chính
  var duelMatchId = null;
  var duelOpponentName = null;
  var duelWaitDeadlineMs = null; // mốc hết hạn phòng chờ (60s) — để vẽ đồng hồ đếm ngược
  var duelWaitTickTimer = null;  // interval vẽ lại đồng hồ đếm ngược phòng chờ mỗi giây
  var duelWaitPollTimer = null;  // interval hỏi lại server xem đã có ai ghép chưa
  var duelPickPollTimer = null;  // interval làm mới danh sách "chọn đối thủ"
  var duelQuizStartMs = null;    // mốc server ghi nhận trận đấu bắt đầu (dùng tính "làm mất bao lâu")
  var duelQuizTickTimer = null;  // interval vẽ lại đồng hồ đếm ngược 5 phút trong lúc làm bài
  var duelResultPollTimer = null; // interval hỏi lại xem đối thủ đã nộp bài chưa
  var lastDuelLeaderboardData = null;

  // ---------- Helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.add("hidden"); });
    $(id).classList.remove("hidden");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function apiGet(params) {
    if (!API_URL) return Promise.resolve(null);
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetch(API_URL + "?" + qs)
      .then(function (r) { return r.json(); })
      .catch(function (err) { console.warn("apiGet lỗi", err); return null; });
  }
  function apiPost(body) {
    if (!API_URL) return Promise.resolve(null);
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // tránh CORS preflight
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .catch(function (err) { console.warn("apiPost lỗi", err); return null; });
  }

  // ---------- Setup screen ----------
  function currentChapterId() { return $("#sel-chapter").value; }
  function currentGradeObj() {
    return manifest.grades.find(function (g) { return g.id === $("#sel-grade").value; });
  }
  function currentChapterObj() {
    var g = currentGradeObj();
    if (!g) return null;
    return g.chapters.find(function (c) { return c.id === currentChapterId(); });
  }

  function populateGrades() {
    var sel = $("#sel-grade");
    sel.innerHTML = "";
    manifest.grades.forEach(function (g) {
      var o = el("option"); o.value = g.id; o.textContent = g.name;
      sel.appendChild(o);
    });
  }
  function populateChapters() {
    var sel = $("#sel-chapter");
    sel.innerHTML = "";
    var g = currentGradeObj();
    g.chapters.forEach(function (c) {
      var o = el("option"); o.value = c.id; o.textContent = c.name + " (" + c.count + " câu)";
      sel.appendChild(o);
    });
  }

  function loadStaticQuestions(chapterId) {
    return fetch("data/" + chapterId + ".json").then(function (r) { return r.json(); });
  }

  function refreshCountOptions() {
    var box = $("#count-options");
    box.innerHTML = "";
    var chap = currentChapterObj();
    if (!chap) return;
    var total = chap.count + extraQuestions.length;
    var opts = [];
    for (var n = 10; n <= total; n += 10) opts.push(n);
    var hasAll = opts.length === 0 || opts[opts.length - 1] !== total;
    selectedCount = opts.length ? opts[0] : total;

    opts.forEach(function (n) {
      var b = el("button", null, n + " câu");
      b.type = "button";
      b.addEventListener("click", function () {
        selectedCount = n;
        box.querySelectorAll("button").forEach(function (x) { x.classList.remove("selected"); });
        b.classList.add("selected");
        validateStart();
      });
      box.appendChild(b);
    });
    if (hasAll) {
      var bAll = el("button", null, "Làm hết (" + total + ")");
      bAll.type = "button";
      bAll.addEventListener("click", function () {
        selectedCount = total;
        box.querySelectorAll("button").forEach(function (x) { x.classList.remove("selected"); });
        bAll.classList.add("selected");
        validateStart();
      });
      box.appendChild(bAll);
      if (!opts.length) selectedCount = total;
    }
    if (box.firstChild) box.firstChild.classList.add("selected");
    validateStart();
  }

  // ---------- Chuyển đổi Tự luyện tập / Đối đầu 1vs1 ----------
  function setAppMode(mode) {
    appMode = mode;
    $("#tab-mode-solo").classList.toggle("selected", mode === "solo");
    $("#tab-mode-duel").classList.toggle("selected", mode === "duel");
    $("#solo-panel").classList.toggle("hidden", mode !== "solo");
    $("#duel-panel").classList.toggle("hidden", mode !== "duel");
    $("#duel-msg").textContent = "";
    refreshDuelControls();
  }

  // Bật/tắt 2 nút "Thách thức" / "Đồng ý thử thách" tuỳ đã xác minh tên+mã và chương đủ ít nhất 10 câu chưa.
  function refreshDuelControls() {
    var btnChallenge = $("#btn-challenge");
    var btnAccept = $("#btn-accept-challenge");
    if (!btnChallenge || !btnAccept) return;
    var name = $("#inp-name").value.trim();
    var readyBase = !!API_URL && !!name && pinVerified && !!currentChapterId();
    var poolSize = staticQuestions.length + extraQuestions.length;
    btnChallenge.disabled = !readyBase || poolSize < DUEL_QUESTION_COUNT;
    btnAccept.disabled = !readyBase;
    var msgEl = $("#duel-msg");
    if (msgEl && readyBase && poolSize < DUEL_QUESTION_COUNT) {
      msgEl.textContent = "Chương này chưa đủ " + DUEL_QUESTION_COUNT + " câu để đấu, hãy chọn chương khác.";
    } else if (msgEl && msgEl.textContent.indexOf("chưa đủ") !== -1) {
      msgEl.textContent = "";
    }
  }

  function renderStats() {
    var box = $("#stats-box");
    if (!currentStats || !currentStats.attempts) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    var last5 = currentStats.last5 || [];
    var last5Txt = last5.length
      ? last5.map(function (p) { return p + "%"; }).join(" · ")
      : "chưa có";
    $("#stats-content").innerHTML =
      "Tổng số câu đã làm: <b>" + currentStats.totalDone + "</b><br>" +
      "Tỉ lệ đúng " + last5.length + " lần gần nhất: <b>" + last5Txt + "</b>" +
      (currentStats.wrongIds && currentStats.wrongIds.length
        ? "<br>Số câu đang còn sai (sẽ ưu tiên xuất hiện lại): <b>" + currentStats.wrongIds.length + "</b>"
        : "");
  }

  function refreshStats() {
    var name = $("#inp-name").value.trim();
    var chap = currentChapterId();
    if (!name || !chap || !pinVerified) { currentStats = null; renderStats(); return; }
    apiGet({ action: "stats", name: name, chapter: chap, pin: currentPin() }).then(function (res) {
      if (!res || res.error) { currentStats = null; renderStats(); return; }
      currentStats = res;
      renderStats();
    });
  }

  // ---------- Huy hiệu theo chuỗi ngày luyện tập (cứ 7 ngày liên tục = 1 bậc huy hiệu) ----------
  // Hết dụng cụ thí nghiệm thì chuyển sang huy hiệu ký hiệu nguyên tố hoá học (không lo hết bậc).
  var LAB_BADGES = [
    { icon: "🧪", label: "Ống nghiệm" },
    { icon: "⚗️", label: "Bình cầu chưng cất" },
    { icon: "🧫", label: "Đĩa petri" },
    { icon: "🔬", label: "Kính hiển vi" },
    { icon: "🧲", label: "Nam châm phòng thí nghiệm" },
    { icon: "⚛️", label: "Nguyên tử" },
    { icon: "🔥", label: "Ngọn lửa thí nghiệm" },
    { icon: "💧", label: "Giọt dung dịch" },
    { icon: "🌡️", label: "Nhiệt kế" }
  ];
  var ELEMENT_BADGES = [
    ["H", "Hydro"], ["He", "Heli"], ["Li", "Lithi"], ["Be", "Beryli"], ["B", "Bo"],
    ["C", "Carbon"], ["N", "Nitơ"], ["O", "Oxy"], ["F", "Flo"], ["Ne", "Neon"],
    ["Na", "Natri"], ["Mg", "Magie"], ["Al", "Nhôm"], ["Si", "Silic"], ["P", "Photpho"],
    ["S", "Lưu huỳnh"], ["Cl", "Clo"], ["Ar", "Argon"], ["K", "Kali"], ["Ca", "Canxi"],
    ["Fe", "Sắt"], ["Cu", "Đồng"], ["Zn", "Kẽm"], ["Ag", "Bạc"], ["Au", "Vàng"],
    ["I", "Iot"], ["Pb", "Chì"], ["Br", "Brom"], ["Mn", "Mangan"], ["Ni", "Niken"]
  ];
  function badgeForLevel(level) { // level = số bậc 7-ngày đã đạt (>=1)
    if (level <= LAB_BADGES.length) {
      var b = LAB_BADGES[level - 1];
      return { icon: b.icon, label: b.label };
    }
    var idx = level - LAB_BADGES.length - 1;
    if (idx < ELEMENT_BADGES.length) {
      var e = ELEMENT_BADGES[idx];
      return { icon: e[0], label: "Nguyên tố " + e[0] + " – " + e[1] };
    }
    return { icon: "💎", label: "Huyền thoại phòng thí nghiệm" }; // chuỗi cực dài, hết cả bảng nguyên tố thường gặp
  }

  function renderStreak(res) {
    var box = $("#streak-box");
    if (!box) return;
    if (!res || res.error || typeof res.streak !== "number") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    var streak = res.streak;
    var level = Math.floor(streak / 7);
    var daysToNext = streak === 0 ? 7 : (7 - (streak % 7)) || 7;
    var html = "🔥 Chuỗi luyện tập: <b>" + streak + " ngày liên tiếp</b>";
    if (level >= 1) {
      var cur = badgeForLevel(level);
      html += "<br>Huy hiệu hiện tại: <span class=\"badge-chip\">" + cur.icon + " " + escapeHtml(cur.label) + "</span>";
    }
    var next = badgeForLevel(level + 1);
    html += "<br><span class=\"small\">Còn " + daysToNext + " ngày nữa để nhận huy hiệu tiếp theo: " +
      next.icon + " " + escapeHtml(next.label) + "</span>";
    if (!res.practicedToday) {
      html += "<br><span class=\"streak-warn\">⚠️ Hôm nay em chưa luyện tập — làm ngay để giữ chuỗi!</span>";
    }
    $("#streak-content").innerHTML = html;
  }
  // Hiện banner chúc mừng trên màn hình kết quả nếu lượt nộp bài này vừa giúp đạt 1 mốc 7-ngày mới.
  function showBadgeCelebrationIfAny(res) {
    var banner = $("#result-badge");
    if (!banner) return;
    if (!res || res.error || !res.practicedToday || !res.streak || res.streak % 7 !== 0 || streakCelebratedThisVisit) {
      banner.classList.add("hidden");
      return;
    }
    var level = res.streak / 7;
    var badge = badgeForLevel(level);
    banner.innerHTML = "🎉 Chúc mừng! Bạn vừa đạt chuỗi <b>" + res.streak + " ngày liên tiếp</b> và nhận huy hiệu " +
      '<span class="badge-chip">' + badge.icon + " " + escapeHtml(badge.label) + "</span>";
    banner.classList.remove("hidden");
    streakCelebratedThisVisit = true;
  }

  // ---------- Tiến độ theo từng chương của Lớp đang chọn + gợi ý nên ôn chương nào ----------
  // Chỉ vẽ lại từ dữ liệu đã có (dùng khi đổi Lớp, không cần gọi lại API vì dữ liệu đã có đủ mọi chương)
  function renderChapterProgress() {
    var box = $("#chapter-progress-box");
    if (!box) return;
    if (!manifest || !lastChapterProgressData) { box.classList.add("hidden"); return; }
    var g = currentGradeObj();
    if (!g) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    $("#chapter-progress-title").textContent = "📊 Tiến độ " + g.name;

    var progressByChapter = {};
    lastChapterProgressData.chapters.forEach(function (p) { progressByChapter[p.chapter] = p; });

    var rows = g.chapters.map(function (c) {
      var p = progressByChapter[c.id] || { uniqueDone: 0, wrongCount: 0 };
      var percentDone = c.count > 0 ? Math.min(100, Math.round((p.uniqueDone / c.count) * 100)) : 0;
      return { id: c.id, name: c.name, percentDone: percentDone, uniqueDone: p.uniqueDone, wrongCount: p.wrongCount };
    });

    var listEl = $("#chapter-progress-list");
    listEl.innerHTML = "";
    rows.forEach(function (r) {
      var li = el("li", "chprog-item");
      li.innerHTML =
        '<span class="chprog-name">' + escapeHtml(r.name) +
        (r.wrongCount > 0 ? ' <span class="chprog-wrong-badge">' + r.wrongCount + ' câu sai</span>' : '') + '</span>' +
        '<span class="chprog-bar-wrap"><span class="chprog-bar" style="width:' + r.percentDone + '%"></span></span>' +
        '<span class="chprog-pct">' + r.percentDone + '%</span>';
      listEl.appendChild(li);
    });

    // Gợi ý: ưu tiên chương còn nhiều câu sai nhất; nếu không có câu nào sai thì gợi ý chương làm ít/chưa làm nhất.
    var suggestEl = $("#chapter-progress-suggest");
    var withWrong = rows.filter(function (r) { return r.wrongCount > 0; })
      .sort(function (a, b) { return b.wrongCount - a.wrongCount; });
    var notDone = rows.filter(function (r) { return r.percentDone < 100; })
      .sort(function (a, b) { return a.percentDone - b.percentDone || a.uniqueDone - b.uniqueDone; });
    if (withWrong.length) {
      suggestEl.innerHTML = "🔁 Nên ôn lại: <b>" + escapeHtml(withWrong[0].name) + "</b> — còn " + withWrong[0].wrongCount + " câu đang sai";
    } else if (notDone.length) {
      suggestEl.innerHTML = "▶️ Nên bắt đầu/tiếp tục: <b>" + escapeHtml(notDone[0].name) + "</b> — mới làm " + notDone[0].percentDone + "%";
    } else {
      suggestEl.innerHTML = "🎉 Bạn đã ôn gần đủ các chương " + escapeHtml(g.name) + " rồi, tiếp tục duy trì phong độ nhé!";
    }
  }

  // ---------- Gộp 3 API (stats + streak + tiến độ theo chương) thành 1 lượt gọi cho nhanh ----------
  // Trước đây xác minh PIN xong hoặc nộp bài xong phải gọi riêng 3 lần (mỗi lần backend tự quét lại
  // toàn bộ tab KetQua từ đầu) khiến trang tải chậm. Giờ gộp lại còn 1 lượt gọi action "profile".
  // Trả về 1 Promise (resolve ra dữ liệu profile, hoặc null nếu chưa xác minh/không lấy được).
  function refreshProfile() {
    var name = $("#inp-name").value.trim();
    var chap = currentChapterId();
    var cpBox = $("#chapter-progress-box");
    if (!API_URL || !pinVerified || !name) {
      currentStats = null; renderStats();
      renderStreak(null);
      lastChapterProgressData = null;
      if (cpBox) cpBox.classList.add("hidden");
      return Promise.resolve(null);
    }
    return apiGet({ action: "profile", name: name, chapter: chap, pin: currentPin() }).then(function (res) {
      if (!res || res.error) {
        currentStats = null; renderStats();
        renderStreak(null);
        lastChapterProgressData = null;
        if (cpBox) cpBox.classList.add("hidden");
        return null;
      }
      currentStats = res.stats || null;
      renderStats();
      renderStreak(res.streak);
      lastChapterProgressData = res.chapterProgress || null;
      renderChapterProgress();
      return res;
    });
  }

  // ---------- Mã bảo vệ tên (chống mạo danh) ----------
  function currentPin() { return $("#inp-pin").value.trim(); }

  function maybeVerifyPin() {
    var name = $("#inp-name").value.trim();
    var pin = currentPin();
    var msgEl = $("#pin-msg");
    if (!API_URL) {
      // chưa nối backend (đang test cục bộ) -> bỏ qua bước xác minh để không chặn phát triển/thử nghiệm
      pinVerified = true;
      msgEl.textContent = "";
      msgEl.className = "msg";
      validateStart();
      return;
    }
    if (!name || !/^\d{4}$/.test(pin)) {
      pinVerified = false;
      msgEl.textContent = "";
      msgEl.className = "msg";
      validateStart();
      return;
    }
    var myToken = ++pinCheckToken;
    pinVerified = false;
    msgEl.textContent = "Đang kiểm tra mã...";
    msgEl.className = "msg";
    validateStart();
    apiPost({ action: "verifyName", name: name, pin: pin }).then(function (res) {
      if (myToken !== pinCheckToken) return; // đã có lần kiểm tra mới hơn, bỏ qua kết quả cũ này
      if (res && res.ok) {
        pinVerified = true;
        msgEl.textContent = res.isNew
          ? "✔ Đã đặt mã bảo vệ mới cho tên này — nhớ mã để dùng lại cho lần sau."
          : "✔ Mã đúng, chào mừng quay lại!";
        msgEl.className = "msg pin-ok";
        refreshProfile();
      } else {
        pinVerified = false;
        msgEl.textContent = (res && res.error === "wrong_pin")
          ? "✘ Sai mã cho tên này. Nếu đây là tên của em, hãy nhập đúng mã cũ. Nếu trùng tên bạn khác, hãy đổi cách viết tên (ví dụ thêm tên lớp)."
          : "✘ Không xác minh được, thử lại.";
        msgEl.className = "msg pin-err";
      }
      validateStart();
      refreshDuelControls();
    });
  }

  function debouncedMaybeVerifyPin() {
    clearTimeout(pinDebounceTimer);
    pinDebounceTimer = setTimeout(maybeVerifyPin, 400);
  }

  function refreshExtraQuestions() {
    var chap = currentChapterId();
    if (!chap) { extraQuestions = []; refreshCountOptions(); return; }
    apiGet({ action: "extra", chapter: chap }).then(function (res) {
      extraQuestions = (res && res.questions) || [];
      refreshCountOptions();
      refreshDuelControls();
    });
  }

  function onChapterChange() {
    refreshExtraQuestions();
    refreshStats();
  }

  function validateStart() {
    var name = $("#inp-name").value.trim();
    var pin = currentPin();
    var pinOk = !API_URL || (/^\d{4}$/.test(pin) && pinVerified);
    var ok = name.length > 0 && pinOk && !!currentChapterId() && !!selectedCount;
    $("#btn-start").disabled = !ok;
  }

  // ---------- Quiz screen ----------
  function buildQuizQuestions() {
    var pool = staticQuestions.concat(extraQuestions);
    var wrongSet = {};
    if (currentStats && currentStats.wrongIds) {
      currentStats.wrongIds.forEach(function (id) { wrongSet[id] = true; });
    }
    var wrongPool = shuffle(pool.filter(function (q) { return wrongSet[q.id]; }));
    var restPool = shuffle(pool.filter(function (q) { return !wrongSet[q.id]; }));
    var selected = wrongPool.slice(0, selectedCount);
    if (selected.length < selectedCount) {
      selected = selected.concat(restPool.slice(0, selectedCount - selected.length));
    }
    return shuffle(selected);
  }

  function startQuiz() {
    var mode = document.querySelector('input[name="mode"]:checked').value;
    runQuiz(buildQuizQuestions(), mode);
  }

  function runQuiz(questionList, mode) {
    quiz = {
      questions: shuffle(questionList),
      index: 0,
      mode: mode,
      answers: []
    };
    show("#screen-quiz");
    renderQuestion();
  }

  function renderQuestion() {
    var q = quiz.questions[quiz.index];
    $("#quiz-progress").textContent = "Câu " + (quiz.index + 1) + "/" + quiz.questions.length;
    $("#progress-bar").style.width = Math.round((quiz.index / quiz.questions.length) * 100) + "%";
    $("#q-stem").innerHTML = q.stem;
    var optsBox = $("#q-options");
    optsBox.innerHTML = "";
    $("#q-feedback").className = "q-feedback hidden";
    quiz.answered = false;
    quiz.selectedLetter = null;
    $("#btn-next").classList.remove("hidden"); // phòng trường hợp trước đó vừa ở chế độ Đối đầu (nút này bị ẩn đi)
    $("#btn-next").disabled = true;
    $("#btn-next").textContent = "Gửi đáp án";
    resetReportUI();

    ["A", "B", "C", "D"].forEach(function (letter) {
      var b = el("button", "opt-btn");
      b.innerHTML = '<span class="opt-label">' + letter + '</span><span>' + q.options[letter] + '</span>';
      b.addEventListener("click", function () { selectOption(letter, b); });
      optsBox.appendChild(b);
    });
  }

  // Chọn / đổi đáp án — chưa ghi nhận, học sinh có thể bấm lại đáp án khác thoải mái.
  function selectOption(letter, btnEl) {
    if (quiz.answered) return;
    quiz.selectedLetter = letter;
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) {
      b.classList.remove("selected");
    });
    btnEl.classList.add("selected");
    $("#btn-next").disabled = false;
  }

  // Ghi nhận đáp án đã chọn (bấm nút "Gửi đáp án") — sau bước này mới tính điểm và khoá lựa chọn.
  function confirmAnswer() {
    quiz.answered = true;
    var q = quiz.questions[quiz.index];
    var letter = quiz.selectedLetter;
    var correct = letter === q.answer;
    quiz.answers.push({ id: q.id, correct: correct });

    var allBtns = document.querySelectorAll("#q-options .opt-btn");
    allBtns.forEach(function (b) { b.disabled = true; });

    if (quiz.mode === "hien_ngay") {
      allBtns.forEach(function (b, i) {
        var L = ["A", "B", "C", "D"][i];
        if (L === q.answer) b.classList.add("correct");
        else if (L === letter) b.classList.add("wrong");
      });
      var fb = $("#q-feedback");
      fb.classList.remove("hidden");
      if (correct) { fb.textContent = "✔ Chính xác!"; fb.classList.add("correct"); }
      else { fb.textContent = "✘ Sai rồi. Đáp án đúng là " + q.answer + "."; fb.classList.add("wrong"); }
    }
    $("#btn-next").textContent = (quiz.index === quiz.questions.length - 1) ? "Nộp bài" : "Câu tiếp theo";
  }

  // Nút dưới cùng dùng chung 2 việc: lần bấm đầu = ghi nhận đáp án, lần bấm sau = sang câu tiếp theo.
  function handleNextClick() {
    if (!quiz.answered) {
      if (quiz.selectedLetter) confirmAnswer();
      return;
    }
    nextQuestion();
  }

  // ---------- Báo lỗi câu hỏi ----------
  function resetReportUI() {
    $("#report-panel").classList.add("hidden");
    $("#report-note").value = "";
    $("#report-sent-msg").classList.add("hidden");
    var btn = $("#btn-report-send");
    btn.disabled = false;
    btn.textContent = "Gửi báo lỗi";
    $("#btn-report").classList.remove("hidden");
  }
  function toggleReportPanel() {
    var panel = $("#report-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) $("#report-note").focus();
  }
  function hideReportPanel() {
    $("#report-panel").classList.add("hidden");
    $("#report-note").value = "";
  }
  function sendReport() {
    var q = quiz.questions[quiz.index];
    var name = $("#inp-name").value.trim();
    var chap = currentChapterId();
    var note = $("#report-note").value.trim();
    var btn = $("#btn-report-send");
    btn.disabled = true;
    btn.textContent = "Đang gửi...";
    apiPost({
      action: "reportError",
      name: name,
      chapter: chap,
      questionId: q.id,
      stem: q.stem,
      note: note
    }).then(function () {
      hideReportPanel();
      btn.disabled = false;
      btn.textContent = "Gửi báo lỗi";
      $("#btn-report").classList.add("hidden");
      $("#report-sent-msg").classList.remove("hidden");
    });
  }

  // ---------- Bảng xếp hạng ----------
  function refreshLeaderboard() {
    if (!API_URL) {
      renderLeaderboardList("#leaderboard-list", "#leaderboard-empty", null, "score");
      renderLeaderboardList("#leaderboard-active-list", "#leaderboard-active-empty", null, "count");
      $("#leaderboard-offline").classList.remove("hidden");
      $("#leaderboard-active-offline").classList.remove("hidden");
      return;
    }
    $("#leaderboard-offline").classList.add("hidden");
    $("#leaderboard-active-offline").classList.add("hidden");
    apiGet({ action: "leaderboard" }).then(function (res) {
      lastLeaderboardData = res || null;
      renderLeaderboard(lastLeaderboardData);
    });
  }
  // Chỉ vẽ lại giao diện từ dữ liệu đã có (dùng khi gõ tên, để tô đậm "của em" mà không gọi lại API)
  function renderLeaderboard(res) {
    renderLeaderboardList("#leaderboard-list", "#leaderboard-empty", res && res.leaderboard, "score");
    renderLeaderboardList("#leaderboard-active-list", "#leaderboard-active-empty", res && res.mostActive, "count");
  }
  function renderLeaderboardList(listSel, emptySel, list, kind) {
    var listEl = $(listSel);
    var emptyEl = $(emptySel);
    if (!API_URL) return; // ô "offline" tương ứng đã tự hiển thị trong refreshLeaderboard()
    if (!list || !list.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    var myKey = $("#inp-name").value.trim().toLowerCase();
    var medals = ["🥇", "🥈", "🥉"];
    listEl.innerHTML = "";
    list.forEach(function (item, i) {
      var isMe = myKey && String(item.name || "").trim().toLowerCase() === myKey;
      var li = el("li", "lb-item" + (isMe ? " me" : ""));
      var scoreHtml = kind === "count" ? item.totalDone + " câu"
        : kind === "duel" ? item.wins + " thắng"
        : item.score + "%";
      li.innerHTML =
        '<span class="lb-rank">' + (medals[i] || (i + 1)) + '</span>' +
        '<span class="lb-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="lb-score">' + scoreHtml + '</span>';
      listEl.appendChild(li);
    });
  }
  function startLeaderboardPolling() {
    refreshLeaderboard();
    refreshDuelLeaderboard();
    setInterval(function () {
      if (document.visibilityState === "visible") { refreshLeaderboard(); refreshDuelLeaderboard(); }
    }, 20000);
  }

  function nextQuestion() {
    if (quiz.index < quiz.questions.length - 1) {
      quiz.index++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  function finishQuiz() {
    var name = $("#inp-name").value.trim();
    var chap = currentChapterId();
    var correctCount = quiz.answers.filter(function (a) { return a.correct; }).length;
    var badgeBanner = $("#result-badge");
    if (badgeBanner) badgeBanner.classList.add("hidden"); // xoá banner của lần trước, tránh nháy nội dung cũ

    var resultStatsBox = $("#result-stats");
    resultStatsBox.classList.remove("hidden");
    resultStatsBox.innerHTML = "Đang cập nhật tiến độ...";

    apiPost({
      action: "submit",
      name: name,
      chapter: chap,
      pin: currentPin(),
      mode: quiz.mode,
      results: quiz.answers
    }).then(function () {
      refreshLeaderboard(); // "ngay khi có sự thay đổi" cho chính học sinh vừa nộp bài
      // Gộp 3 API (stats + streak + tiến độ theo chương) thành 1 lượt gọi duy nhất cho nhanh,
      // và dùng luôn kết quả này để cập nhật ô "tiến độ" ở màn hình kết quả bên dưới.
      refreshProfile().then(function (res) {
        if (!res) {
          resultStatsBox.classList.add("hidden");
          resultStatsBox.innerHTML = "";
          return;
        }
        showBadgeCelebrationIfAny(res.streak); // cập nhật luôn ô "Chuỗi luyện tập" cho lần quay lại + banner chúc mừng
        var statRes = res.stats;
        if (!statRes || !statRes.attempts) {
          resultStatsBox.classList.add("hidden");
          resultStatsBox.innerHTML = "";
          return;
        }
        var last5b = statRes.last5 || [];
        resultStatsBox.innerHTML =
          "Tổng số câu đã làm ở chương này: <b>" + statRes.totalDone + "</b><br>" +
          "Tỉ lệ đúng " + last5b.length + " lần gần nhất: <b>" +
          last5b.map(function (p) { return p + "%"; }).join(" · ") + "</b>";
      });
    });

    // Câu hỏi (đối tượng đầy đủ) mà học sinh vừa làm sai, để có thể "Làm lại những câu sai"
    var wrongIdSet = {};
    quiz.answers.forEach(function (a) { if (!a.correct) wrongIdSet[a.id] = true; });
    var wrongQuestionObjs = quiz.questions.filter(function (q) { return wrongIdSet[q.id]; });
    var quizModeForRetry = quiz.mode;

    show("#screen-result");
    var pct = Math.round((correctCount / quiz.answers.length) * 100);
    $("#result-score").innerHTML = correctCount + " / " + quiz.answers.length +
      '<span class="sub">' + pct + "% chính xác</span>";

    var grid = $("#result-grid");
    grid.innerHTML = "";
    quiz.answers.forEach(function (a, i) {
      var d = el("div", a.correct ? "ok" : "no", a.correct ? "✓" : "✗");
      d.title = "Câu " + (i + 1);
      grid.appendChild(d);
    });

    var retryBtn = $("#btn-retry-wrong");
    if (wrongQuestionObjs.length > 0) {
      retryBtn.classList.remove("hidden");
      retryBtn.textContent = "Làm lại " + wrongQuestionObjs.length + " câu sai";
      retryBtn.onclick = function () { runQuiz(wrongQuestionObjs, quizModeForRetry); };
    } else {
      retryBtn.classList.add("hidden");
    }

  }

  // ---------- Chế độ Đối đầu 1vs1: tiện ích chung ----------
  function formatMMSS(totalSeconds) {
    var s = Math.max(0, Math.round(totalSeconds));
    var m = Math.floor(s / 60);
    var ss = s % 60;
    return m + ":" + (ss < 10 ? "0" : "") + ss;
  }
  // Đổi 1 chuỗi "yyyy-MM-dd HH:mm:ss" (giờ Việt Nam, do server trả về) thành mốc UTC tuyệt đối (ms) —
  // tương tự parseVNDateTimeMs_ ở backend, cần cho đồng hồ đếm ngược 5 phút dùng chung mốc với server.
  function parseVNDateTimeMsClient(s) {
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return Date.now();
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 7 * 60 * 60 * 1000;
  }
  function buildDuelQuestionIds() {
    var pool = shuffle(staticQuestions.concat(extraQuestions));
    return pool.slice(0, DUEL_QUESTION_COUNT).map(function (q) { return q.id; });
  }
  function clearDuelTimers() {
    clearInterval(duelWaitTickTimer); duelWaitTickTimer = null;
    clearInterval(duelWaitPollTimer); duelWaitPollTimer = null;
    clearInterval(duelPickPollTimer); duelPickPollTimer = null;
    clearInterval(duelQuizTickTimer); duelQuizTickTimer = null;
    clearInterval(duelResultPollTimer); duelResultPollTimer = null;
  }

  // ---------- Đối đầu: bước 1 (người thách đấu) — tạo lời thách + phòng chờ 60s ----------
  function startChallenge() {
    var name = $("#inp-name").value.trim();
    var pin = currentPin();
    var chapObj = currentChapterObj();
    if (!name || !pinVerified || !chapObj) return;
    if (staticQuestions.length + extraQuestions.length < DUEL_QUESTION_COUNT) return;
    var questionIds = buildDuelQuestionIds();
    $("#btn-challenge").disabled = true;
    $("#duel-msg").textContent = "Đang tạo lời thách đấu...";
    apiPost({
      action: "createChallenge", name: name, pin: pin,
      chapter: chapObj.id, chapterName: chapObj.name, questionIds: questionIds
    }).then(function (res) {
      $("#btn-challenge").disabled = false;
      if (!res || !res.ok) {
        $("#duel-msg").textContent = "Không tạo được lời thách đấu, thử lại nhé.";
        return;
      }
      $("#duel-msg").textContent = "";
      duelMatchId = res.matchId;
      openDuelWaitScreen(chapObj.name);
    });
  }

  function openDuelWaitScreen(chapterName) {
    clearDuelTimers();
    $("#duel-wait-chapter").textContent = chapterName || "";
    duelWaitDeadlineMs = Date.now() + DUEL_WAIT_SECONDS * 1000;
    updateDuelWaitTimerDisplay();
    show("#screen-duel-wait");
    duelWaitTickTimer = setInterval(updateDuelWaitTimerDisplay, 1000);
    duelWaitPollTimer = setInterval(pollChallengeStatus, 2000);
    pollChallengeStatus();
  }
  function updateDuelWaitTimerDisplay() {
    var remain = Math.max(0, Math.round((duelWaitDeadlineMs - Date.now()) / 1000));
    var el2 = $("#duel-wait-timer");
    if (el2) el2.textContent = String(remain);
  }
  function pollChallengeStatus() {
    if (!duelMatchId) return;
    apiGet({ action: "challengeStatus", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentPin() })
      .then(function (res) {
        if (!res || !duelMatchId) return; // đã hủy/thoát trong lúc chờ phản hồi
        if (res.status === "matched") {
          clearDuelTimers();
          enterDuelQuiz(res.chapter, res.chapterName, res.questionIds, res.opponent, res.startTime);
        } else if (res.status === "expired" || res.status === "not_found") {
          clearDuelTimers();
          duelMatchId = null;
          show("#screen-setup");
          $("#duel-msg").textContent = "Không có ai nhận thử thách trong 1 phút, thử lại nhé!";
        }
      });
  }
  function cancelDuelWait() {
    var mid = duelMatchId;
    clearDuelTimers();
    duelMatchId = null;
    show("#screen-setup");
    if (mid) apiPost({ action: "cancelChallenge", matchId: mid, name: $("#inp-name").value.trim(), pin: currentPin() });
  }

  // ---------- Đối đầu: bước 1 (người đồng ý thử thách) — chọn 1 lời thách đang chờ để vào đấu ----------
  function openAcceptChallengeScreen() {
    clearDuelTimers();
    $("#duel-pick-msg").textContent = "";
    show("#screen-duel-pick");
    refreshChallengeList();
    duelPickPollTimer = setInterval(refreshChallengeList, 3000);
  }
  function refreshChallengeList() {
    apiGet({ action: "listChallenges", name: $("#inp-name").value.trim(), pin: currentPin() }).then(function (res) {
      var listEl = $("#duel-pick-list");
      var emptyEl = $("#duel-pick-empty");
      var challenges = (res && res.challenges) || [];
      if (!challenges.length) { listEl.innerHTML = ""; emptyEl.classList.remove("hidden"); return; }
      emptyEl.classList.add("hidden");
      listEl.innerHTML = "";
      challenges.forEach(function (c) {
        var li = el("li", "duel-pick-item");
        var info = el("div", "duel-pick-info");
        info.innerHTML =
          '<div class="duel-pick-name">' + escapeHtml(c.challenger) + '</div>' +
          '<div class="duel-pick-chapter">' + escapeHtml(c.chapterName || c.chapter) + '</div>' +
          '<div class="duel-pick-timer">còn ' + c.secondsLeft + 's</div>';
        var btn = el("button", "btn-duel-join", "Vào đấu");
        btn.type = "button";
        btn.addEventListener("click", function () { acceptChallengeClick(c.matchId, btn); });
        li.appendChild(info);
        li.appendChild(btn);
        listEl.appendChild(li);
      });
    });
  }
  function acceptChallengeClick(matchId, btnEl) {
    btnEl.disabled = true;
    apiPost({ action: "acceptChallenge", matchId: matchId, name: $("#inp-name").value.trim(), pin: currentPin() })
      .then(function (res) {
        if (!res || !res.ok) {
          $("#duel-pick-msg").textContent = (res && res.error === "already_taken")
            ? "Bạn khác vừa nhận lời thách này rồi, chọn người khác nhé."
            : "Không vào được trận này (có thể đã hết hạn), thử lại nhé.";
          refreshChallengeList();
          if (btnEl) btnEl.disabled = false;
          return;
        }
        $("#duel-pick-msg").textContent = "";
        clearDuelTimers();
        duelMatchId = matchId;
        enterDuelQuiz(res.chapter, res.chapterName, res.questionIds, res.opponent, res.startTime);
      });
  }

  // ---------- Đối đầu: bước 2 — cả 2 học sinh vào làm bài (10 câu, tối đa 5 phút) ----------
  function enterDuelQuiz(chapter, chapterName, questionIds, opponent, startTimeStr) {
    duelOpponentName = opponent;
    duelQuizStartMs = parseVNDateTimeMsClient(startTimeStr);
    Promise.all([
      loadStaticQuestions(chapter).catch(function () { return []; }),
      apiGet({ action: "extra", chapter: chapter })
    ]).then(function (results) {
      var staticQs = results[0] || [];
      var extraRes = results[1];
      var pool = staticQs.concat((extraRes && extraRes.questions) || []);
      var byId = {};
      pool.forEach(function (q) { byId[q.id] = q; });
      var duelQuestions = questionIds.map(function (id) { return byId[id]; }).filter(Boolean);
      runDuelQuiz(duelQuestions, chapter, chapterName);
    });
  }

  function runDuelQuiz(questions, chapter, chapterName) {
    if (!questions.length) {
      show("#screen-setup");
      $("#duel-msg").textContent = "Không tải được câu hỏi cho trận này, thử thách đấu lại nhé.";
      return;
    }
    quiz = {
      questions: shuffle(questions),
      index: 0,
      isDuel: true,
      chapter: chapter,
      chapterName: chapterName,
      answers: [],
      locked: false,
      finished: false
    };
    show("#screen-quiz");
    $("#duel-timer-box").classList.remove("hidden");
    updateDuelQuizTimerDisplay();
    duelQuizTickTimer = setInterval(updateDuelQuizTimerDisplay, 500);
    renderDuelQuestion();
  }

  function updateDuelQuizTimerDisplay() {
    var remain = DUEL_TIME_LIMIT_SECONDS - Math.round((Date.now() - duelQuizStartMs) / 1000);
    var box = $("#duel-timer-box");
    var txt = $("#duel-timer-text");
    if (txt) txt.textContent = formatMMSS(Math.max(0, remain));
    if (box) box.classList.toggle("urgent", remain <= 30);
    if (remain <= 0 && quiz && quiz.isDuel && !quiz.finished) {
      clearInterval(duelQuizTickTimer); duelQuizTickTimer = null;
      finishDuelQuiz();
    }
  }

  function renderDuelQuestion() {
    var q = quiz.questions[quiz.index];
    $("#quiz-progress").textContent = "⚔️ Câu " + (quiz.index + 1) + "/" + quiz.questions.length;
    $("#progress-bar").style.width = Math.round((quiz.index / quiz.questions.length) * 100) + "%";
    $("#q-stem").innerHTML = q.stem;
    var optsBox = $("#q-options");
    optsBox.innerHTML = "";
    $("#q-feedback").className = "q-feedback hidden";
    $("#btn-report").classList.add("hidden"); // đối đầu: bỏ bớt báo lỗi để tập trung tốc độ, giáo viên vẫn nhận báo lỗi ở chế độ tự luyện
    $("#btn-next").classList.add("hidden");   // đối đầu: bấm đáp án là qua câu luôn, không cần nút xác nhận riêng
    quiz.locked = false;
    ["A", "B", "C", "D"].forEach(function (letter) {
      var b = el("button", "opt-btn");
      b.innerHTML = '<span class="opt-label">' + letter + '</span><span>' + q.options[letter] + '</span>';
      b.addEventListener("click", function () { selectDuelOption(letter, b); });
      optsBox.appendChild(b);
    });
  }
  function selectDuelOption(letter, btnEl) {
    if (quiz.locked) return;
    quiz.locked = true;
    var q = quiz.questions[quiz.index];
    var correct = letter === q.answer;
    quiz.answers.push({ id: q.id, correct: correct });
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) { b.disabled = true; });
    btnEl.classList.add("selected");
    setTimeout(function () {
      if (!quiz || !quiz.isDuel || quiz.finished) return; // đã hết giờ / thoát trong lúc chờ
      if (quiz.index < quiz.questions.length - 1) {
        quiz.index++;
        renderDuelQuestion();
      } else {
        finishDuelQuiz();
      }
    }, 200);
  }

  // ---------- Đối đầu: bước 3 — nộp kết quả, chờ đối thủ, hiện thắng/thua/hòa ----------
  function finishDuelQuiz() {
    if (!quiz || !quiz.isDuel || quiz.finished) return;
    quiz.finished = true;
    clearInterval(duelQuizTickTimer); duelQuizTickTimer = null;
    $("#duel-timer-box").classList.add("hidden");
    var name = $("#inp-name").value.trim();
    var elapsedSeconds = Math.min(DUEL_TIME_LIMIT_SECONDS, Math.round((Date.now() - duelQuizStartMs) / 1000));
    show("#screen-duel-result");
    renderDuelWaitingState();
    apiPost({
      action: "submitChallengeResult", matchId: duelMatchId, name: name, pin: currentPin(),
      results: quiz.answers, elapsedSeconds: elapsedSeconds
    }).then(function (res) {
      if (!res || !res.ok) {
        $("#duel-waiting-opponent").textContent = "Có lỗi khi nộp kết quả, thử tải lại trang.";
        $("#duel-waiting-opponent").classList.remove("hidden");
        return;
      }
      renderDuelResult(res);
      if (res.status !== "xong") {
        duelResultPollTimer = setInterval(pollDuelResult, 2500);
      } else {
        onDuelFinished();
      }
    });
  }
  function renderDuelWaitingState() {
    var name = $("#inp-name").value.trim();
    $("#duel-you-name").textContent = name + " (em)";
    $("#duel-opp-name").textContent = duelOpponentName || "Đối thủ";
    $("#duel-you-score").textContent = "…";
    $("#duel-you-time").textContent = "";
    $("#duel-opp-score").textContent = "…";
    $("#duel-opp-time").textContent = "";
    $("#duel-result-banner").classList.add("hidden");
    var waitBox = $("#duel-waiting-opponent");
    waitBox.textContent = "Đang nộp bài...";
    waitBox.classList.remove("hidden");
  }
  function pollDuelResult() {
    if (!duelMatchId) return;
    apiGet({ action: "challengeResult", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentPin() })
      .then(function (res) {
        if (!res || !res.ok) return;
        renderDuelResult(res);
        if (res.status === "xong") {
          clearInterval(duelResultPollTimer); duelResultPollTimer = null;
          onDuelFinished();
        }
      });
  }
  function renderDuelResult(res) {
    var name = $("#inp-name").value.trim();
    $("#duel-you-name").textContent = name + " (em)";
    $("#duel-opp-name").textContent = (res.opponent && res.opponent.name) || duelOpponentName || "Đối thủ";
    $("#duel-you-score").textContent = res.you.correct == null ? "…" : res.you.correct + "/" + DUEL_QUESTION_COUNT + " đúng";
    $("#duel-you-time").textContent = res.you.timeSec == null ? "" : "⏱ " + formatMMSS(res.you.timeSec);
    var banner = $("#duel-result-banner");
    var waitBox = $("#duel-waiting-opponent");
    if (res.status !== "xong") {
      $("#duel-opp-score").textContent = "Đang làm bài...";
      $("#duel-opp-time").textContent = "";
      waitBox.textContent = "Đang chờ đối thủ hoàn thành bài làm...";
      waitBox.classList.remove("hidden");
      banner.classList.add("hidden");
      return;
    }
    waitBox.classList.add("hidden");
    $("#duel-opp-score").textContent = (res.opponent.correct == null ? "–" : res.opponent.correct + "/" + DUEL_QUESTION_COUNT + " đúng");
    $("#duel-opp-time").textContent = res.opponent.timeSec == null ? "" : "⏱ " + formatMMSS(res.opponent.timeSec);
    banner.classList.remove("hidden");
    if (res.outcome === "thang") { banner.textContent = "🏆 Em đã THẮNG!"; banner.className = "duel-result-banner win"; }
    else if (res.outcome === "thua") { banner.textContent = "😅 Em thua lần này, cố lên nhé!"; banner.className = "duel-result-banner lose"; }
    else { banner.textContent = "🤝 Hòa!"; banner.className = "duel-result-banner draw"; }
  }
  function onDuelFinished() {
    refreshLeaderboard();
    refreshDuelLeaderboard();
    refreshProfile(); // trận đấu cũng tính vào chuỗi ngày + tiến độ chương, cập nhật lại cho lần quay về màn hình chính
  }
  function exitDuelResult() {
    clearDuelTimers();
    duelMatchId = null;
    duelOpponentName = null;
    show("#screen-setup");
  }

  // ---------- Bảng 1vs1 (số trận thắng) ----------
  function refreshDuelLeaderboard() {
    if (!API_URL) {
      renderLeaderboardList("#leaderboard-duel-list", "#leaderboard-duel-empty", null, "duel");
      $("#leaderboard-duel-offline").classList.remove("hidden");
      return;
    }
    $("#leaderboard-duel-offline").classList.add("hidden");
    apiGet({ action: "duelLeaderboard" }).then(function (res) {
      lastDuelLeaderboardData = res || null;
      renderLeaderboardList("#leaderboard-duel-list", "#leaderboard-duel-empty", res && res.leaderboard, "duel");
    });
  }

  // ---------- Init ----------
  function init() {
    startLeaderboardPolling();

    fetch("data/manifest.json").then(function (r) { return r.json(); }).then(function (m) {
      manifest = m;
      populateGrades();
      populateChapters();

      var savedName = localStorage.getItem("hs_ten");
      if (savedName) $("#inp-name").value = savedName;
      var savedPin = localStorage.getItem("hs_pin");
      if (savedPin) $("#inp-pin").value = savedPin;
      if (savedName && savedPin) maybeVerifyPin(); // tự xác minh luôn nếu trình duyệt đã nhớ từ lần trước

      loadStaticQuestions(currentChapterId()).then(function (qs) {
        staticQuestions = qs;
        onChapterChange();
      });

      $("#sel-grade").addEventListener("change", function () {
        populateChapters();
        renderChapterProgress(); // đã có sẵn dữ liệu mọi chương, chỉ cần vẽ lại theo Lớp mới, không cần gọi API lại
        loadStaticQuestions(currentChapterId()).then(function (qs) {
          staticQuestions = qs;
          onChapterChange();
        });
      });
      $("#sel-chapter").addEventListener("change", function () {
        loadStaticQuestions(currentChapterId()).then(function (qs) {
          staticQuestions = qs;
          onChapterChange();
        });
      });
      $("#inp-name").addEventListener("input", function () {
        localStorage.setItem("hs_ten", $("#inp-name").value.trim());
        pinVerified = false;
        $("#pin-msg").textContent = "";
        $("#pin-msg").className = "msg";
        validateStart();
        refreshDuelControls();
        renderLeaderboard(lastLeaderboardData); // chỉ để cập nhật highlight "của em", không gọi lại API
        debouncedMaybeVerifyPin();
      });
      $("#inp-pin").addEventListener("input", function () {
        var digits = $("#inp-pin").value.replace(/\D/g, "").slice(0, 4);
        $("#inp-pin").value = digits;
        localStorage.setItem("hs_pin", digits);
        pinVerified = false;
        validateStart();
        refreshDuelControls();
        debouncedMaybeVerifyPin();
      });

      if (!API_URL) {
        $("#setup-msg").textContent =
          "Lưu ý: chưa kết nối backend (config.js) nên chưa lưu được tiến độ và chưa có câu hỏi bổ sung.";
      }
    });

    $("#btn-start").addEventListener("click", startQuiz);
    $("#btn-next").addEventListener("click", handleNextClick);
    $("#btn-report").addEventListener("click", toggleReportPanel);
    $("#btn-report-cancel").addEventListener("click", hideReportPanel);
    $("#btn-report-send").addEventListener("click", sendReport);
    $("#btn-quit").addEventListener("click", function () {
      if (quiz && quiz.isDuel) {
        if (confirm("Thoát trận đối đầu? Kết quả các câu đã làm sẽ được nộp luôn, em có thể sẽ thua nếu chưa làm xong.")) {
          finishDuelQuiz();
        }
        return;
      }
      if (confirm("Thoát làm bài? Kết quả lần này sẽ không được lưu.")) show("#screen-setup");
    });
    $("#btn-restart").addEventListener("click", function () {
      show("#screen-setup");
      refreshExtraQuestions();
      refreshStats();
    });

    // ---- Chế độ Đối đầu 1vs1 ----
    $("#tab-mode-solo").addEventListener("click", function () { setAppMode("solo"); });
    $("#tab-mode-duel").addEventListener("click", function () { setAppMode("duel"); });
    $("#btn-challenge").addEventListener("click", startChallenge);
    $("#btn-accept-challenge").addEventListener("click", openAcceptChallengeScreen);
    $("#btn-cancel-wait").addEventListener("click", cancelDuelWait);
    $("#btn-pick-back").addEventListener("click", function () {
      clearDuelTimers();
      show("#screen-setup");
    });
    $("#btn-duel-restart").addEventListener("click", exitDuelResult);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
