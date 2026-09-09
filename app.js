(function () {
  "use strict";

  var API_URL = window.API_URL || "";

  // TẠM TẮT Bộ sưu tập thẻ bài (đang nghi ngờ góp phần vào cảm giác chậm chung — mỗi lần nộp bài/đối đầu
  // trước đây đều kèm vài lượt kiểm tra + có thể ghi thêm dòng thẻ mới, tất cả núp chung 1 khóa dùng
  // chung với các thao tác khác). Đổi lại thành true để bật lại tính năng — KHÔNG có gì bị xoá, chỉ tạm
  // ẩn nút "Bộ sưu tập" + ngừng gọi các API liên quan thẻ ở phía học sinh; toàn bộ dữ liệu thẻ đã trao
  // trước đó trong tab BoSuuTap vẫn còn nguyên trên Google Sheet.
  var CARDS_ENABLED = false;

  // ---------- State ----------
  var manifest = null;
  var staticQuestions = [];   // câu hỏi gốc của chương đang chọn
  var extraQuestions = [];    // câu hỏi bổ sung (Google Sheet) của chương đang chọn
  var currentStats = null;    // {totalDone, last5, wrongIds}
  var selectedCount = null;

  var quiz = null; // {questions, index, mode, answers:[{id,correct}]}
  var lastLeaderboardData = null; // cache dữ liệu bảng xếp hạng gần nhất, để tô đậm tên của em khi gõ tên
  var accessVerified = false; // tên (+ mã truy cập nếu có) hiện tại đã được backend xác nhận hợp lệ chưa
  var accessCheckToken = 0;   // chống việc phản hồi cũ (gõ nhanh) ghi đè kết quả của lần kiểm tra mới hơn
  var accessDebounceTimer = null;
  var currentTier = null;     // 'full' (có mã) | 'guest' (gõ tên suông) | null (chưa xác minh xong)
  var guestLimits = null;     // {maxAttemptsPerChapter, maxQuestions} — backend trả về khi currentTier==='guest'
  var ZALO_CONTACT_HTML = '<a href="https://zalo.me/0708681192" target="_blank" rel="noopener">0708 681 192</a>';
  var lastChapterProgressData = null; // {chapters:[{chapter,uniqueDone,wrongCount}]} - cache để vẽ lại khi đổi Lớp mà không cần gọi API lại
  var streakCelebratedThisVisit = false; // tránh hiện lại banner chúc mừng nhiều lần trong cùng 1 lượt ghé trang

  // ---------- Chế độ Đối đầu 1vs1 ----------
  var DUEL_QUESTION_COUNT = 10;
  var DUEL_WAIT_SECONDS = 60;
  var DUEL_ANSWER_TIMEOUT_MS = 20000; // mỗi câu chờ tối đa 20s, không ai bấm kịp thì tự bỏ qua (không ai được/mất điểm)
  var DUEL_POLL_MS = 1000;            // hỏi lại server ~1 giây/lần trong lúc thi đấu + oẳn tù tì
  var DUEL_RPS_LABELS = { keo: "✌️ Kéo", bua: "✊ Búa", bao: "✋ Bao" };
  var appMode = "solo";          // "solo" | "duel" — tab đang chọn ở màn hình chính
  var duelMatchId = null;
  var duelOpponentName = null;
  var duelWaitDeadlineMs = null; // mốc hết hạn phòng chờ (60s) — để vẽ đồng hồ đếm ngược
  var duelWaitTickTimer = null;  // interval vẽ lại đồng hồ đếm ngược phòng chờ mỗi giây
  var duelWaitPollTimer = null;  // interval hỏi lại server xem đã có ai ghép chưa
  var duelPickPollTimer = null;  // interval làm mới danh sách "chọn đối thủ"
  var duelPollTimer = null;      // interval hỏi lại server trong suốt lúc thi đấu (câu bị khóa chưa/oẳn tù tì tới đâu)
  var duelAnswerTimeoutTimer = null; // hẹn giờ 20s tự bỏ qua câu hiện tại nếu không ai bấm kịp
  var duelAnsweredLocally = false;   // đã bấm 1 đáp án cho câu hiện tại (đang chờ server xác nhận) hay chưa
  var duelPhase = null;          // "quiz" | "tie_break" | "done" — đang ở màn nào trong lúc thi đấu
  var duelYou = { score: 0, correct: 0, wrong: 0 };
  var duelOpp = { score: 0, correct: 0, wrong: 0, name: "" };
  var lastDuelLeaderboardData = null;
  var lastEloLeaderboardData = null;

  // ---------- Chế độ Ngẫu nhiên (18 câu cố định, chỉ hạng "full") ----------
  var RANDOM_TOTAL = 18;
  var RANDOM_L12_COUNT = 14;
  var RANDOM_L10_COUNT = 2;
  var RANDOM_L11_COUNT = 2;
  var chapterQuestionCache_ = {}; // chapterId -> Promise<questions[]>, tránh tải lại data/*.json nhiều lần
  var lastRandomLeaderboardData = null;
  var randomTimerInterval = null; // interval vẽ lại đồng hồ đếm ĐANG TĂNG dần trong lúc làm 18 câu
  var randomStartMs = null;       // mốc bắt đầu (Date.now()) — dùng để tính elapsedSec lúc nộp bài

  // ---------- Bộ sưu tập thẻ bài (KHÁC với huy hiệu chuỗi ngày ở trên) ----------
  var myCardIds = {};       // cardId -> thời gian đạt được (chuỗi), object rỗng nếu chưa xác minh/chưa có thẻ
  var cardToastQueue = [];  // hàng đợi các mã thẻ vừa nhận, hiện lần lượt từng cái 1 nếu nhận nhiều thẻ cùng lúc

  // ---------- Giải đấu WorldCup (loại trực tiếp) ----------
  var TOUR_QUESTION_COUNT = 10;
  var tourPollTimer = null;        // 1 interval DUY NHẤT dùng chung cho cả màn hub (đăng ký/sơ đồ nhánh) lẫn lúc thi đấu
  var tourMatchId = null;
  var tourOpponentName = null;
  var tourRound = null, tourTotalRounds = null;
  var tourAnsweredLocally = false;
  var tourAnswerTimeoutTimer = null;
  var tourYou = { score: 0, correct: 0, wrong: 0 };
  var tourOpp = { score: 0, correct: 0, wrong: 0, name: "" };
  var tourEnteringMatch = false;   // chống vào trận 2 lần cùng lúc trong lúc đang tải câu hỏi (bất đồng bộ)
  var tourPollToken = 0;           // chống lượt poll cũ (mạng chậm, tới trễ) ghi đè lên kết quả của lượt poll MỚI hơn —
                                    // ví dụ trận vừa xong (đã rời màn thi đấu) nhưng 1 lượt poll cũ của TRẬN ĐÓ vẫn còn
                                    // đang bay trên mạng lại về sau, nếu không chặn sẽ khiến bị "vào lại" trận đã xong.

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
  /** HTML thông báo tính năng bị khoá với khách (không có mã truy cập) — dùng chung cho Đối đầu 1vs1 và
   *  Giải đấu WorldCup, kèm luôn link Zalo để "quảng cáo" nhẹ nhàng theo đúng ý thầy. */
  function lockedFeatureHtml_(featureName) {
    return '🔒 <b>' + featureName + '</b> chỉ dành cho học sinh có <b>mã truy cập</b> (thầy gửi qua email ' +
      'khi đăng ký học). Liên hệ Zalo thầy ' + ZALO_CONTACT_HTML + ' để đăng ký nhận mã nhé!';
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

  // Bản có nhớ (cache) của loadStaticQuestions — Chế độ ngẫu nhiên cần tải câu hỏi của NHIỀU chương cùng
  // lúc (toàn bộ Lớp 10/11/12), nên cache lại theo chapterId để không tải lại data/*.json nếu học sinh bấm
  // "Bắt đầu làm bài" nhiều lần trong cùng 1 lượt ghé trang.
  function loadChapterQuestionsCached_(chapterId) {
    if (!chapterQuestionCache_[chapterId]) {
      chapterQuestionCache_[chapterId] = loadStaticQuestions(chapterId).catch(function () { return []; });
    }
    return chapterQuestionCache_[chapterId];
  }

  /** Học sinh khách (currentTier==='guest') đã dùng hết lượt free của CHƯƠNG ĐANG CHỌN chưa — dựa vào
   *  currentStats.attempts (số lượt đã nộp cho đúng chương này, backend đã tính sẵn). Ẩn hẳn khu vực chọn
   *  số câu + nút bắt đầu, thay bằng thông báo liên hệ Zalo nếu đã hết lượt — trả về true nếu đang bị chặn
   *  (để refreshCountOptions() khỏi vẽ chip số câu vô nghĩa). */
  function updateSoloGuestGate_() {
    var limitBox = $("#solo-guest-limit-msg");
    var normalBox = $("#solo-normal-controls");
    if (currentTier !== "guest") {
      limitBox.classList.add("hidden");
      normalBox.classList.remove("hidden");
      return false;
    }
    var limit = (guestLimits && guestLimits.maxAttemptsPerChapter) || 3;
    var used = (currentStats && currentStats.attempts) || 0;
    if (used >= limit) {
      normalBox.classList.add("hidden");
      limitBox.classList.remove("hidden");
      limitBox.className = "msg locked-feature-msg";
      limitBox.innerHTML = "😊 Em đã dùng hết " + limit + "/" + limit + " lượt luyện tập miễn phí cho chương " +
        "này rồi. Liên hệ Zalo thầy " + ZALO_CONTACT_HTML + " để đăng ký nhận mã truy cập, luyện tập không " +
        "giới hạn tất cả các chương nhé!";
      selectedCount = null;
      return true;
    }
    limitBox.classList.add("hidden");
    normalBox.classList.remove("hidden");
    return false;
  }

  function refreshCountOptions() {
    var box = $("#count-options");
    var noteEl = $("#guest-count-note");
    box.innerHTML = "";
    if (noteEl) noteEl.classList.add("hidden");
    var chap = currentChapterObj();
    if (!chap) return;
    if (updateSoloGuestGate_()) { validateStart(); return; }
    var total = chap.count + extraQuestions.length;

    if (currentTier === "guest") {
      // Khách: chỉ 1 lựa chọn cố định (mặc định 10 câu, hoặc ít hơn nếu chương chưa đủ 10 câu) — không
      // cho chọn số câu khác, đúng theo giới hạn "chỉ được chọn mục làm 10 câu" thầy yêu cầu.
      var guestN = Math.min((guestLimits && guestLimits.maxQuestions) || 10, total || 10);
      selectedCount = guestN;
      var bGuest = el("button", "selected", guestN + " câu");
      bGuest.type = "button";
      bGuest.disabled = true;
      box.appendChild(bGuest);
      if (noteEl) {
        var limit = (guestLimits && guestLimits.maxAttemptsPerChapter) || 3;
        var used = (currentStats && currentStats.attempts) || 0;
        noteEl.textContent = "Đang dùng thử (khách): đã dùng " + used + "/" + limit + " lượt cho chương này. " +
          "Có mã truy cập thì nhập ở trên để luyện tập không giới hạn nhé!";
        noteEl.classList.remove("hidden");
      }
      validateStart();
      return;
    }

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

  // ---------- Chuyển đổi Tự luyện tập / Đối đầu 1vs1 / Ngẫu nhiên ----------
  function setAppMode(mode) {
    appMode = mode;
    $("#tab-mode-solo").classList.toggle("selected", mode === "solo");
    $("#tab-mode-duel").classList.toggle("selected", mode === "duel");
    $("#tab-mode-random").classList.toggle("selected", mode === "random");
    $("#solo-panel").classList.toggle("hidden", mode !== "solo");
    $("#duel-panel").classList.toggle("hidden", mode !== "duel");
    $("#random-panel").classList.toggle("hidden", mode !== "random");
    $("#duel-msg").textContent = "";
    refreshDuelControls();
    refreshRandomControls();
  }

  // Bật/tắt nút "Bắt đầu làm bài" của Chế độ ngẫu nhiên tuỳ đã xác minh tên (+mã) hay chưa — chỉ hạng
  // "full" mới dùng được (khách thấy thông báo khoá tính năng, xem lockedFeatureHtml_), không phụ thuộc
  // chương/lớp đang chọn ở trên vì chế độ này tự chọn câu hỏi trên toàn bộ chương trình.
  function refreshRandomControls() {
    var btn = $("#btn-start-random");
    if (!btn) return;
    var lockedBox = $("#random-locked-msg");
    var normalBox = $("#random-normal-content");
    if (currentTier === "guest") {
      normalBox.classList.add("hidden");
      lockedBox.classList.remove("hidden");
      lockedBox.className = "msg locked-feature-msg";
      lockedBox.innerHTML = lockedFeatureHtml_("Chế độ ngẫu nhiên");
      return;
    }
    lockedBox.classList.add("hidden");
    normalBox.classList.remove("hidden");
    var name = $("#inp-name").value.trim();
    btn.disabled = !(!!API_URL && !!name && accessVerified && currentTier === "full" && !!manifest);
  }

  // Bật/tắt 2 nút "Thách thức" / "Đồng ý thử thách" tuỳ đã xác minh tên (+mã) và chương đủ ít nhất 10 câu
  // chưa. Đối đầu 1vs1 chỉ dành cho học sinh có mã (hạng "full") — khách thấy thông báo khoá tính năng
  // thay vì các nút này (xem lockedFeatureHtml_).
  function refreshDuelControls() {
    var btnChallenge = $("#btn-challenge");
    var btnAccept = $("#btn-accept-challenge");
    if (!btnChallenge || !btnAccept) return;
    var lockedBox = $("#duel-locked-msg");
    var normalBox = $("#duel-normal-content");
    if (currentTier === "guest") {
      normalBox.classList.add("hidden");
      lockedBox.classList.remove("hidden");
      lockedBox.className = "msg locked-feature-msg";
      lockedBox.innerHTML = lockedFeatureHtml_("Đối đầu 1vs1");
      return;
    }
    lockedBox.classList.add("hidden");
    normalBox.classList.remove("hidden");
    var name = $("#inp-name").value.trim();
    var readyBase = !!API_URL && !!name && accessVerified && currentTier === "full" && !!currentChapterId();
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
    if (!name || !chap || !accessVerified) { currentStats = null; renderStats(); return; }
    apiGet({ action: "stats", name: name, chapter: chap, pin: currentCode() }).then(function (res) {
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

  // ---------- Bộ sưu tập thẻ bài (mã thẻ PHẢI khớp CHÍNH XÁC với AppsScript_Code.gs phía backend) ----------
  // Icon + tên hiển thị cho 21 thẻ "Trọn Chương". Riêng L10_C1 dùng ảnh thật của Rutherford (người khám
  // phá ra hạt nhân nguyên tử) vì đúng chủ đề "Cấu tạo nguyên tử" của chương đó.
  var CHAPTER_CARD_INFO = {
    L10_C1: { name: "Chương 1. Cấu tạo nguyên tử", icon: "⚛️", photo: "assets/cards/rutherford.jpg", figure: "Ernest Rutherford (1871–1937)" },
    L10_C2: { name: "Chương 2. Bảng tuần hoàn các nguyên tố hóa học", icon: "🧩" },
    L10_C3: { name: "Chương 3. Liên kết hóa học", icon: "🔗" },
    L10_C4: { name: "Chương 4. Phản ứng oxi hóa - khử", icon: "⚡" },
    L10_C5: { name: "Chương 5. Năng lượng hóa học", icon: "🔥" },
    L10_C6: { name: "Chương 6. Tốc độ phản ứng hóa học", icon: "⏱️" },
    L10_C7: { name: "Chương 7. Nhóm Halogen", icon: "🧂" },
    L11_C1: { name: "Chương 1. Cân bằng hóa học", icon: "⚖️" },
    L11_C2: { name: "Chương 2. Nitrogen và Sulfur", icon: "💨" },
    L11_C3: { name: "Chương 3. Đại cương hóa học hữu cơ", icon: "🧬" },
    L11_C4: { name: "Chương 4. Hydrocarbon", icon: "⛽" },
    L11_C5: { name: "Chương 5. Alcohol - Phenol", icon: "🍷" },
    L11_C6: { name: "Chương 6. Hợp chất Carbonyl - Carboxylic acid", icon: "🍋" },
    L12_C1: { name: "Chương 1. Ester - Lipid", icon: "🧈" },
    L12_C2: { name: "Chương 2. Carbohydrate", icon: "🍚" },
    L12_C3: { name: "Chương 3. Hợp chất chứa Nitrogen", icon: "🥩" },
    L12_C4: { name: "Chương 4. Polymer", icon: "♻️" },
    L12_C5: { name: "Chương 5. Pin điện và điện phân", icon: "🔋" },
    L12_C6: { name: "Chương 6. Đại cương về kim loại", icon: "🔩" },
    L12_C7: { name: "Chương 7. Nguyên tố nhóm IA và IIA", icon: "🪙" },
    L12_C8: { name: "Chương 8. Kim loại chuyển tiếp và phức chất", icon: "🔧" }
  };
  // Ảnh thật + biểu tượng cho 3 bảng xếp hạng. Bảng ELO dùng ảnh Mendeleev (người tạo ra Bảng tuần hoàn,
  // hợp với ý nghĩa "đẳng cấp cộng dồn không giới hạn"); Bảng xếp hạng + Bảng 1vs1 dùng huy hiệu biểu
  // tượng (không gán ảnh 1 nhà hóa học cụ thể để tránh gán ghép hình ảnh không đúng bối cảnh lịch sử).
  var RANK_BOARD_INFO = {
    SCORE: { label: "Bảng xếp hạng", icon: "💪" },
    ELO: { label: "Bảng ELO", icon: "⭐", photo: "assets/cards/mendeleev.jpg", figure: "Dmitri Mendeleev (1834–1907)" },
    DUEL: { label: "Bảng 1vs1", icon: "🥊" }
  };
  var CARD_CATALOG = {}; // mã thẻ -> { name, sub, group, tier, icon, photo, figure, desc }
  CARD_CATALOG[CARD_PERFECT_ID()] = {
    name: "Hoàn Hảo",
    group: "perfect",
    tier: "legendary",
    icon: "✨",
    photo: "assets/cards/curie.jpg",
    figure: "Marie Curie (1867–1934)",
    desc: "Marie Curie — 2 lần đoạt giải Nobel (Vật lý 1903, Hóa học 1911), khám phá ra 2 nguyên tố polonium và radium, người tiên phong nghiên cứu về phóng xạ."
  };
  ["SCORE", "ELO", "DUEL"].forEach(function (board) {
    var info = RANK_BOARD_INFO[board];
    [1, 2, 3].forEach(function (rank) {
      var tier = rank === 1 ? "legendary" : rank === 2 ? "rare" : "bronze";
      var label = rank === 1 ? "Hạng Nhất" : rank === 2 ? "Hạng Nhì" : "Hạng Ba";
      CARD_CATALOG["RANK_" + board + "_" + rank] = {
        name: label,
        sub: info.label,
        group: "rank",
        tier: tier,
        icon: info.icon,
        photo: info.photo || null,
        figure: info.figure || null,
        desc: (info.figure ? info.figure + " — " : "") + "Từng đạt " + label.toLowerCase() + " ở " + info.label + "."
      };
    });
  });
  Object.keys(CHAPTER_CARD_INFO).forEach(function (chapterId) {
    var info = CHAPTER_CARD_INFO[chapterId];
    CARD_CATALOG["CHAP_" + chapterId] = {
      name: "Trọn Chương",
      sub: info.name,
      group: "chapter",
      tier: "rare",
      icon: info.icon,
      photo: info.photo || null,
      figure: info.figure || null,
      desc: (info.figure
        ? info.figure + " — khám phá ra hạt nhân nguyên tử, đặt nền móng cho vật lý hạt nhân hiện đại, đoạt giải Nobel Hóa học năm 1908. "
        : "") + "Đã làm đúng mọi câu hỏi khác nhau của \"" + info.name + "\" (cộng dồn qua nhiều lần làm)."
    };
  });
  // Mã thẻ "Hoàn Hảo" phải khớp hệt CARD_PERFECT ở AppsScript_Code.gs — khai báo qua hàm nhỏ này để chỉ
  // cần sửa 1 chỗ duy nhất (PERFECT100) nếu sau này backend đổi tên mã.
  function CARD_PERFECT_ID() { return "PERFECT100"; }

  function updateCollectionBadge() {
    var badge = $("#collection-count-badge");
    if (!badge) return;
    var count = Object.keys(myCardIds).length;
    if (count > 0) { badge.textContent = count; badge.classList.remove("hidden"); }
    else { badge.classList.add("hidden"); }
  }

  function loadMyCards() {
    if (!CARDS_ENABLED) return Promise.resolve(); // tính năng đang tạm tắt — xem CARDS_ENABLED ở đầu file
    var name = $("#inp-name").value.trim();
    if (!API_URL || !accessVerified || !name) {
      myCardIds = {};
      updateCollectionBadge();
      return Promise.resolve();
    }
    return apiGet({ action: "myCards", name: name, pin: currentCode() }).then(function (res) {
      myCardIds = {};
      if (res && res.cards) res.cards.forEach(function (c) { myCardIds[c.cardId] = c.time; });
      updateCollectionBadge();
    });
  }

  function renderCardTile(cardId) {
    var info = CARD_CATALOG[cardId];
    if (!info) return null;
    var unlocked = !!myCardIds[cardId];
    var div = el("div", "chem-card tier-" + info.tier + (unlocked ? "" : " locked"));
    var medallion = el("div", "cc-medallion");
    if (unlocked && info.photo) {
      medallion.innerHTML = '<img src="' + info.photo + '" alt="">';
    } else {
      medallion.textContent = info.icon || "🎴";
    }
    div.appendChild(medallion);
    if (!unlocked) div.appendChild(el("div", "cc-lock", "🔒"));
    var rarityLabel = info.tier === "legendary" ? "★★★ HUYỀN THOẠI" : info.tier === "rare" ? "★★ HIẾM" : "★ QUÝ";
    div.appendChild(el("div", "cc-rarity", rarityLabel));
    div.appendChild(el("div", "cc-name", escapeHtml(info.name)));
    if (info.sub) div.appendChild(el("div", "cc-sub", escapeHtml(info.sub)));
    div.title = (unlocked ? "" : "(Chưa đạt được) ") + info.name + (info.sub ? " — " + info.sub : "") +
      (info.desc ? "\n" + info.desc : "") + (unlocked && myCardIds[cardId] ? "\nĐạt được: " + myCardIds[cardId] : "");
    return div;
  }

  function renderCollectionScreen() {
    var name = $("#inp-name").value.trim();
    var needName = $("#collection-need-name");
    var body = $("#collection-body");
    if (!API_URL || !accessVerified || !name) {
      needName.classList.remove("hidden");
      body.classList.add("hidden");
      return;
    }
    needName.classList.add("hidden");
    body.classList.remove("hidden");
    var allIds = Object.keys(CARD_CATALOG);
    var haveCount = allIds.filter(function (id) { return myCardIds[id]; }).length;
    $("#collection-summary").innerHTML = "Em đã sưu tập được <b>" + haveCount + " / " + allIds.length + "</b> thẻ";
    var groups = { perfect: $("#collection-grid-perfect"), rank: $("#collection-grid-rank"), chapter: $("#collection-grid-chapter") };
    Object.keys(groups).forEach(function (g) { groups[g].innerHTML = ""; });
    allIds.forEach(function (id) {
      var tile = renderCardTile(id);
      var g = groups[CARD_CATALOG[id].group];
      if (tile && g) g.appendChild(tile);
    });
  }

  function openCollectionScreen() {
    renderCollectionScreen(); // hiện ngay dữ liệu cũ (nếu có) trong lúc chờ gọi API mới nhất bên dưới
    show("#screen-collection");
    loadMyCards().then(renderCollectionScreen);
  }

  // Hiện lần lượt (không đè lên nhau) mỗi khi vừa nộp bài/đấu xong mà nhận được thẻ mới.
  function showCardUnlockToast(newCardIds) {
    if (!CARDS_ENABLED) return; // tính năng đang tạm tắt — xem CARDS_ENABLED ở đầu file
    if (!newCardIds || !newCardIds.length) return;
    var wasEmpty = cardToastQueue.length === 0;
    newCardIds.forEach(function (id) { if (CARD_CATALOG[id]) cardToastQueue.push(id); });
    if (wasEmpty) playNextCardToast();
  }
  function playNextCardToast() {
    var overlay = $("#card-toast-overlay");
    if (!cardToastQueue.length) { overlay.classList.add("hidden"); return; }
    var id = cardToastQueue[0];
    var info = CARD_CATALOG[id];
    myCardIds[id] = myCardIds[id] || nowIsoLocal_();
    updateCollectionBadge();
    var bodyEl = $("#card-toast-body");
    bodyEl.innerHTML = "";
    var tile = renderCardTile(id);
    if (tile) bodyEl.appendChild(tile);
    bodyEl.appendChild(el("div", "card-toast-name", "<b>" + escapeHtml(info.name) + (info.sub ? " — " + escapeHtml(info.sub) : "") + "</b>"));
    overlay.classList.remove("hidden");
  }
  function nowIsoLocal_() { return new Date().toString(); } // chỉ dùng để hiện tạm, giá trị thật lấy lại từ server ở lần loadMyCards() kế tiếp

  // ---------- ELO (đẳng cấp cộng dồn vĩnh viễn — không reset hàng tuần, khác Bảng 1vs1) ----------
  function renderElo(elo) {
    var box = $("#elo-box");
    if (!box) return;
    if (typeof elo !== "number") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    $("#elo-content").innerHTML = "⭐ Điểm ELO của em: <b>" + elo + "</b>" +
      '<br><span class="small">Tăng dần khi tự luyện tập hoặc đối đầu 1vs1 — không giới hạn, không reset!</span>';
  }
  // Hiện 1 dòng nhỏ "+X ELO" (feedback tức thời) ở màn hình kết quả tự luyện tập, hoặc ẩn đi nếu lượt này
  // không được cộng thêm ELO (ví dụ đã luyện tập nhiều lần trong ngày nên điểm cộng đã giảm về 0).
  function renderResultElo(eloGain, elo) {
    var box = $("#result-elo");
    if (!box) return;
    if (!eloGain || typeof elo !== "number") { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden");
    box.innerHTML = "⭐ +" + eloGain + " ELO — tổng hiện tại: <b>" + elo + "</b>";
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
    if (!API_URL || !accessVerified || !name) {
      currentStats = null; renderStats();
      renderStreak(null);
      renderElo(null);
      lastChapterProgressData = null;
      if (cpBox) cpBox.classList.add("hidden");
      loadMyCards();
      return Promise.resolve(null);
    }
    return apiGet({ action: "profile", name: name, chapter: chap, pin: currentCode() }).then(function (res) {
      applyProfileResult_(res);
      return res && !res.error ? res : null;
    });
  }

  // ---------- Mã truy cập (hạng "full") / khách (hạng "guest", gõ tên suông) ----------
  function currentCode() { return $("#inp-code").value.trim(); }

  function maybeVerifyAccess() {
    var name = $("#inp-name").value.trim();
    var code = currentCode();
    var msgEl = $("#access-msg");
    if (!API_URL) {
      // chưa nối backend (đang test cục bộ) -> bỏ qua bước xác minh để không chặn phát triển/thử nghiệm
      accessVerified = true;
      currentTier = "full";
      msgEl.textContent = "";
      msgEl.className = "msg";
      validateStart();
      return;
    }
    if (!name) {
      accessVerified = false;
      currentTier = null;
      guestLimits = null;
      msgEl.textContent = "";
      msgEl.className = "msg";
      validateStart();
      refreshDuelControls();
      return;
    }
    var myToken = ++accessCheckToken;
    accessVerified = false;
    msgEl.textContent = "Đang kiểm tra...";
    msgEl.className = "msg";
    validateStart();
    attemptVerifyAccess(name, code, myToken, msgEl, false);
  }

  // Diễn giải rõ từng mã lỗi trả về từ verifyAndProfile, thay vì gộp chung 1 câu "không xác minh được"
  // khó chẩn đoán — để nếu lỗi tái diễn, giáo viên/học sinh biết ngay hướng xử lý.
  function errMsgForVerify(err) {
    if (err === "invalid_code") {
      return "✘ Mã truy cập không đúng. Kiểm tra lại mã thầy đã gửi qua email (hoặc bỏ trống ô mã để dùng thử với tư cách khách).";
    }
    if (err === "code_taken") {
      return "✘ Mã này đã được gắn với 1 tên khác trước đó. Nếu đây là mã của em, hãy nhập ĐÚNG tên em đã dùng lần đầu; nếu vẫn không được, liên hệ Zalo thầy " + ZALO_CONTACT_HTML + ".";
    }
    if (err === "busy") {
      return "✘ Hệ thống đang bận, đợi vài giây rồi thử lại nhé.";
    }
    if (err === "missing_name") {
      return "✘ Em nhập tên trước đã nhé.";
    }
    return "✘ Không xác minh được (có thể do mạng chập chờn). Thử lại — nếu vẫn lỗi, thử tải lại trang.";
  }

  // Xác minh tên (+mã nếu có); nếu lần đầu KHÔNG nhận được phản hồi nào (mạng chập chờn, hoặc Apps Script
  // vừa "thức dậy" sau khi thầy mới Deploy lại nên phản hồi chậm) thì tự thử lại thêm 1 lần trước khi báo
  // lỗi cho học sinh, để không hiện lỗi oan vì 1 trục trặc mạng thoáng qua.
  // Gộp xác minh quyền truy cập + tải hồ sơ vào ĐÚNG 1 lượt gọi mạng (action "verifyAndProfile") thay vì 2
  // lượt tuần tự như trước — cắt gần một nửa độ trễ lúc đăng nhập, vốn là nguyên nhân chính của cảm giác
  // "trang tải chậm nói chung".
  function attemptVerifyAccess(name, code, myToken, msgEl, isRetry) {
    apiPost({ action: "verifyAndProfile", name: name, pin: code, chapter: currentChapterId() }).then(function (res) {
      if (myToken !== accessCheckToken) return; // đã có lần kiểm tra mới hơn, bỏ qua kết quả cũ này
      var verify = res && res.verify;
      if (verify && verify.ok) {
        accessVerified = true;
        currentTier = verify.tier;
        guestLimits = verify.guestLimits || null;
        if (verify.tier === "full") {
          msgEl.textContent = "✔ Mã đúng — đã mở khoá đầy đủ tính năng, chào mừng em!";
          msgEl.className = "msg access-ok";
        } else {
          msgEl.textContent = "ℹ️ Đang dùng thử (khách): Tự luyện tập tối đa " +
            ((guestLimits && guestLimits.maxAttemptsPerChapter) || 3) + " lượt/chương, " +
            ((guestLimits && guestLimits.maxQuestions) || 10) + " câu/lượt. Có mã truy cập thì nhập ở trên để mở khoá đầy đủ nhé!";
          msgEl.className = "msg access-guest";
        }
        applyProfileResult_(res.profile);
        validateStart();
        refreshDuelControls();
        refreshRandomControls();
        return;
      }
      if (!res && !isRetry) {
        msgEl.textContent = "Đang kiểm tra... (thử lại)";
        setTimeout(function () {
          if (myToken !== accessCheckToken) return;
          attemptVerifyAccess(name, code, myToken, msgEl, true);
        }, 1200);
        return;
      }
      accessVerified = false;
      currentTier = null;
      guestLimits = null;
      // errMsgForVerify() có thể trả về chuỗi chứa thẻ HTML (link Zalo ở trường hợp "code_taken") -> phải
      // dùng innerHTML để hiện đúng thành link bấm được, dùng textContent sẽ lộ nguyên thẻ <a> ra màn hình.
      msgEl.innerHTML = errMsgForVerify(verify && verify.error);
      msgEl.className = "msg access-err";
      validateStart();
      refreshDuelControls();
      refreshRandomControls();
    });
  }

  /** Áp dụng kết quả getProfile (dùng chung bởi refreshProfile() và attemptVerifyAccess() ở trên, để 2 nơi
   *  này luôn hiện hồ sơ giống hệt nhau dù lấy dữ liệu qua 1 hay 2 lượt gọi mạng). */
  function applyProfileResult_(res) {
    var cpBox = $("#chapter-progress-box");
    if (!res || res.error) {
      currentStats = null; renderStats();
      renderStreak(null);
      renderElo(null);
      lastChapterProgressData = null;
      if (cpBox) cpBox.classList.add("hidden");
      loadMyCards();
      return;
    }
    currentStats = res.stats || null;
    renderStats();
    renderStreak(res.streak);
    renderElo(typeof res.elo === "number" ? res.elo : null);
    lastChapterProgressData = res.chapterProgress || null;
    renderChapterProgress();
    loadMyCards(); // đồng bộ luôn số thẻ đã có (hiện ở nút "Bộ sưu tập") mỗi khi làm mới hồ sơ
  }

  function debouncedMaybeVerifyAccess() {
    clearTimeout(accessDebounceTimer);
    accessDebounceTimer = setTimeout(maybeVerifyAccess, 400);
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
    var accessOk = !API_URL || accessVerified;
    var ok = name.length > 0 && accessOk && !!currentChapterId() && !!selectedCount;
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

  // ---------- Chế độ Ngẫu nhiên: chọn 18 câu (14 Lớp 12 đủ mọi chương + 2 Lớp 10 + 2 Lớp 11) ----------
  // LƯU Ý: backend (AppsScript_Code.gs) KHÔNG có quyền truy cập nội dung câu hỏi (chỉ có ở data/*.json,
  // tải trực tiếp từ frontend) nên toàn bộ việc CHỌN câu hỏi phải nằm ở đây, phía app.js.
  function gradeChapterIds_(gradeId) {
    var g = manifest && manifest.grades.find(function (x) { return x.id === gradeId; });
    return g ? g.chapters.map(function (c) { return c.id; }) : [];
  }
  function pickRandomN_(arr, n) {
    return shuffle(arr).slice(0, Math.max(0, n));
  }
  function buildRandomTestQuestions_() {
    var l12Ids = gradeChapterIds_("L12");
    var l10Ids = gradeChapterIds_("L10");
    var l11Ids = gradeChapterIds_("L11");
    return Promise.all(l12Ids.map(loadChapterQuestionsCached_)).then(function (l12Lists) {
      // Đảm bảo đủ TẤT CẢ các chương Lớp 12: mỗi chương có câu hỏi lấy random 1 câu trước, phần còn dư dồn
      // vào 1 kho chung để rút thêm cho đủ RANDOM_L12_COUNT câu (không nhất thiết đều nhau giữa các chương).
      var guaranteed = [];
      var remainderPool = [];
      l12Lists.forEach(function (qs) {
        if (!qs || !qs.length) return;
        var shuffled = shuffle(qs);
        guaranteed.push(shuffled[0]);
        remainderPool = remainderPool.concat(shuffled.slice(1));
      });
      var need = RANDOM_L12_COUNT - guaranteed.length;
      var extra12 = need > 0 ? pickRandomN_(remainderPool, need) : [];
      var l12Selected = guaranteed.concat(extra12).slice(0, RANDOM_L12_COUNT);
      return Promise.all([
        Promise.all(l10Ids.map(loadChapterQuestionsCached_)),
        Promise.all(l11Ids.map(loadChapterQuestionsCached_))
      ]).then(function (rest) {
        var l10Pool = [].concat.apply([], rest[0]);
        var l11Pool = [].concat.apply([], rest[1]);
        var l10Selected = pickRandomN_(l10Pool, RANDOM_L10_COUNT);
        var l11Selected = pickRandomN_(l11Pool, RANDOM_L11_COUNT);
        return shuffle(l12Selected.concat(l10Selected, l11Selected));
      });
    });
  }

  function formatMinSec_(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function startRandomTimer_() {
    stopRandomTimer_();
    var box = $("#random-timer-box");
    var txt = $("#random-timer-text");
    if (box) box.classList.remove("hidden");
    if (txt) txt.textContent = "0:00";
    randomTimerInterval = setInterval(function () {
      if (!randomStartMs) return;
      var elapsed = Math.floor((Date.now() - randomStartMs) / 1000);
      if (txt) txt.textContent = formatMinSec_(elapsed);
    }, 1000);
  }
  function stopRandomTimer_() {
    clearInterval(randomTimerInterval);
    randomTimerInterval = null;
    var box = $("#random-timer-box");
    if (box) box.classList.add("hidden");
  }

  function startRandomQuiz() {
    var btn = $("#btn-start-random");
    var msgEl = $("#random-msg");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Đang chọn câu hỏi...";
    if (msgEl) msgEl.textContent = "";
    buildRandomTestQuestions_().then(function (questions) {
      btn.disabled = false;
      btn.textContent = "Bắt đầu làm bài (18 câu)";
      if (!questions || questions.length < RANDOM_TOTAL) {
        if (msgEl) msgEl.textContent = "Chưa đủ dữ liệu câu hỏi để tạo đề ngẫu nhiên, thử lại nhé.";
        return;
      }
      runRandomQuiz(questions);
    }, function () {
      btn.disabled = false;
      btn.textContent = "Bắt đầu làm bài (18 câu)";
      if (msgEl) msgEl.textContent = "Không tải được câu hỏi (kiểm tra lại mạng), thử lại nhé.";
    });
  }

  function runRandomQuiz(questionList) {
    quiz = {
      questions: questionList,
      index: 0,
      mode: "hien_ngay",
      answers: [],
      isRandomMode: true
    };
    randomStartMs = Date.now();
    show("#screen-quiz");
    startRandomTimer_();
    renderQuestion();
  }

  function runQuiz(questionList, mode) {
    stopRandomTimer_(); // phòng trường hợp trước đó vừa ở Chế độ ngẫu nhiên (VD "Làm lại câu sai" sau khi làm ngẫu nhiên)
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

    // Xáo trộn thứ tự HIỂN THỊ 4 đáp án mỗi lần vào câu (chỉ đổi vị trí trên màn hình — nhãn A/B/C/D vẫn
    // giữ đúng gắn với đáp án gốc của nó, và việc chấm đúng/sai vẫn dựa vào letter gốc nên không ảnh hưởng
    // gì đến logic chấm điểm). Lưu lại quiz.optOrder để confirmAnswer() tô đúng màu theo đúng vị trí đã xáo.
    quiz.optOrder = shuffle(["A", "B", "C", "D"]);
    quiz.optOrder.forEach(function (letter) {
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
        var L = quiz.optOrder[i];
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
        : kind === "elo" ? item.elo + " ELO"
        : kind === "random" ? formatMinSec_(item.seconds)
        : item.score + "%";
      li.innerHTML =
        '<span class="lb-rank">' + (medals[i] || (i + 1)) + '</span>' +
        '<span class="lb-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="lb-score">' + scoreHtml + '</span>';
      listEl.appendChild(li);
    });
  }
  // ---------- Bảng Ngẫu nhiên (Top 3 kỷ lục 18/18 câu nhanh nhất) ----------
  function refreshRandomLeaderboard() {
    if (!API_URL) {
      renderLeaderboardList("#leaderboard-random-list", "#leaderboard-random-empty", null, "random");
      $("#leaderboard-random-offline").classList.remove("hidden");
      return;
    }
    $("#leaderboard-random-offline").classList.add("hidden");
    apiGet({ action: "randomRecordLeaderboard" }).then(function (res) {
      lastRandomLeaderboardData = res || null;
      renderLeaderboardList("#leaderboard-random-list", "#leaderboard-random-empty", res && res.leaderboard, "random");
    });
  }

  function startLeaderboardPolling() {
    refreshLeaderboard();
    refreshDuelLeaderboard();
    refreshEloLeaderboard();
    refreshRandomLeaderboard();
    // 8 giây/lần — khớp với thời gian cache 8 giây ở backend (LB_CACHE_TTL_SECONDS trong AppsScript_Code.gs),
    // nên dù hỏi lại nhanh hơn cũng không làm sheet bị quét lại nhiều lần không cần thiết.
    setInterval(function () {
      if (document.visibilityState === "visible") {
        refreshLeaderboard(); refreshDuelLeaderboard(); refreshEloLeaderboard(); refreshRandomLeaderboard();
      }
    }, 8000);
  }

  function nextQuestion() {
    if (quiz.index < quiz.questions.length - 1) {
      quiz.index++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  // ===== Nộp bài + hiện kết quả cho Chế độ ngẫu nhiên (18 câu, khác hẳn nộp bài Tự luyện tập vì không
  // gắn với 1 chương cụ thể, có tính thời gian làm bài, và chỉ đúng 18/18 mới được tính kỷ lục). =====
  function finishRandomQuiz() {
    stopRandomTimer_();
    var name = $("#inp-name").value.trim();
    var elapsedSec = randomStartMs ? Math.max(1, Math.round((Date.now() - randomStartMs) / 1000)) : 0;
    var correctCount = quiz.answers.filter(function (a) { return a.correct; }).length;
    var badgeBanner = $("#result-badge");
    if (badgeBanner) badgeBanner.classList.add("hidden");
    renderResultElo(0, null);

    var infoBox = $("#result-random-info");
    if (infoBox) {
      infoBox.classList.remove("hidden");
      infoBox.innerHTML = "⏱️ Thời gian làm bài: <b>" + formatMinSec_(elapsedSec) + "</b><br>Đang lưu kết quả...";
    }
    var resultStatsBox = $("#result-stats");
    resultStatsBox.classList.add("hidden");
    resultStatsBox.innerHTML = "";

    apiPost({
      action: "submitRandomTest",
      name: name,
      pin: currentCode(),
      results: quiz.answers,
      elapsedSec: elapsedSec
    }).then(function (submitRes) {
      if (!infoBox) return;
      if (!submitRes || submitRes.ok === false) {
        infoBox.innerHTML = "⏱️ Thời gian làm bài: <b>" + formatMinSec_(elapsedSec) + "</b><br>" +
          "Không lưu được kết quả lượt này (" + ((submitRes && submitRes.error) || "lỗi") + ") — thử lại nhé.";
        return;
      }
      renderResultElo(submitRes.eloGain, submitRes.elo);
      refreshLeaderboard();
      refreshEloLeaderboard();
      var html = "⏱️ Thời gian làm bài: <b>" + formatMinSec_(elapsedSec) + "</b>";
      if (correctCount < RANDOM_TOTAL) {
        html += "<br>Chưa đúng trọn vẹn 18/18 câu nên lượt này chưa tính là kỷ lục — làm đúng hết cả 18 câu để có cơ hội lập kỷ lục nhé!";
      } else if (submitRes.isNewRecord) {
        html += "<br>🎉 <b>Kỷ lục mới của em!</b> Có thể em vừa lọt Top 3 nhanh nhất — xem Bảng Ngẫu nhiên bên cạnh nhé!";
      } else {
        html += "<br>Đúng trọn vẹn 18/18 câu, nhưng chưa nhanh hơn kỷ lục cũ của chính em"
          + (typeof submitRes.bestSeconds === "number" ? " (" + formatMinSec_(submitRes.bestSeconds) + ")" : "") + ".";
      }
      infoBox.innerHTML = html;
      refreshRandomLeaderboard();
    }, function () {
      if (infoBox) {
        infoBox.innerHTML = "⏱️ Thời gian làm bài: <b>" + formatMinSec_(elapsedSec) + "</b><br>Không lưu được kết quả (lỗi mạng) — thử lại nhé.";
      }
    });

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

  function finishQuiz() {
    if (quiz.isRandomMode) { finishRandomQuiz(); return; }
    var infoBox0 = $("#result-random-info");
    if (infoBox0) infoBox0.classList.add("hidden"); // ẩn ô thông tin của Chế độ ngẫu nhiên nếu lần trước vừa hiện
    var name = $("#inp-name").value.trim();
    var chap = currentChapterId();
    var correctCount = quiz.answers.filter(function (a) { return a.correct; }).length;
    var badgeBanner = $("#result-badge");
    if (badgeBanner) badgeBanner.classList.add("hidden"); // xoá banner của lần trước, tránh nháy nội dung cũ
    renderResultElo(0, null); // ẩn tạm ô "+X ELO" của lần trước, chờ phản hồi server lượt này

    var resultStatsBox = $("#result-stats");
    resultStatsBox.classList.remove("hidden");
    resultStatsBox.innerHTML = "Đang cập nhật tiến độ...";

    apiPost({
      action: "submit",
      name: name,
      chapter: chap,
      pin: currentCode(),
      mode: quiz.mode,
      results: quiz.answers
    }).then(function (submitRes) {
      if (submitRes && submitRes.ok === false) {
        // Hiếm gặp (VD 2 tab cùng làm 1 chương, hoặc vừa hết lượt khách ngay lúc nộp bài) — kết quả lượt
        // này KHÔNG được lưu, báo rõ cho học sinh biết thay vì hiện "tiến độ" như đã lưu thành công.
        resultStatsBox.classList.remove("hidden");
        if (submitRes.error === "guest_limit_reached" || submitRes.error === "guest_question_limit") {
          resultStatsBox.className = "stats-box locked-feature-msg";
          resultStatsBox.innerHTML = "😊 Lượt làm bài này KHÔNG được lưu vì em đã dùng hết lượt luyện tập " +
            "miễn phí cho chương này. Liên hệ Zalo thầy " + ZALO_CONTACT_HTML + " để đăng ký nhận mã truy cập nhé!";
        } else {
          resultStatsBox.className = "stats-box";
          resultStatsBox.innerHTML = "Không lưu được kết quả lượt này (" + (submitRes.error || "lỗi") + ") — thử lại nhé.";
        }
        return;
      }
      renderResultElo(submitRes && submitRes.eloGain, submitRes && submitRes.elo);
      showCardUnlockToast(submitRes && submitRes.newCards);
      refreshLeaderboard(); // "ngay khi có sự thay đổi" cho chính học sinh vừa nộp bài
      refreshEloLeaderboard();
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
  function formatDuelScore(n) {
    var r = Math.round((n || 0) * 10) / 10; // phòng sai số dấu phẩy động (điểm luôn là bội số của 0,5)
    return (r % 1 === 0 ? r : r.toFixed(1)) + "đ";
  }
  function buildDuelQuestionIds() {
    var pool = shuffle(staticQuestions.concat(extraQuestions));
    return pool.slice(0, DUEL_QUESTION_COUNT).map(function (q) { return q.id; });
  }
  function clearDuelTimers() {
    clearInterval(duelWaitTickTimer); duelWaitTickTimer = null;
    clearInterval(duelWaitPollTimer); duelWaitPollTimer = null;
    clearInterval(duelPickPollTimer); duelPickPollTimer = null;
    clearInterval(duelPollTimer); duelPollTimer = null;
    clearTimeout(duelAnswerTimeoutTimer); duelAnswerTimeoutTimer = null;
  }

  // ---------- Đối đầu: bước 1 (người thách đấu) — tạo lời thách + phòng chờ 60s ----------
  function startChallenge() {
    var name = $("#inp-name").value.trim();
    var pin = currentCode();
    var chapObj = currentChapterObj();
    if (!name || !accessVerified || currentTier !== "full" || !chapObj) return;
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
    apiGet({ action: "challengeStatus", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentCode() })
      .then(function (res) {
        if (!res || !duelMatchId) return; // đã hủy/thoát trong lúc chờ phản hồi
        if (res.status === "matched") {
          clearDuelTimers();
          enterDuelQuiz(res.chapter, res.chapterName, res.questionIds, res.opponent);
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
    if (mid) apiPost({ action: "cancelChallenge", matchId: mid, name: $("#inp-name").value.trim(), pin: currentCode() });
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
    apiGet({ action: "listChallenges", name: $("#inp-name").value.trim(), pin: currentCode() }).then(function (res) {
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
    apiPost({ action: "acceptChallenge", matchId: matchId, name: $("#inp-name").value.trim(), pin: currentCode() })
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
        enterDuelQuiz(res.chapter, res.chapterName, res.questionIds, res.opponent);
      });
  }

  // ---------- Đối đầu: bước 2 — cả 2 học sinh cùng vào làm bài, câu hỏi hiện song song ----------
  function enterDuelQuiz(chapter, chapterName, questionIds, opponent) {
    duelOpponentName = opponent;
    Promise.all([
      loadStaticQuestions(chapter).catch(function () { return []; }),
      apiGet({ action: "extra", chapter: chapter })
    ]).then(function (results) {
      var staticQs = results[0] || [];
      var extraRes = results[1];
      var pool = staticQs.concat((extraRes && extraRes.questions) || []);
      var byId = {};
      pool.forEach(function (q) { byId[q.id] = q; });
      // QUAN TRỌNG: giữ NGUYÊN thứ tự questionIds (không shuffle) — 2 học sinh phải thấy đúng CÙNG 1
      // câu ở CÙNG 1 vị trí (index) thì cơ chế "ai bấm trước khóa câu" mới đồng bộ đúng cho cả 2 bên.
      var duelQuestions = questionIds.map(function (id) { return byId[id]; }).filter(Boolean);
      runDuelQuiz(duelQuestions, chapter, chapterName);
    });
  }

  function runDuelQuiz(questions, chapter, chapterName) {
    if (questions.length < DUEL_QUESTION_COUNT) {
      show("#screen-setup");
      $("#duel-msg").textContent = "Không tải được đủ câu hỏi cho trận này, thử thách đấu lại nhé.";
      return;
    }
    quiz = { questions: questions, index: 0, isDuel: true, chapter: chapter, chapterName: chapterName, finished: false };
    duelYou = { score: 0, correct: 0, wrong: 0 };
    duelOpp = { score: 0, correct: 0, wrong: 0, name: duelOpponentName };
    duelAnsweredLocally = false;
    duelPhase = "quiz";
    show("#screen-quiz");
    $("#duel-score-box").classList.remove("hidden");
    $("#duel-timer-box").classList.remove("hidden");
    updateDuelScoreDisplay();
    renderDuelQuestion();
    duelPollTimer = setInterval(pollDuelState, DUEL_POLL_MS);
  }

  function updateDuelScoreDisplay() {
    var youEl = $("#duel-score-you"), oppEl = $("#duel-score-opp");
    if (youEl) youEl.textContent = "Bạn: " + formatDuelScore(duelYou.score);
    if (oppEl) oppEl.textContent = (duelOpp.name || "Đối thủ") + ": " + formatDuelScore(duelOpp.score);
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
    $("#btn-next").classList.add("hidden");   // đối đầu: bấm đáp án là gửi luôn, không cần nút xác nhận riêng
    duelAnsweredLocally = false;
    // Xáo trộn thứ tự hiển thị như chế độ Tự luyện tập — chỉ ảnh hưởng vị trí hiển thị phía CLIENT NÀY,
    // không liên quan gì đến việc chấm điểm (server chỉ nhận correct:true/false, không nhận vị trí).
    quiz.optOrder = shuffle(["A", "B", "C", "D"]);
    quiz.optOrder.forEach(function (letter) {
      var b = el("button", "opt-btn");
      b.innerHTML = '<span class="opt-label">' + letter + '</span><span>' + q.options[letter] + '</span>';
      b.addEventListener("click", function () { selectDuelOption(letter, b); });
      optsBox.appendChild(b);
    });
    startDuelAnswerCountdown();
  }

  // Đếm ngược riêng cho MỖI câu (không đồng bộ với đồng hồ máy chủ — chỉ để "nhắc" chứ không quyết định
  // đúng/sai/thắng-thua): hết giờ mà chưa ai bấm thì tự báo server bỏ qua câu này (mode "skip").
  function startDuelAnswerCountdown() {
    clearTimeout(duelAnswerTimeoutTimer);
    var deadlineMs = Date.now() + DUEL_ANSWER_TIMEOUT_MS;
    var myIndex = quiz.index;
    (function tick() {
      if (!quiz || !quiz.isDuel || quiz.finished || quiz.index !== myIndex) return;
      var remain = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
      var txt = $("#duel-timer-text");
      if (txt) txt.textContent = remain + "s";
      var box = $("#duel-timer-box");
      if (box) box.classList.toggle("urgent", remain <= 5);
      if (remain <= 0) {
        if (!duelAnsweredLocally) submitDuelAnswerToServer(myIndex, "skip", false);
        return;
      }
      duelAnswerTimeoutTimer = setTimeout(tick, 250);
    })();
  }

  function selectDuelOption(letter, btnEl) {
    if (duelAnsweredLocally) return;
    duelAnsweredLocally = true;
    clearTimeout(duelAnswerTimeoutTimer);
    var q = quiz.questions[quiz.index];
    var correct = letter === q.answer;
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) { b.disabled = true; });
    btnEl.classList.add("selected");
    submitDuelAnswerToServer(quiz.index, "answer", correct);
  }

  function submitDuelAnswerToServer(index, mode, correct) {
    apiPost({
      action: "submitDuelAnswer", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentCode(),
      index: index, mode: mode, correct: !!correct
    }).then(function () { pollDuelState(); }); // hỏi lại ngay để biết ai khóa được câu + điểm mới nhất
  }

  // Tô sáng đáp án đúng + thông báo "ai bấm trước" cho câu VỪA bị khóa (so điểm trước/sau để biết chính
  // mình hay đối thủ vừa được/mất điểm câu đó, vì client không biết trực tiếp mình là "người thách" hay
  // "đối thủ" trong dữ liệu QState phía server).
  function showDuelLockedFeedback(entry, iAnsweredThis, iWasCorrect) {
    var fb = $("#q-feedback");
    fb.classList.remove("hidden");
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) { b.disabled = true; });
    if (!entry || entry.by === "timeout") {
      fb.textContent = "⏳ Hết giờ, không ai trả lời kịp — bỏ qua câu này, không ai được/mất điểm.";
      fb.className = "q-feedback";
      return;
    }
    var q = quiz.questions[quiz.index];
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b, i) {
      var L = quiz.optOrder[i];
      if (L === q.answer) b.classList.add("correct");
      else if (b.classList.contains("selected") && iAnsweredThis && !iWasCorrect) b.classList.add("wrong");
    });
    if (iAnsweredThis) {
      fb.textContent = iWasCorrect
        ? "✔ Em nhanh tay và ĐÚNG! +1 điểm."
        : "✘ Em nhanh tay nhưng bị SAI, đáp án đúng là " + q.answer + ". −0,5 điểm.";
      fb.className = "q-feedback " + (iWasCorrect ? "correct" : "wrong");
    } else {
      var oppLabel = (duelOpp && duelOpp.name) || "Đối thủ";
      fb.textContent = entry.correct
        ? "⚡ " + oppLabel + " bấm trước và ĐÚNG rồi! Đáp án đúng là " + q.answer + "."
        : "⚡ " + oppLabel + " bấm trước nhưng bị SAI. Đáp án đúng là " + q.answer + ".";
      fb.className = "q-feedback";
    }
  }

  // ---------- Đối đầu: polling chính trong lúc thi đấu (câu bị khóa chưa/oẳn tù tì/đã xong chưa) ----------
  function pollDuelState() {
    if (!duelMatchId) return;
    apiGet({ action: "duelState", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentCode() })
      .then(function (res) {
        if (!res || !res.ok || duelPhase === "done") return;
        var prevYouAnswered = duelYou.correct + duelYou.wrong;
        var prevYouCorrect = duelYou.correct;
        duelYou = res.you;
        duelOpp = res.opponent;
        updateDuelScoreDisplay();

        if (res.status === "xong") {
          finishDuelQuiz(res);
          return;
        }
        if (res.status === "tie_break") {
          if (duelPhase !== "tie_break") {
            duelPhase = "tie_break";
            clearTimeout(duelAnswerTimeoutTimer);
            show("#screen-duel-rps");
          }
          renderDuelRpsState(res.rps);
          return;
        }
        // status "da_ghep": nếu server đã xử lý xong câu hiện tại (đối thủ khóa trước, hoặc mình vừa
        // khóa xong, hoặc hết giờ bỏ qua) -> hiện phản hồi rồi CẢ 2 BÊN cùng chuyển sang câu res.index
        // (nguồn "đúng" chung, không chỉ dựa vào việc riêng mình vừa bấm hay chưa).
        if (quiz && quiz.isDuel && !quiz.finished && res.index > quiz.index) {
          var iAnsweredThis = (res.you.correct + res.you.wrong) > prevYouAnswered;
          var iWasCorrect = res.you.correct > prevYouCorrect;
          showDuelLockedFeedback(res.qstate[quiz.index], iAnsweredThis, iWasCorrect);
          clearTimeout(duelAnswerTimeoutTimer);
          var nextIndex = res.index;
          setTimeout(function () {
            if (!quiz || !quiz.isDuel || quiz.finished) return;
            quiz.index = nextIndex;
            if (quiz.index < quiz.questions.length) renderDuelQuestion();
          }, 1200);
        }
      });
  }

  // ---------- Đối đầu: bằng điểm cuối trận -> phân định bằng Oẳn tù tì ----------
  function renderDuelRpsState(rps) {
    if (!rps) return;
    var choseAlready = !!rps.yourChoice;
    document.querySelectorAll(".duel-rps-btn").forEach(function (b) {
      b.disabled = choseAlready;
      b.classList.toggle("selected", choseAlready && b.getAttribute("data-choice") === rps.yourChoice);
    });
    $("#duel-rps-info").textContent = rps.round > 1
      ? "Ra kèo giống nhau, chơi lại! (Vòng " + rps.round + ")"
      : "Bằng điểm nhau! Ai thắng ván Oẳn tù tì này sẽ thắng chung cuộc.";
    var msgEl = $("#duel-rps-msg");
    var revealEl = $("#duel-rps-reveal");
    if (!choseAlready) {
      msgEl.textContent = "";
      revealEl.classList.add("hidden");
      return;
    }
    if (!rps.opponentChoice) {
      msgEl.textContent = "Em đã chọn " + DUEL_RPS_LABELS[rps.yourChoice] + " — đang chờ đối thủ chọn...";
      revealEl.classList.add("hidden");
    } else {
      msgEl.textContent = "";
      revealEl.classList.remove("hidden");
      revealEl.innerHTML = "Em: <b>" + DUEL_RPS_LABELS[rps.yourChoice] + "</b> &nbsp;—&nbsp; Đối thủ: <b>" +
        DUEL_RPS_LABELS[rps.opponentChoice] + "</b>";
    }
  }
  function chooseDuelRps(choice) {
    apiPost({
      action: "submitDuelRps", matchId: duelMatchId, name: $("#inp-name").value.trim(), pin: currentCode(), choice: choice
    }).then(function () { pollDuelState(); });
  }

  // ---------- Đối đầu: bước 3 — hiện thắng/thua/hòa (đã tự động chốt ở phía server) ----------
  function finishDuelQuiz(res) {
    if (quiz) quiz.finished = true;
    duelPhase = "done";
    clearInterval(duelPollTimer); duelPollTimer = null;
    clearTimeout(duelAnswerTimeoutTimer); duelAnswerTimeoutTimer = null;
    $("#duel-score-box").classList.add("hidden");
    $("#duel-timer-box").classList.add("hidden");
    show("#screen-duel-result");
    renderDuelResult(res);
    showCardUnlockToast(res.newCards);
    onDuelFinished();
  }
  function renderDuelResult(res) {
    var name = $("#inp-name").value.trim();
    $("#duel-you-name").textContent = name + " (em)";
    $("#duel-opp-name").textContent = (res.opponent && res.opponent.name) || duelOpponentName || "Đối thủ";
    $("#duel-you-score").textContent = formatDuelScore(res.you.score);
    $("#duel-you-time").textContent = "✔ " + res.you.correct + "  ✘ " + res.you.wrong;
    $("#duel-opp-score").textContent = formatDuelScore(res.opponent.score);
    $("#duel-opp-time").textContent = "✔ " + res.opponent.correct + "  ✘ " + res.opponent.wrong;
    $("#duel-waiting-opponent").classList.add("hidden");
    var banner = $("#duel-result-banner");
    banner.classList.remove("hidden");
    if (res.outcome === "thang") { banner.textContent = "🏆 Em đã THẮNG!"; banner.className = "duel-result-banner win"; }
    else if (res.outcome === "thua") { banner.textContent = "😅 Em thua lần này, cố lên nhé!"; banner.className = "duel-result-banner lose"; }
    else { banner.textContent = "🤝 Hòa!"; banner.className = "duel-result-banner draw"; }

    var rpsNote = $("#duel-rps-note");
    if (res.rps && res.rps.yourChoice && res.rps.opponentChoice) {
      rpsNote.classList.remove("hidden");
      rpsNote.textContent = "Bằng điểm nên phân định bằng Oẳn tù tì: em ra " + DUEL_RPS_LABELS[res.rps.yourChoice] +
        ", đối thủ ra " + DUEL_RPS_LABELS[res.rps.opponentChoice] + ".";
    } else {
      rpsNote.classList.add("hidden");
    }

    var eloNote = $("#duel-elo-note");
    if (eloNote) {
      if (res.you && typeof res.you.eloChange === "number" && typeof res.you.eloNow === "number") {
        var sign = res.you.eloChange > 0 ? "+" : "";
        eloNote.classList.remove("hidden");
        eloNote.className = "duel-elo-note" + (res.you.eloChange > 0 ? " up" : res.you.eloChange < 0 ? " down" : "");
        eloNote.innerHTML = "⭐ ELO: " + sign + res.you.eloChange + " — tổng hiện tại: <b>" + res.you.eloNow + "</b>";
      } else {
        eloNote.classList.add("hidden");
      }
    }
  }
  function onDuelFinished() {
    refreshLeaderboard();
    refreshDuelLeaderboard();
    refreshEloLeaderboard();
    refreshProfile(); // trận đấu cũng tính vào chuỗi ngày + tiến độ chương, cập nhật lại cho lần quay về màn hình chính
  }
  function exitDuelResult() {
    clearDuelTimers();
    duelMatchId = null;
    duelOpponentName = null;
    show("#screen-setup");
  }
  // Thoát giữa chừng (đang làm bài hoặc đang oẳn tù tì): không có "nộp bài" riêng nữa vì mỗi câu đã tự
  // ghi nhận ngay khi bị khóa — thoát coi như bỏ cuộc, đối thủ cứ tiếp tục bấm là tự thắng các câu còn lại.
  function exitDuelMidMatch(confirmMsg) {
    if (!confirm(confirmMsg)) return false;
    if (quiz) quiz.finished = true;
    duelPhase = "done";
    clearDuelTimers();
    duelMatchId = null;
    duelOpponentName = null;
    show("#screen-setup");
    return true;
  }

  // ================= Giải đấu WorldCup (loại trực tiếp) =================
  // Luật chơi từng cặp đấu Y HỆT Đối đầu 1vs1 (10 câu, đúng +1/sai -0,5, hoà thì Oẳn tù tì) nên tái sử
  // dụng lại màn hình làm bài (#screen-quiz) + màn oẳn tù tì (#screen-duel-rps) — chỉ khác luồng điều
  // khiển: không có bước "thách đấu/đồng ý" thủ công, tất cả do server tự ghép cặp theo từng vòng, và 1
  // interval DUY NHẤT (tourPollTimer, hỏi lại mỗi ~1 giây) chạy xuyên suốt từ lúc mở màn "Giải đấu" cho
  // tới khi rời hẳn về màn hình chính — dù đang ở màn hub hay đang thi đấu.

  function openTournamentScreen() {
    show("#screen-tournament");
    pollTournament(); // vẽ ngay dữ liệu mới nhất, không đợi hết chu kỳ 1 giây đầu tiên
    startTournamentPolling();
  }
  function startTournamentPolling() {
    if (tourPollTimer) return;
    tourPollTimer = setInterval(pollTournament, DUEL_POLL_MS);
  }
  function stopTournamentPolling() {
    clearInterval(tourPollTimer); tourPollTimer = null;
  }

  function pollTournament() {
    var name = $("#inp-name").value.trim();
    var needNameEl = $("#tournament-need-name");
    if (!API_URL || !accessVerified || !name) {
      needNameEl.className = "panel-empty";
      needNameEl.textContent = "Nhập tên (và mã truy cập nếu có) ở màn hình chính để tham gia giải đấu nhé.";
      needNameEl.classList.remove("hidden");
      $("#tournament-body").classList.add("hidden");
      return;
    }
    if (currentTier === "guest") {
      // Giải đấu WorldCup chỉ dành cho hạng "full" (có mã) — khách thấy thông báo khoá tính năng, không
      // cần gọi API mỗi chu kỳ poll làm gì (đỡ tốn 1 lượt gọi Apps Script vô ích mỗi giây).
      needNameEl.className = "msg locked-feature-msg";
      needNameEl.innerHTML = lockedFeatureHtml_("Giải đấu WorldCup");
      needNameEl.classList.remove("hidden");
      $("#tournament-body").classList.add("hidden");
      return;
    }
    var myToken = ++tourPollToken; // đánh dấu đây là lượt poll MỚI NHẤT tại thời điểm gửi đi
    apiGet({ action: "tournamentMatchState", name: name, pin: currentCode() }).then(function (res) {
      // Nhiều lượt poll có thể đang bay cùng lúc trên mạng (interval 1s + poll ngay sau khi nộp câu trả
      // lời/oẳn tù tì) và mạng có thể trả về KHÔNG ĐÚNG THỨ TỰ đã gửi — nếu 1 lượt poll CŨ (ứng với trận
      // vừa xong) về SAU 1 lượt poll MỚI hơn (đã phát hiện trận xong, đã rời màn thi đấu) thì kết quả cũ
      // này phải bị bỏ qua, không thì học sinh sẽ bị kéo "vào lại" trận đã kết thúc.
      if (myToken !== tourPollToken) return;
      if (!res || !res.ok) return;
      routeTournamentPhase(res);
    });
  }

  function routeTournamentPhase(res) {
    var inBattle = res.phase === "playing" || res.phase === "tie_break";
    if (inBattle) {
      // Bình thường học sinh thắng 1 trận sẽ thấy phase "waiting_round" (màn chờ) TRƯỚC khi trận tiếp
      // theo được ghép — nhưng nếu vòng mới vừa được ghép NGAY LÚC lượt poll kế tiếp của chính mình cũng
      // vừa gửi đi (đối thủ ở cặp khác trả lời xong gần như đồng thời), có thể bỏ lỡ hẳn màn chờ đó và
      // nhận trực tiếp phase "playing" của TRẬN MỚI trong khi quiz.isTour vẫn còn true từ trận VỪA XONG.
      // Nếu không phát hiện được matchId đã đổi, updateTourBattleFromPoll sẽ tưởng nhầm đây là điểm số
      // mới của trận cũ (mà không có câu hỏi để vẽ) -> màn hình bị "đứng hình" ở câu cuối trận cũ mãi mãi.
      var isNewMatch = !!res.matchId && res.matchId !== tourMatchId;
      if (!tourEnteringMatch && (!(quiz && quiz.isTour) || isNewMatch)) {
        enterTourMatch_(res);
      } else if (quiz && quiz.isTour && !quiz.loading && !isNewMatch) {
        updateTourBattleFromPoll(res);
      }
      return;
    }
    if (quiz && quiz.isTour) exitTourBattleToHub_();
    renderTournamentHub(res);
  }

  // ---------- Hub: đăng ký + sơ đồ nhánh ----------
  function renderTournamentHub(res) {
    $("#tournament-need-name").classList.add("hidden");
    $("#tournament-body").classList.remove("hidden");
    var noneBox = $("#tournament-none");
    var statusBox = $("#tournament-status-box");
    var bracketWrap = $("#tournament-bracket-wrap");
    var joinBtn = $("#btn-tournament-join");
    var t = res.tournament;

    if (res.phase === "none") {
      noneBox.classList.remove("hidden");
      statusBox.classList.add("hidden");
      bracketWrap.classList.add("hidden");
      return;
    }
    noneBox.classList.add("hidden");
    statusBox.classList.remove("hidden");
    statusBox.className = "tour-status-box";
    joinBtn.classList.add("hidden");

    var titleEl = $("#tournament-status-title"), subEl = $("#tournament-status-sub");
    var myName = $("#inp-name").value.trim().toLowerCase();

    if (res.phase === "cancelled") {
      titleEl.textContent = "Giải đấu vừa bị thầy/cô hủy";
      subEl.textContent = "";
    } else if (res.phase === "registration") {
      var joined = t.participants.length, total = t.size;
      var meIn = t.participants.some(function (p) { return p.trim().toLowerCase() === myName; });
      titleEl.textContent = "Giải đấu \"" + (t.chapterName || t.chapter) + "\"";
      subEl.textContent = "Đã đăng ký: " + joined + " / " + total + " học sinh" +
        (meIn ? " — em đã tham gia, chờ đủ người là bắt đầu ngay!" : "");
      if (!meIn) {
        joinBtn.classList.remove("hidden");
        joinBtn.disabled = joined >= total;
      }
    } else if (res.phase === "not_in") {
      titleEl.textContent = "Giải đấu \"" + (t.chapterName || t.chapter) + "\" đang diễn ra";
      subEl.textContent = "Em không có trong danh sách lượt này — cùng xem sơ đồ nhánh bên dưới nhé!";
    } else if (res.phase === "waiting_round") {
      statusBox.classList.add("win");
      titleEl.textContent = "✔ Em đã thắng vòng " + res.round + "!";
      subEl.textContent = "Đang chờ các cặp đấu khác kết thúc để lên vòng tiếp theo...";
    } else if (res.phase === "eliminated") {
      statusBox.classList.add("lose");
      titleEl.textContent = "😅 Em đã bị loại ở vòng " + res.round;
      subEl.textContent = "Thua bởi " + (res.opponent || "đối thủ") + " — cảm ơn em đã thi đấu hết mình!";
    } else if (res.phase === "champion") {
      statusBox.classList.add("champion");
      titleEl.textContent = "🏆 CHÚC MỪNG VÔ ĐỊCH!";
      subEl.textContent = "Em đã thắng tất cả các vòng của giải \"" + (t.chapterName || t.chapter) + "\" — quá đỉnh!";
    } else {
      // not_in / phase lạ khác (dự phòng) -> vẫn hiện được sơ đồ nhánh bên dưới, không chặn màn hình
      titleEl.textContent = "Giải đấu \"" + ((t && (t.chapterName || t.chapter)) || "") + "\"";
      subEl.textContent = "";
    }

    if (t && t.rounds && t.rounds.length) {
      bracketWrap.classList.remove("hidden");
      renderBracket(t);
    } else {
      bracketWrap.classList.add("hidden");
    }
  }

  function joinTournamentClick() {
    var name = $("#inp-name").value.trim();
    var pin = currentCode();
    if (!name || !accessVerified || currentTier !== "full") return;
    var btn = $("#btn-tournament-join");
    btn.disabled = true;
    apiPost({ action: "joinTournament", name: name, pin: pin }).then(function (res) {
      if (!res || !res.ok) {
        $("#tournament-status-sub").textContent = "Không tham gia được (" +
          ((res && res.error) || "lỗi") + "), thử lại nhé.";
        btn.disabled = false;
        return;
      }
      pollTournament();
    });
  }

  // ---------- Sơ đồ nhánh ----------
  function renderBracket(t) {
    var myNameLower = $("#inp-name").value.trim().toLowerCase();
    var box = $("#tournament-bracket");
    box.innerHTML = "";
    t.rounds.forEach(function (round, rIdx) {
      var col = el("div", "tour-round");
      var label = (rIdx === t.rounds.length - 1 && round.length === 1)
        ? "🏆 Chung kết"
        : "Vòng " + (rIdx + 1) + " (" + round.length + " cặp)";
      col.appendChild(el("div", "tour-round-title", escapeHtml(label)));
      round.forEach(function (m, mIdx) {
        // Vòng 1 của giải từ 8 người trở lên: chèn khoảng cách ở giữa để gợi ý rõ "2 nhánh đấu" cùng hội
        // tụ về chung kết (giống cách 1 sơ đồ giải đấu loại trực tiếp thường được vẽ).
        if (rIdx === 0 && round.length >= 4 && mIdx === Math.floor(round.length / 2)) {
          col.appendChild(el("div", "tour-round-half-gap"));
        }
        col.appendChild(renderTourMatchCard_(m, myNameLower));
      });
      box.appendChild(col);
    });
  }
  function renderTourMatchCard_(m, myNameLower) {
    var card = el("div", "tour-match");
    if (!m.p1 && !m.p2) {
      card.classList.add("empty");
      card.textContent = "Chờ xác định";
      return card;
    }
    card.appendChild(tourMatchPlayerRow_(m.p1, m, myNameLower));
    card.appendChild(el("div", "tour-match-vs", "vs"));
    card.appendChild(tourMatchPlayerRow_(m.p2, m, myNameLower));
    return card;
  }
  function tourMatchPlayerRow_(pname, m, myNameLower) {
    var cls = "tour-match-p";
    if (pname && m.winner) cls += (pname.trim().toLowerCase() === m.winner.trim().toLowerCase()) ? " winner" : " loser";
    if (pname && pname.trim().toLowerCase() === myNameLower) cls += " you";
    var row = el("div", cls);
    row.appendChild(el("span", "n", escapeHtml(pname || "?")));
    return row;
  }

  // ---------- Vào trận: sinh/nhận bộ câu hỏi rồi tải nội dung câu hỏi ----------
  function enterTourMatch_(res) {
    tourEnteringMatch = true;
    tourMatchId = res.matchId;
    tourOpponentName = res.opponent;
    tourRound = res.round; tourTotalRounds = res.totalRounds;
    quiz = { isTour: true, loading: true }; // chặn các lượt poll khác vào lại trong lúc đang tải bất đồng bộ

    var chapter = res.chapter, chapterName = res.chapterName;
    Promise.all([
      loadStaticQuestions(chapter).catch(function () { return []; }),
      apiGet({ action: "extra", chapter: chapter })
    ]).then(function (results) {
      var pool = (results[0] || []).concat((results[1] && results[1].questions) || []);
      var byId = {};
      pool.forEach(function (q) { byId[q.id] = q; });

      function proceedWithIds(questionIds) {
        var questions = questionIds.map(function (id) { return byId[id]; }).filter(Boolean);
        runTourMatch_(questions, chapter, chapterName);
      }

      if (res.questionIds && res.questionIds.length === TOUR_QUESTION_COUNT) {
        proceedWithIds(res.questionIds);
        return;
      }
      // Chưa ai đặt câu hỏi cho trận này -> CHÍNH MÌNH tự sinh ngẫu nhiên rồi gửi lên; nếu đối thủ gửi
      // trước thì dùng bộ của đối thủ (nguyên tắc "ai gửi trước thắng", giống hệt Đối đầu 1vs1).
      var ids = shuffle(pool).slice(0, TOUR_QUESTION_COUNT).map(function (q) { return q.id; });
      apiPost({
        action: "setTournamentMatchQuestions", name: $("#inp-name").value.trim(), pin: currentCode(),
        matchId: tourMatchId, questionIds: ids
      }).then(function (setRes) {
        proceedWithIds((setRes && setRes.questionIds) || ids);
      });
    });
  }

  function runTourMatch_(questions, chapter, chapterName) {
    tourEnteringMatch = false;
    quiz = { questions: questions, index: 0, isTour: true, chapter: chapter, chapterName: chapterName, finished: false };
    tourYou = { score: 0, correct: 0, wrong: 0 };
    tourOpp = { score: 0, correct: 0, wrong: 0, name: tourOpponentName };
    tourAnsweredLocally = false;
    show("#screen-quiz");
    $("#duel-score-box").classList.remove("hidden");
    $("#duel-timer-box").classList.remove("hidden");
    updateTourScoreDisplay();
    renderTourQuestion();
  }

  function updateTourScoreDisplay() {
    var youEl = $("#duel-score-you"), oppEl = $("#duel-score-opp");
    if (youEl) youEl.textContent = "Bạn: " + formatDuelScore(tourYou.score);
    if (oppEl) oppEl.textContent = (tourOpp.name || "Đối thủ") + ": " + formatDuelScore(tourOpp.score);
  }

  function renderTourQuestion() {
    var q = quiz.questions[quiz.index];
    $("#quiz-progress").textContent = "🏆 Vòng " + tourRound + " · Câu " + (quiz.index + 1) + "/" + quiz.questions.length;
    $("#progress-bar").style.width = Math.round((quiz.index / quiz.questions.length) * 100) + "%";
    $("#q-stem").innerHTML = q.stem;
    var optsBox = $("#q-options");
    optsBox.innerHTML = "";
    $("#q-feedback").className = "q-feedback hidden";
    $("#btn-report").classList.add("hidden");
    $("#btn-next").classList.add("hidden");
    tourAnsweredLocally = false;
    quiz.optOrder = shuffle(["A", "B", "C", "D"]);
    quiz.optOrder.forEach(function (letter) {
      var b = el("button", "opt-btn");
      b.innerHTML = '<span class="opt-label">' + letter + '</span><span>' + q.options[letter] + '</span>';
      b.addEventListener("click", function () { selectTourOption(letter, b); });
      optsBox.appendChild(b);
    });
    startTourAnswerCountdown();
  }

  function startTourAnswerCountdown() {
    clearTimeout(tourAnswerTimeoutTimer);
    var deadlineMs = Date.now() + DUEL_ANSWER_TIMEOUT_MS;
    var myIndex = quiz.index;
    (function tick() {
      if (!quiz || !quiz.isTour || quiz.finished || quiz.index !== myIndex) return;
      var remain = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
      var txt = $("#duel-timer-text");
      if (txt) txt.textContent = remain + "s";
      var box = $("#duel-timer-box");
      if (box) box.classList.toggle("urgent", remain <= 5);
      if (remain <= 0) {
        if (!tourAnsweredLocally) submitTourAnswerToServer(myIndex, "skip", false);
        return;
      }
      tourAnswerTimeoutTimer = setTimeout(tick, 250);
    })();
  }

  function selectTourOption(letter, btnEl) {
    if (tourAnsweredLocally) return;
    tourAnsweredLocally = true;
    clearTimeout(tourAnswerTimeoutTimer);
    var q = quiz.questions[quiz.index];
    var correct = letter === q.answer;
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) { b.disabled = true; });
    btnEl.classList.add("selected");
    submitTourAnswerToServer(quiz.index, "answer", correct);
  }

  function submitTourAnswerToServer(index, mode, correct) {
    apiPost({
      action: "submitTournamentAnswer", matchId: tourMatchId, name: $("#inp-name").value.trim(), pin: currentCode(),
      index: index, mode: mode, correct: !!correct
    }).then(function () { pollTournament(); }); // hỏi lại ngay để biết ai khóa được câu + điểm mới nhất
  }

  function showTourLockedFeedback(entry, iAnsweredThis, iWasCorrect) {
    var fb = $("#q-feedback");
    fb.classList.remove("hidden");
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b) { b.disabled = true; });
    if (!entry || entry.by === "timeout") {
      fb.textContent = "⏳ Hết giờ, không ai trả lời kịp — bỏ qua câu này, không ai được/mất điểm.";
      fb.className = "q-feedback";
      return;
    }
    var q = quiz.questions[quiz.index];
    document.querySelectorAll("#q-options .opt-btn").forEach(function (b, i) {
      var L = quiz.optOrder[i];
      if (L === q.answer) b.classList.add("correct");
      else if (b.classList.contains("selected") && iAnsweredThis && !iWasCorrect) b.classList.add("wrong");
    });
    if (iAnsweredThis) {
      fb.textContent = iWasCorrect
        ? "✔ Em nhanh tay và ĐÚNG! +1 điểm."
        : "✘ Em nhanh tay nhưng bị SAI, đáp án đúng là " + q.answer + ". −0,5 điểm.";
      fb.className = "q-feedback " + (iWasCorrect ? "correct" : "wrong");
    } else {
      var oppLabel = (tourOpp && tourOpp.name) || "Đối thủ";
      fb.textContent = entry.correct
        ? "⚡ " + oppLabel + " bấm trước và ĐÚNG rồi! Đáp án đúng là " + q.answer + "."
        : "⚡ " + oppLabel + " bấm trước nhưng bị SAI. Đáp án đúng là " + q.answer + ".";
      fb.className = "q-feedback";
    }
  }

  // ---------- Cập nhật liên tục trong lúc thi đấu (điểm, câu vừa bị khóa, chuyển sang oẳn tù tì) ----------
  function updateTourBattleFromPoll(res) {
    if (!quiz || quiz.loading || quiz.finished) return;
    var prevYouAnswered = tourYou.correct + tourYou.wrong;
    var prevYouCorrect = tourYou.correct;
    tourYou = res.you;
    tourOpp = { score: res.opp.score, correct: res.opp.correct, wrong: res.opp.wrong, name: tourOpponentName };
    updateTourScoreDisplay();

    if (res.phase === "tie_break") {
      if (quiz.tourLocalPhase !== "tie_break") {
        quiz.tourLocalPhase = "tie_break";
        clearTimeout(tourAnswerTimeoutTimer);
        show("#screen-duel-rps");
      }
      renderTourRpsState(res.rps);
      return;
    }
    // quiz.tourAdvancePending chống trường hợp NHIỀU lượt poll chồng lấn (poll mỗi ~1 giây trong khi phải
    // đợi 1200ms để học sinh kịp đọc phản hồi "đúng/sai") cùng lúc lên lịch nhiều setTimeout tranh nhau ghi
    // đè quiz.index — nếu không chặn, câu hỏi có thể bị "nhảy cóc" thẳng tới câu cuối (hoặc tệ hơn là bị
    // giật lùi lại câu trước) mỗi khi 1 bên trả lời liên tiếp nhiều câu nhanh trong lúc bên kia chỉ đang xem.
    if (res.index > quiz.index && !quiz.tourAdvancePending) {
      var iAnsweredThis = (res.you.correct + res.you.wrong) > prevYouAnswered;
      var iWasCorrect = res.you.correct > prevYouCorrect;
      showTourLockedFeedback(res.qstate[quiz.index], iAnsweredThis, iWasCorrect);
      clearTimeout(tourAnswerTimeoutTimer);
      var nextIndex = res.index;
      quiz.tourAdvancePending = true;
      setTimeout(function () {
        if (!quiz || !quiz.isTour || quiz.finished) return;
        quiz.tourAdvancePending = false;
        quiz.index = nextIndex;
        if (quiz.index < quiz.questions.length) renderTourQuestion();
      }, 1200);
    }
  }

  function renderTourRpsState(rps) {
    if (!rps) return;
    var choseAlready = !!rps.yourChoice;
    document.querySelectorAll(".duel-rps-btn").forEach(function (b) {
      b.disabled = choseAlready;
      b.classList.toggle("selected", choseAlready && b.getAttribute("data-choice") === rps.yourChoice);
    });
    $("#duel-rps-info").textContent = rps.round > 1
      ? "Ra kèo giống nhau, chơi lại! (Vòng " + rps.round + ")"
      : "Bằng điểm nhau! Ai thắng ván Oẳn tù tì này sẽ thắng chung cuộc.";
    var msgEl = $("#duel-rps-msg");
    var revealEl = $("#duel-rps-reveal");
    if (!choseAlready) {
      msgEl.textContent = "";
      revealEl.classList.add("hidden");
      return;
    }
    if (!rps.opponentChoice) {
      msgEl.textContent = "Em đã chọn " + DUEL_RPS_LABELS[rps.yourChoice] + " — đang chờ đối thủ chọn...";
      revealEl.classList.add("hidden");
    } else {
      msgEl.textContent = "";
      revealEl.classList.remove("hidden");
      revealEl.innerHTML = "Em: <b>" + DUEL_RPS_LABELS[rps.yourChoice] + "</b> &nbsp;—&nbsp; Đối thủ: <b>" +
        DUEL_RPS_LABELS[rps.opponentChoice] + "</b>";
    }
  }
  function chooseTourRps(choice) {
    apiPost({
      action: "submitTournamentRps", matchId: tourMatchId, name: $("#inp-name").value.trim(), pin: currentCode(), choice: choice
    }).then(function () { pollTournament(); });
  }

  // ---------- Rời trận (trận vừa xong, hoặc thoát giữa chừng) -> quay về màn hub ----------
  function exitTourBattleToHub_() {
    quiz = null;
    clearTimeout(tourAnswerTimeoutTimer); tourAnswerTimeoutTimer = null;
    $("#duel-score-box").classList.add("hidden");
    $("#duel-timer-box").classList.add("hidden");
    show("#screen-tournament");
    refreshLeaderboard();
    refreshEloLeaderboard();
    refreshProfile(); // trận giải đấu cũng tính vào chuỗi ngày luyện tập + tiến độ chương, cập nhật lại luôn
  }
  // Thoát giữa chừng: không có "nộp bài" riêng, mỗi câu đã tự ghi nhận ngay khi bị khóa — thoát coi như bỏ
  // cuộc, đối thủ cứ tiếp tục bấm là tự thắng các câu còn lại (thua ở giải đấu = bị loại luôn).
  function exitTourMidMatch(confirmMsg) {
    if (!confirm(confirmMsg)) return false;
    if (quiz) quiz.finished = true;
    exitTourBattleToHub_();
    return true;
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

  // ---------- Bảng ELO (đẳng cấp cộng dồn vĩnh viễn, không reset hàng tuần) ----------
  function refreshEloLeaderboard() {
    if (!API_URL) {
      renderLeaderboardList("#leaderboard-elo-list", "#leaderboard-elo-empty", null, "elo");
      $("#leaderboard-elo-offline").classList.remove("hidden");
      return;
    }
    $("#leaderboard-elo-offline").classList.add("hidden");
    apiGet({ action: "eloLeaderboard" }).then(function (res) {
      lastEloLeaderboardData = res || null;
      renderLeaderboardList("#leaderboard-elo-list", "#leaderboard-elo-empty", res && res.leaderboard, "elo");
    });
  }

  // ---------- Init ----------
  function init() {
    if (!CARDS_ENABLED) {
      var collectionBtn = $("#btn-open-collection");
      if (collectionBtn) collectionBtn.classList.add("hidden");
    }
    startLeaderboardPolling();

    fetch("data/manifest.json").then(function (r) { return r.json(); }).then(function (m) {
      manifest = m;
      populateGrades();
      populateChapters();
      refreshRandomControls(); // nút "Bắt đầu làm bài" của Chế độ ngẫu nhiên cần manifest đã tải xong

      var savedName = localStorage.getItem("hs_ten");
      if (savedName) $("#inp-name").value = savedName;
      var savedCode = localStorage.getItem("hs_code");
      if (savedCode) $("#inp-code").value = savedCode;
      if (savedName) maybeVerifyAccess(); // tự xác minh luôn nếu trình duyệt đã nhớ tên từ lần trước (kể cả khách, không có mã)

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
        accessVerified = false;
        currentTier = null;
        guestLimits = null;
        $("#access-msg").textContent = "";
        $("#access-msg").className = "msg";
        validateStart();
        refreshDuelControls();
        refreshRandomControls();
        renderLeaderboard(lastLeaderboardData); // chỉ để cập nhật highlight "của em", không gọi lại API
        debouncedMaybeVerifyAccess();
      });
      $("#inp-code").addEventListener("input", function () {
        localStorage.setItem("hs_code", $("#inp-code").value.trim());
        accessVerified = false;
        currentTier = null;
        guestLimits = null;
        validateStart();
        refreshDuelControls();
        refreshRandomControls();
        debouncedMaybeVerifyAccess();
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
      if (quiz && quiz.isDuel && !quiz.finished) {
        exitDuelMidMatch("Thoát trận đối đầu? Đối thủ sẽ tự thắng các câu còn lại vì em không trả lời nữa.");
        return;
      }
      if (quiz && quiz.isTour && !quiz.finished) {
        exitTourMidMatch("Thoát trận giải đấu? Đối thủ sẽ tự thắng các câu còn lại vì em không trả lời nữa — nếu thua, em sẽ bị loại khỏi giải.");
        return;
      }
      if (confirm("Thoát làm bài? Kết quả lần này sẽ không được lưu.")) { stopRandomTimer_(); show("#screen-setup"); }
    });
    $("#btn-restart").addEventListener("click", function () {
      show("#screen-setup");
      refreshExtraQuestions();
      refreshStats();
    });

    // ---- Chế độ Đối đầu 1vs1 ----
    $("#tab-mode-solo").addEventListener("click", function () { setAppMode("solo"); });
    $("#tab-mode-duel").addEventListener("click", function () { setAppMode("duel"); });
    $("#tab-mode-random").addEventListener("click", function () { setAppMode("random"); });
    $("#btn-start-random").addEventListener("click", startRandomQuiz);
    $("#btn-challenge").addEventListener("click", startChallenge);
    $("#btn-accept-challenge").addEventListener("click", openAcceptChallengeScreen);
    $("#btn-cancel-wait").addEventListener("click", cancelDuelWait);
    $("#btn-pick-back").addEventListener("click", function () {
      clearDuelTimers();
      show("#screen-setup");
    });
    $("#btn-duel-restart").addEventListener("click", exitDuelResult);
    document.querySelectorAll(".duel-rps-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var choice = b.getAttribute("data-choice");
        if (quiz && quiz.isTour) chooseTourRps(choice); else chooseDuelRps(choice);
      });
    });
    $("#btn-rps-quit").addEventListener("click", function () {
      if (quiz && quiz.isTour) {
        exitTourMidMatch("Thoát khi đang oẳn tù tì? Đối thủ sẽ được xử thắng luôn — em sẽ bị loại khỏi giải.");
        return;
      }
      exitDuelMidMatch("Thoát khi đang oẳn tù tì? Đối thủ sẽ được xử thắng luôn.");
    });

    // ---- Bộ sưu tập thẻ bài ----
    $("#btn-open-collection").addEventListener("click", openCollectionScreen);
    $("#btn-collection-back").addEventListener("click", function () { show("#screen-setup"); });
    $("#btn-card-toast-next").addEventListener("click", function () {
      cardToastQueue.shift();
      playNextCardToast();
    });

    // ---- Giải đấu WorldCup ----
    $("#btn-open-tournament").addEventListener("click", openTournamentScreen);
    $("#btn-tournament-back").addEventListener("click", function () {
      stopTournamentPolling();
      show("#screen-setup");
    });
    $("#btn-tournament-join").addEventListener("click", joinTournamentClick);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
