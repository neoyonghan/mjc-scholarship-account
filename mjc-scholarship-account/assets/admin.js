"use strict";
/* ---------- 관리자 화면 ---------- */
applyTitle();
if (!configOK()) { showConfigBanner(); $("#lgBtn").disabled = true; }
CONFIG.PAY_TYPES.forEach(p => { $("#fPay").add(new Option(p, p)); $("#pgType").add(new Option(p, p)); });

const IDLE_MS = (CONFIG.IDLE_MINUTES || 15) * 60 * 1000;
let lastAct = Date.now();
let all = [], current = [], byStu = new Map(), programs = [], editingProg = null, teamsAll = [];

async function addLog(action, detail = "") {
  try { await SB.insert("admin_logs", { action, detail: String(detail).slice(0, 300) }); } catch (e) { console.warn("log", e); }
}

/* ---------- 로그인 ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#lgEmail").value.trim(), pw = $("#lgPw").value, msg = $("#lgMsg");
  msg.textContent = "";
  if (!email || !pw) { msg.textContent = "이메일과 비밀번호를 입력하세요."; return; }
  $("#lgBtn").disabled = true;
  try {
    await SB.signIn(email, pw);
    const isAdmin = await SB.rpc("is_admin");
    if (isAdmin !== true) { await SB.signOut(); msg.textContent = "관리자 권한이 없는 계정입니다."; return; }
    $("#lgPw").value = ""; lastAct = Date.now();
    await addLog("로그인");
    enterAdmin();
  } catch (err) {
    const c = String(err.code || "");
    msg.textContent =
        c === "invalid_credentials" ? "이메일 또는 비밀번호가 올바르지 않습니다."
      : c === "email_not_confirmed" ? "이메일 확인(Confirm)이 안 된 계정입니다. Supabase에서 사용자 확인 처리가 필요합니다."
      : c === "email_provider_disabled" ? "Supabase에서 이메일 로그인이 꺼져 있습니다. Authentication → Sign In / Providers → Email을 켜세요."
      : c === "user_banned" ? "사용이 정지된 계정입니다."
      : err.status === 429 || c === "over_request_rate_limit" ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."
      : /api ?key/i.test(err.message) ? "assets/config.js 의 SUPABASE_KEY(공개 키)가 올바르지 않습니다."
      : err instanceof TypeError ? "Supabase에 연결할 수 없습니다. assets/config.js 의 SUPABASE_URL을 확인하세요."
      : err.status === 400 ? "이메일 또는 비밀번호가 올바르지 않습니다."
      : "로그인하지 못했습니다. (" + (c ? c + ": " : "") + err.message + ")";
    console.warn("login error", err.status, c, err.message);
  } finally { $("#lgBtn").disabled = !configOK(); }
});

function enterAdmin() {
  $("#whoami").textContent = SB.user ? SB.user.email : "";
  $("#idleHint").textContent = `(${CONFIG.IDLE_MINUTES || 15}분간 사용하지 않으면 자동 로그아웃)`;
  $("#loginBox").classList.add("hidden");
  $("#adminBox").classList.remove("hidden");
  load();
}

async function logout(reason) {
  if (!SB.loggedIn) return;
  await addLog("로그아웃", reason || "");
  await SB.signOut();
  all = current = []; byStu = new Map();
  $("#rows").innerHTML = ""; $("#logRows").innerHTML = "";
  $$(".modal-bg").forEach(m => m.remove());
  $("#adminBox").classList.add("hidden");
  $("#loginBox").classList.remove("hidden");
  if (reason) toast(reason, 4000);
}
$("#logoutBtn").onclick = () => logout();
["click", "keydown", "mousemove", "scroll", "touchstart"].forEach(ev =>
  document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
setInterval(() => { if (SB.loggedIn && Date.now() - lastAct > IDLE_MS) logout("장시간 사용하지 않아 자동 로그아웃되었습니다."); }, 30000);
window.addEventListener("beforeunload", () => { if (SB.loggedIn) SB.signOut(); });

function handleAuthError(err) {
  if (err && (err.status === 401 || /jwt/i.test(err.message))) { logout("로그인이 만료되었습니다. 다시 로그인하세요."); return true; }
  return false;
}

$("#pwBtn").onclick = () => {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="max-width:380px"><h3>비밀번호 변경</h3>
    <input type="password" id="cpNew" placeholder="새 비밀번호 (10자 이상)" autocomplete="new-password" style="margin-bottom:8px">
    <input type="password" id="cpNew2" placeholder="새 비밀번호 확인" autocomplete="new-password" style="margin-bottom:8px">
    <div class="hint">영문·숫자·특수문자를 섞어 10자 이상 권장</div>
    <div class="actions" style="margin-top:14px"><button class="btn ghost" id="cpCancel">취소</button><button class="btn pri" id="cpOk">변경</button></div></div>`;
  document.body.append(bg); $("#cpNew", bg).focus();
  $("#cpCancel", bg).onclick = () => bg.remove();
  $("#cpOk", bg).onclick = async () => {
    const n = $("#cpNew", bg).value;
    if (n.length < 10) return toast("10자 이상 입력하세요.");
    if (n !== $("#cpNew2", bg).value) return toast("비밀번호 확인이 일치하지 않습니다.");
    try { await SB.updatePassword(n); await addLog("비밀번호 변경"); bg.remove(); toast("비밀번호가 변경되었습니다."); }
    catch (err) { if (!handleAuthError(err)) toast("변경하지 못했습니다: " + err.message, 4000); }
  };
};

/* ---------- 조회 ---------- */
async function load() {
  $("#prog").textContent = "불러오는 중…";
  try {
    all = await SB.selectAll("applications", "select=*&order=created_at.desc");
  } catch (err) { $("#prog").textContent = ""; if (!handleAuthError(err)) toast("불러오지 못했습니다: " + err.message, 4000); return; }
  // 학번별 묶기(최근순) + 계좌 변경 여부
  byStu = new Map();
  for (const r of all) { if (!byStu.has(r.stu_id)) byStu.set(r.stu_id, []); byStu.get(r.stu_id).push(r); }
  for (const list of byStu.values()) {
    list.forEach((r, i) => {
      r._latest = i === 0;
      r._count = list.length;
      const prev = list[i + 1];
      r._acctChanged = !!prev && (digits(prev.account) !== digits(r.account) || prev.bank !== r.bank);
    });
  }
  $("#prog").textContent = "";
  await loadPrograms();
  render(); loadLogs();
}
$("#reloadBtn").onclick = load;

