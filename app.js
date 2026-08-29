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
        refreshStats();
      } else {
        pinVerified = false;
        msgEl.textContent = (res && res.error === "wrong_pin")
          ? "✘ Sai mã cho tên này. Nếu đây là tên của em, hãy nhập đúng mã cũ. Nếu trùng tên bạn khác, hãy đổi cách viết tên (ví dụ thêm tên lớp)."
          : "✘ Không xác minh được, thử lại.";
        msgEl.className = "msg pin-err";
      }
      validateStart();
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
      var scoreHtml = kind === "count"
        ? item.totalDone + " câu"
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
    setInterval(function () {
      if (document.visibilityState === "visible") refreshLeaderboard();
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

    apiPost({
      action: "submit",
      name: name,
      chapter: chap,
      pin: currentPin(),
      mode: quiz.mode,
      results: quiz.answers
    }).then(function () {
      refreshLeaderboard(); // "ngay khi có sự thay đổi" cho chính học sinh vừa nộp bài
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

    var resultStatsBox = $("#result-stats");
    resultStatsBox.classList.remove("hidden");
    resultStatsBox.innerHTML = "Đang cập nhật tiến độ...";
    apiGet({ action: "stats", name: name, chapter: chap, pin: currentPin() }).then(function (res) {
      if (!res || res.error || !res.attempts) {
        resultStatsBox.classList.add("hidden");
        resultStatsBox.innerHTML = "";
        return;
      }
      var last5 = res.last5 || [];
      resultStatsBox.innerHTML =
        "Tổng số câu đã làm ở chương này: <b>" + res.totalDone + "</b><br>" +
        "Tỉ lệ đúng " + last5.length + " lần gần nhất: <b>" +
        last5.map(function (p) { return p + "%"; }).join(" · ") + "</b>";
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
        renderLeaderboard(lastLeaderboardData); // chỉ để cập nhật highlight "của em", không gọi lại API
        debouncedMaybeVerifyPin();
      });
      $("#inp-pin").addEventListener("input", function () {
        var digits = $("#inp-pin").value.replace(/\D/g, "").slice(0, 4);
        $("#inp-pin").value = digits;
        localStorage.setItem("hs_pin", digits);
        pinVerified = false;
        validateStart();
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
      if (confirm("Thoát làm bài? Kết quả lần này sẽ không được lưu.")) show("#screen-setup");
    });
    $("#btn-restart").addEventListener("click", function () {
      show("#screen-setup");
      refreshExtraQuestions();
      refreshStats();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