function render() {
  const latest = all.filter(r => r._latest);
  $("#sStu").textContent = byStu.size;
  $("#sAll").textContent = all.length;
  $("#sWait").textContent = latest.filter(r => r.status === "접수").length;
  $("#sChg").textContent = latest.filter(r => r._acctChanged).length;

  const q = $("#q").value.trim().toLowerCase(), fp = $("#fPay").value, fs = $("#fStatus").value, fg = $("#fProg").value,
        f1 = $("#fFrom").value, f2 = $("#fTo").value, onlyLatest = $("#fLatest").checked, onlyChg = $("#fChg").checked;
  current = all.filter(r => (!onlyLatest || r._latest) && (!onlyChg || r._acctChanged)
    && (!fp || r.pay_type === fp) && (!fs || r.status === fs)
    && (!fg || (fg === "__none" ? !r.program_id : r.program_id === fg))
    && (!f1 || loc(r.created_at).slice(0, 10) >= f1) && (!f2 || loc(r.created_at).slice(0, 10) <= f2)
    && (!q || [r.name, r.stu_id, r.dept, r.email, r.team].join(" ").toLowerCase().includes(q)));
  $("#cnt").textContent = current.length;
  const stTag = s => `<span class="tag ${s === "확인완료" ? "okk" : s === "반려" ? "rej" : "wait"}">${esc(s)}</span>`;
  $("#rows").innerHTML = current.length ? current.map(r => `<tr>
    <td>${stTag(r.status)}</td>
    <td><b>${esc(r.name)}</b>${r.team ? ` <small class="tag soon">${esc(r.team)}</small>` : ""}${r.email ? `<br><small style="color:var(--sub)">${esc(r.email)}</small>` : ""}</td>
    <td>${esc(r.stu_id)}</td>
    <td>${esc(r.dept)}</td>
    <td>${esc(r.pay_type)}${r.program ? `<br><small style="color:var(--sub)">${esc(r.program)}</small>` : ""}</td>
    <td>${esc(r.bank)}<br><small style="color:var(--sub)">${esc(maskAcc(r.account))}</small></td>
    <td>${r.bank_doc_path ? "제출" : "-"}</td>
    <td>${loc(r.created_at).slice(0, 10)}</td>
    <td>${r._acctChanged ? '<span class="tag chg">계좌변경</span>' : ""}${r._count > 1 ? ` <small class="hint">${r._count}회 신청</small>` : ""}</td>
    <td><button class="btn ghost sm" data-view="${esc(r.id)}">상세</button></td></tr>`).join("")
    : `<tr><td colspan="10" class="empty">조회된 신청내역이 없습니다.</td></tr>`;
}
["q", "fPay", "fStatus", "fProg", "fFrom", "fTo", "fLatest", "fChg"].forEach(id => $("#" + id).addEventListener("input", render));
$("#fReset").onclick = () => {
  ["q", "fPay", "fStatus", "fProg", "fFrom", "fTo"].forEach(id => $("#" + id).value = "");
  $("#fLatest").checked = true; $("#fChg").checked = false; render();
};

async function loadLogs() {
  try {
    const logs = await SB.select("admin_logs", "select=at,admin_email,action,detail&order=at.desc&limit=100");
    $("#logRows").innerHTML = logs.map(l => `<tr><td>${loc(l.at)}</td><td>${esc(l.admin_email)}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">기록 없음</td></tr>`;
  } catch (err) { handleAuthError(err); }
}

/* ---------- 상세 ---------- */
const extOf = p => (p.match(/\.[a-z]+$/) || [".bin"])[0];
const safeName = s => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_");
const personKey = r => safeName(`${r.stu_id}_${r.name}`);
function saveBlob(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$("#rows").addEventListener("click", async e => {
  const id = e.target.dataset.view; if (!id) return;
  const r = all.find(x => x.id === id); if (!r) return;
  const hist = byStu.get(r.stu_id) || [r];
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h3>${esc(r.name)} <small class="hint">${esc(r.stu_id)} · 접수번호 ${esc(r.id.slice(0, 8).toUpperCase())}</small></h3>
    <dl class="kv">
      <dt>지급 구분</dt><dd>${esc(r.pay_type)}${r.program ? " · " + esc(r.program) : ""}</dd>
      <dt>팀명</dt><dd>${esc(r.team) || "-"}</dd>
      <dt>학과 / 학년</dt><dd>${esc(r.dept)} ${r.grade ? esc(r.grade) + "학년" : ""}</dd>
      <dt>이메일</dt><dd>${esc(r.email) || "-"}</dd><dt>연락처</dt><dd>${esc(r.phone)}</dd>
      <dt>은행</dt><dd>${esc(r.bank)}</dd><dt>계좌번호</dt><dd>${esc(r.account)}</dd><dt>예금주</dt><dd>${esc(r.holder)}</dd>
      <dt>신청일시</dt><dd>${loc(r.created_at).slice(0, 16)}</dd>
    </dl>
    ${hist.length > 1 ? `<div class="notice warn" style="margin-bottom:6px">이 학번으로 ${hist.length}회 신청되었습니다. 계좌가 바뀐 경우 본인 확인 후 처리하세요.</div>
      <table class="hist"><tr><th>신청일시</th><th>은행 · 계좌</th><th>예금주</th><th>상태</th></tr>
      ${hist.map(h => `<tr class="${h.id === r.id ? "cur" : ""}"><td>${loc(h.created_at).slice(0, 16)}</td><td>${esc(h.bank)} ${esc(h.account)}</td><td>${esc(h.holder)}</td><td>${esc(h.status)}</td></tr>`).join("")}</table>` : ""}
    <div class="docs">
      <figure id="fig-bank">${r.bank_doc_path ? '<div class="empty" style="padding:30px 0">불러오는 중…</div>' : '<div class="empty" style="padding:30px 0">미제출</div>'}<figcaption>통장사본</figcaption></figure>
    </div>
    <div class="grid" style="margin-top:16px">
      <div class="f"><label>처리 상태</label>
        <select id="stSel">${["접수", "확인완료", "반려"].map(s => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="f"><label>관리자 메모</label><input type="text" id="memo" maxlength="300" value="${esc(r.admin_memo || "")}"></div>
    </div>
    <div class="actions" style="margin-top:18px">
      <button class="btn danger" id="delBtn">삭제</button>
      <button class="btn ghost" id="closeBtn">닫기</button>
      <button class="btn pri" id="saveBtn">상태 저장</button>
    </div>
  </div>`;
  document.body.append(bg);
  const urls = [];
  const close = () => { urls.forEach(u => URL.revokeObjectURL(u)); bg.remove(); };
  bg.addEventListener("click", ev => { if (ev.target === bg) close(); });
  $("#closeBtn", bg).onclick = close;

  // 첨부파일 불러오기(관리자 토큰으로만 열람 가능)
  const show = async (path, figSel, cap) => {
    const fig = $(figSel, bg); if (!path) return;
    try {
      const blob = await SB.download(CONFIG.BUCKET, path);
      const u = URL.createObjectURL(blob); urls.push(u);
      const name = `${personKey(r)}_${cap}${extOf(path)}`;
      fig.innerHTML = (blob.type.startsWith("image/") ? `<img src="${u}" alt="${cap}">` : `<div style="font-size:40px;padding:20px 0">📄</div>`)
        + `<figcaption>${cap} · <a href="#" data-dl>내려받기</a></figcaption>`;
      $("[data-dl]", fig).onclick = ev => { ev.preventDefault(); saveBlob(blob, name); addLog("첨부서류 다운로드", `${r.stu_id} ${r.name} - ${cap}`); };
    } catch (err) { if (!handleAuthError(err)) fig.innerHTML = `<div class="empty" style="padding:30px 0">불러오기 실패</div><figcaption>${cap}</figcaption>`; }
  };
  show(r.bank_doc_path, "#fig-bank", "통장사본");
  addLog("상세 조회", `${r.stu_id} ${r.name}`);

  $("#saveBtn", bg).onclick = async () => {
    const status = $("#stSel", bg).value, memo = $("#memo", bg).value.trim();
    try {
      await SB.update("applications", "id=eq." + encodeURIComponent(r.id), { status, admin_memo: memo || null });
      await addLog("상태 변경", `${r.stu_id} ${r.name}: ${r.status} → ${status}`);
      r.status = status; r.admin_memo = memo; render(); close(); toast("저장되었습니다.");
    } catch (err) { if (!handleAuthError(err)) toast("저장하지 못했습니다: " + err.message, 4000); }
  };
  $("#delBtn", bg).onclick = async () => {
    if (!(await askConfirm(`${r.name}(${r.stu_id}) 님의 이 신청 건과 통장 사본을 삭제합니다.\n되돌릴 수 없습니다.`, "삭제"))) return;
    try {
      if (r.bank_doc_path) await SB.removeFiles(CONFIG.BUCKET, [r.bank_doc_path]);
      await SB.remove("applications", "id=eq." + encodeURIComponent(r.id));
      await addLog("신청 삭제", `${r.stu_id} ${r.name} (${r.id.slice(0, 8)})`);
      close(); toast("삭제되었습니다."); load();
    } catch (err) { if (!handleAuthError(err)) toast("삭제하지 못했습니다: " + err.message, 4000); }
  };
});

/* ---------- 다운로드 ---------- */
const today = () => loc(new Date().toISOString()).slice(0, 10).replace(/-/g, "");
function chooseOptions(title, withAccount) {
  return new Promise(res => {
    const filtered = current.length !== all.length;
    const bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal" style="max-width:440px"><h3>${title}</h3>
      <label style="margin-top:4px">다운로드 범위</label>
      <div class="seg" style="flex-direction:column;gap:8px">
        <label><input type="radio" name="scope" value="cur" checked><div>현재 조회 결과<small>${current.length}건${filtered ? " (검색·필터 적용)" : ""}</small></div></label>
        <label><input type="radio" name="scope" value="all"><div>전체 신청내역<small>${all.length}건 (변경 전 신청 포함)</small></div></label>
      </div>
      ${withAccount ? `<label style="margin-top:14px">계좌번호</label>
      <div class="seg"><label><input type="radio" name="acc" value="full" checked><div>전체 표시<small>이체 작업용</small></div></label>
      <label><input type="radio" name="acc" value="mask"><div>일부 가림<small>보고·공유용</small></div></label></div>` : ""}
      <div class="notice warn" style="margin-top:14px">내려받은 파일에는 개인정보가 들어 있습니다. 업무용 PC에만 저장하고 사용 후 삭제하세요. 다운로드 기록이 남습니다.</div>
      <div class="actions"><button class="btn ghost" id="dCancel">취소</button><button class="btn pri" id="dOk">다운로드</button></div></div>`;
    document.body.append(bg);
    $("#dCancel", bg).onclick = () => { bg.remove(); res(null); };
    $("#dOk", bg).onclick = () => {
      const scope = $("input[name=scope]:checked", bg).value;
      const mask = withAccount && $("input[name=acc]:checked", bg).value === "mask";
      bg.remove(); res({ list: scope === "all" ? all : current, scope, mask });
    };
  });
}
const XL_HEAD = ["번호", "상태", "지급구분", "사업·대회명", "학번", "성명", "팀명", "학과(전공)", "학년", "연락처", "이메일",
                 "은행명", "계좌번호", "예금주", "통장사본", "신청일시", "비고", "관리자 메모", "접수번호"];
const XL_W = [6, 9, 10, 26, 12, 10, 16, 28, 6, 15, 26, 14, 20, 10, 9, 17, 14, 24, 11];
const toRow = (r, i, mask) => [i + 1, r.status, r.pay_type, r.program, r.stu_id, r.name, r.team, r.dept, r.grade, r.phone, r.email,
  r.bank, mask ? maskAcc(r.account) : r.account, r.holder, r.bank_doc_path ? "제출" : "미제출",
  loc(r.created_at).slice(0, 16), (r._acctChanged ? "계좌변경 " : "") + (r._count > 1 ? `${r._count}회 신청` : ""), r.admin_memo,
  r.id.slice(0, 8).toUpperCase()];

$("#xlsxBtn").onclick = async () => {
  if (!all.length) return toast("신청내역이 없습니다.");
  const opt = await chooseOptions("신청내역 엑셀 다운로드", true); if (!opt) return;
  if (!opt.list.length) return toast("다운로드할 내역이 없습니다.");
  saveBlob(makeXlsx("신청내역", XL_HEAD, opt.list.map((r, i) => toRow(r, i, opt.mask)), XL_W), `장학금수당_계좌신청내역_${today()}.xlsx`);
  await addLog("엑셀 다운로드", `${opt.list.length}건 · ${opt.scope === "all" ? "전체" : "조회결과"} · 계좌번호 ${opt.mask ? "가림" : "전체"}`);
  loadLogs();
};

$("#attachZipBtn").onclick = async () => {
  if (!all.length) return toast("신청내역이 없습니다.");
  const opt = await chooseOptions("통장 사본 일괄 다운로드(ZIP)", false); if (!opt) return;
  const jobs = [];
  opt.list.forEach(r => {
    const k = `${personKey(r)}_${r.id.slice(0, 8)}`;
    if (r.bank_doc_path) jobs.push({ path: r.bank_doc_path, name: `${k}/통장사본${extOf(r.bank_doc_path)}` });
  });
  if (!jobs.length) return toast("제출된 통장 사본이 없습니다.");
  const btn = $("#attachZipBtn"); btn.disabled = true;
  const files = []; let fail = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      $("#prog").textContent = `첨부서류 받는 중 ${i + 1}/${jobs.length}`;
      try { files.push({ name: jobs[i].name, data: new Uint8Array(await (await SB.download(CONFIG.BUCKET, jobs[i].path)).arrayBuffer()) }); }
      catch (err) { if (handleAuthError(err)) return; fail++; }
    }
    const xl = makeXlsx("신청내역", XL_HEAD, opt.list.map((r, i) => toRow(r, i, false)), XL_W);
    files.unshift({ name: `신청내역_${today()}.xlsx`, data: new Uint8Array(await xl.arrayBuffer()) });
    saveBlob(makeZip(files), `장학금수당_첨부서류_${today()}.zip`);
    await addLog("통장사본 ZIP 다운로드", `${opt.list.length}건 · 파일 ${files.length - 1}개${fail ? ` · 실패 ${fail}` : ""} · ${opt.scope === "all" ? "전체" : "조회결과"}`);
    if (fail) toast(`${fail}개 파일을 받지 못했습니다.`, 4000);
    loadLogs();
  } finally { btn.disabled = false; $("#prog").textContent = ""; }
};


/* ---------- 하위 탭 ---------- */
$$(".subtabs button").forEach(b => b.addEventListener("click", () => {
  $$(".subtabs button").forEach(x => x.classList.toggle("on", x === b));
  $("#sub-apps").classList.toggle("hidden", b.dataset.sub !== "apps");
  $("#sub-progs").classList.toggle("hidden", b.dataset.sub !== "progs");
}));

/* ---------- 사업·대회 관리 ---------- */
async function loadPrograms() {
  try { programs = await SB.select("programs", "select=*&order=created_at.desc"); }
  catch (err) { if (!handleAuthError(err)) toast("사업·대회 목록을 불러오지 못했습니다.", 4000); programs = []; }
  try { teamsAll = await SB.selectAll("teams", "select=id,program_id,college,dept,name&order=name.asc"); }
  catch (err) { console.warn(err); teamsAll = []; }
  const tcount = id => teamsAll.filter(t => t.program_id === id).length;
  const count = id => all.filter(r => r.program_id === id).length;
  const stTag = st => `<span class="tag ${st === "모집중" ? "okk" : st === "예정" ? "soon" : "wait"}">${st}</span>`;
  $("#progRows").innerHTML = programs.length ? programs.map(p => {
    const st = programState(p);
    return `<tr class="${editingProg === p.id ? "editing" : ""}"><td>${stTag(st)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.pay_type)}</td>
      <td>${esc(periodText(p))}</td>
      <td><button class="btn ghost sm" data-pteams="${esc(p.id)}">${tcount(p.id) ? `팀 목록 ${tcount(p.id)}` : "팀 등록"}</button></td>
      <td>${count(p.id)}건</td>
      <td><div class="rowbtns">
        <button class="btn ghost sm" data-pedit="${esc(p.id)}">수정</button>
        <button class="btn ghost sm" data-ptoggle="${esc(p.id)}">${p.active ? "마감" : "재개"}</button>
        <button class="btn danger sm" data-pdel="${esc(p.id)}">삭제</button>
      </div></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">등록된 사업·대회가 없습니다. 위에서 등록하세요.</td></tr>`;
  const open = programs.filter(p => programState(p) === "모집중").length;
  $("#progCnt").textContent = programs.length ? `(모집중 ${open})` : "";
  const keep = $("#fProg").value, sel = $("#fProg");
  sel.length = 1;
  programs.forEach(p => sel.add(new Option(p.name, p.id)));
  sel.add(new Option("(사업·대회 없이 신청)", "__none"));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
}

function resetProgForm() {
  editingProg = null;
  $("#progForm").reset(); $("#pgSave").textContent = "등록"; $("#pgCancel").classList.add("hidden");
  $$("#progRows tr.editing").forEach(tr => tr.classList.remove("editing"));
}
$("#pgCancel").onclick = resetProgForm;

$("#progForm").addEventListener("submit", async e => {
  e.preventDefault();
  const row = { name: $("#pgName").value.trim(), pay_type: $("#pgType").value,
                start_date: $("#pgStart").value || null, end_date: $("#pgEnd").value || null };
  if (!row.name) return toast("사업·대회명을 입력하세요.");
  if (row.start_date && row.end_date && row.start_date > row.end_date) return toast("신청기간의 시작일이 마감일보다 늦습니다.");
  if (programs.some(p => p.name === row.name && p.id !== editingProg)) return toast("같은 이름의 사업·대회가 이미 있습니다.");
  $("#pgSave").disabled = true;
  try {
    if (editingProg) {
      const before = programs.find(p => p.id === editingProg);
      await SB.update("programs", "id=eq." + encodeURIComponent(editingProg), row);
      await addLog("사업·대회 수정", `${before ? before.name : ""} → ${row.name} (${periodText(row)})`);
      toast("수정했습니다. 이미 접수된 신청서의 사업명은 신청 당시 이름으로 남습니다.", 4500);
    } else {
      await SB.insert("programs", { ...row, active: true });
      await addLog("사업·대회 등록", `${row.name} · ${row.pay_type} · ${periodText(row)}`);
      toast("등록했습니다. 학생 화면에 바로 나타납니다.");
    }
    resetProgForm(); await loadPrograms(); render();
  } catch (err) { if (!handleAuthError(err)) toast("저장하지 못했습니다: " + err.message, 4000); }
  finally { $("#pgSave").disabled = false; }
});

$("#progRows").addEventListener("click", async e => {
  const t = e.target;
  if (t.dataset.pteams) { const p = programs.find(x => x.id === t.dataset.pteams); if (p) openTeams(p); return; }
  const id = t.dataset.pedit || t.dataset.ptoggle || t.dataset.pdel; if (!id) return;
  const p = programs.find(x => x.id === id); if (!p) return;
  if (t.dataset.pedit) {
    editingProg = id;
    $("#pgName").value = p.name; $("#pgType").value = p.pay_type;
    $("#pgStart").value = p.start_date || ""; $("#pgEnd").value = p.end_date || "";
    $("#pgSave").textContent = "수정 저장"; $("#pgCancel").classList.remove("hidden");
    $$("#progRows tr").forEach(tr => tr.classList.toggle("editing", tr.contains(t)));
    $("#pgName").focus(); window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  try {
    if (t.dataset.ptoggle) {
      await SB.update("programs", "id=eq." + encodeURIComponent(id), { active: !p.active });
      await addLog(p.active ? "사업·대회 마감" : "사업·대회 재개", p.name);
      toast(p.active ? "마감했습니다. 학생 화면에서 사라집니다." : "다시 모집합니다.");
    } else {
      if (all.some(r => r.program_id === id)) { toast("신청이 있는 사업·대회는 삭제할 수 없습니다. '마감'을 사용하세요.", 4500); return; }
      if (!(await askConfirm(`'${p.name}'을(를) 삭제합니다.`, "삭제"))) return;
      await SB.remove("programs", "id=eq." + encodeURIComponent(id));
      await addLog("사업·대회 삭제", p.name);
      toast("삭제했습니다.");
    }
    if (editingProg === id) resetProgForm();
    await loadPrograms(); render();
  } catch (err) {
    if (handleAuthError(err)) return;
    toast(err.code === "23503" ? "신청이 있는 사업·대회는 삭제할 수 없습니다. '마감'을 사용하세요." : "처리하지 못했습니다: " + err.message, 4500);
  }
});


/* ---------- 팀 목록 (사업·대회별) ---------- */
/* 엑셀에서 복사한 내용: 열 3개 = 학부·학과·팀명 / 2개 = 학과·팀명 / 1개 = 팀명. 제목 줄은 건너뜀 */
function parseTeams(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let c = line.includes("\t") ? line.split("\t") : line.split(",");
    c = c.map(x => x.trim().replace(/^"(.*)"$/, "$1").trim());
    while (c.length && !c[c.length - 1]) c.pop();
    if (!c.length) continue;
    if (c.some(x => x === "팀명")) continue;                      // 제목 줄
    const [college, dept, name] = c.length >= 3 ? c.slice(0, 3) : c.length === 2 ? [null, c[0], c[1]] : [null, null, c[0]];
    if (!name) continue;
    out.push({ college: college || null, dept: dept || null, name: name.slice(0, 60) });
  }
  return out;
}

function openTeams(p) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="max-width:760px">
    <h3></h3>
    <p class="hint" style="margin-top:-6px">학생은 이 사업·대회를 고르면 아래 목록에서 팀을 선택합니다. 목록이 비어 있으면 팀명을 직접 입력합니다.</p>
    <label>엑셀에서 붙여넣기</label>
    <textarea id="tmPaste" rows="6" placeholder="엑셀에서 [학부] [학과] [팀명] 세 열을 선택해 복사(Ctrl+C)한 뒤 여기에 붙여넣기(Ctrl+V) 하세요.&#10;제목 줄은 자동으로 건너뜁니다. 학과·팀명 두 열이나 팀명 한 열만 붙여넣어도 됩니다."></textarea>
    <div class="dlbar" style="margin-top:8px"><span id="tmPreview" class="hint">붙여넣으면 등록할 팀 수가 여기에 표시됩니다.</span>
      <span><button class="btn pri sm" id="tmAdd" type="button" disabled>팀 등록</button></span></div>
    <div class="dlbar" style="background:#fff;padding:0"><b id="tmCount"></b>
      <span><input type="text" id="tmQ" placeholder="팀명·학과 검색" style="width:180px;padding:7px 10px;font-size:14px"> <button class="btn danger sm" id="tmClear" type="button">전체 삭제</button></span></div>
    <div style="overflow:auto;max-height:42vh;border:1px solid var(--line);border-radius:8px">
      <table class="list"><thead><tr><th>학부</th><th>학과</th><th>팀명</th><th>신청</th><th></th></tr></thead><tbody id="tmRows"></tbody></table>
    </div>
    <div class="actions" style="margin-top:16px"><button class="btn ghost" id="tmClose" type="button">닫기</button></div>
  </div>`;
  document.body.append(bg);
  const mine = () => teamsAll.filter(t => t.program_id === p.id);
  const used = id => all.filter(r => r.team_id === id).length;
  let parsed = [];
  const draw = () => {
    $("h3", bg).textContent = `${p.name} · 팀 목록`;
    const q = $("#tmQ", bg).value.trim().toLowerCase();
    const list = mine().filter(t => !q || [t.name, t.dept, t.college].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (a.college || "힣").localeCompare(b.college || "힣", "ko") || (a.dept || "").localeCompare(b.dept || "", "ko") || a.name.localeCompare(b.name, "ko"));
    $("#tmCount", bg).textContent = `등록된 팀 ${mine().length}개` + (q ? ` (검색 ${list.length})` : "");
    $("#tmRows", bg).innerHTML = list.length ? list.map(t => `<tr><td>${esc(t.college) || "-"}</td><td>${esc(t.dept) || "-"}</td><td><b>${esc(t.name)}</b></td>
      <td>${used(t.id) ? used(t.id) + "건" : "-"}</td><td><button class="btn ghost sm" data-tdel="${esc(t.id)}">삭제</button></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">${q ? "검색 결과가 없습니다." : "등록된 팀이 없습니다."}</td></tr>`;
  };
  const preview = () => {
    const have = new Set(mine().map(t => t.name)), seen = new Set();
    const rows = parseTeams($("#tmPaste", bg).value);
    parsed = rows.filter(r => !have.has(r.name) && !seen.has(r.name) && seen.add(r.name));
    const dup = rows.length - parsed.length;
    $("#tmPreview", bg).textContent = rows.length ? `새로 등록 ${parsed.length}팀${dup ? ` · 중복 ${dup}팀은 건너뜀` : ""}` : "붙여넣으면 등록할 팀 수가 여기에 표시됩니다.";
    $("#tmAdd", bg).disabled = !parsed.length;
  };
  $("#tmPaste", bg).addEventListener("input", preview);
  $("#tmQ", bg).addEventListener("input", draw);
  const refresh = async () => { await loadPrograms(); draw(); preview(); };
  $("#tmAdd", bg).onclick = async () => {
    if (!parsed.length) return;
    $("#tmAdd", bg).disabled = true;
    try {
      for (let i = 0; i < parsed.length; i += 500)
        await SB.insert("teams", parsed.slice(i, i + 500).map(r => ({ program_id: p.id, ...r })));
      await addLog("팀 목록 등록", `${p.name}: ${parsed.length}팀`);
      toast(`${parsed.length}팀을 등록했습니다.`); $("#tmPaste", bg).value = "";
    } catch (err) { if (!handleAuthError(err)) toast("등록하지 못했습니다: " + (err.code === "23505" ? "이미 있는 팀명이 있습니다." : err.message), 4500); }
    await refresh();
  };
  $("#tmRows", bg).addEventListener("click", async e => {
    const id = e.target.dataset.tdel; if (!id) return;
    const t = mine().find(x => x.id === id); if (!t) return;
    const n = used(id);
    if (!(await askConfirm(`'${t.name}' 팀을 목록에서 삭제합니다.` + (n ? `\n이 팀으로 들어온 신청 ${n}건은 팀명이 그대로 남습니다.` : ""), "삭제"))) return;
    try { await SB.remove("teams", "id=eq." + encodeURIComponent(id)); await addLog("팀 삭제", `${p.name}: ${t.name}`); toast("삭제했습니다."); }
    catch (err) { if (!handleAuthError(err)) toast("삭제하지 못했습니다: " + err.message, 4000); }
    await refresh();
  });
  $("#tmClear", bg).onclick = async () => {
    const n = mine().length; if (!n) return toast("등록된 팀이 없습니다.");
    if (!(await askConfirm(`'${p.name}'의 팀 ${n}개를 모두 삭제합니다.\n이미 들어온 신청의 팀명은 그대로 남습니다.`, "전체 삭제"))) return;
    try { await SB.remove("teams", "program_id=eq." + encodeURIComponent(p.id)); await addLog("팀 목록 전체 삭제", `${p.name}: ${n}팀`); toast("모두 삭제했습니다."); }
    catch (err) { if (!handleAuthError(err)) toast("삭제하지 못했습니다: " + err.message, 4000); }
    await refresh();
  };
  $("#tmClose", bg).onclick = () => { bg.remove(); render(); };
  draw();
}
