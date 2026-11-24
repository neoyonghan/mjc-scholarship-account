"use strict";
/* ---------- 학생 신청 화면 (로그인 없이 신청) ---------- */
const F = $("#regForm");
const MAX = 5 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const EMPTY_DROP = '<span>클릭하여 파일 선택</span><span class="hint">JPG·PNG·PDF, 5MB 이하</span>';
const files = { bankDoc: null };

applyTitle();
$("#retention").textContent = CONFIG.RETENTION;
if (!configOK()) { showConfigBanner(); $("#submitBtn").disabled = true; }

/* 선택 목록 채우기 */
CONFIG.PAY_TYPES.forEach(p => F.payType.add(new Option(p, p)));
CONFIG.BANKS.forEach(b => F.bank.add(new Option(b, b)));
(function () {
  const grp = (label, list, suffix = "") => {
    const g = document.createElement("optgroup"); g.label = label;
    list.forEach(d => g.append(new Option(d + suffix, d + suffix))); return g;
  };
  const etc = document.createElement("optgroup"); etc.label = "기타";
  etc.append(new Option("목록에 없음 (직접 입력)", "__etc"));
  F.dept.append(grp("전문학사과정", CONFIG.DEPTS), grp("학사학위 전공심화과정", CONFIG.DEPTS_ADV, "(전공심화)"),
                grp("조기취업형 계약학과", CONFIG.DEPTS_EARLY, "(조기취업형)"), etc);
  F.dept.addEventListener("change", () => {
    const on = F.dept.value === "__etc";
    F.deptEtc.classList.toggle("hidden", !on);
    if (on) F.deptEtc.focus(); else F.deptEtc.value = "";
  });
})();

/* 사업·대회 목록 (관리자가 등록한 것 중 모집중인 것만 서버가 내려줌) */
let programs = [], programsLoaded = false;
async function loadPrograms() {
  try {
    programs = await SB.select("programs", "select=id,name,pay_type,start_date,end_date,active&order=created_at.desc");
    programs = programs.filter(p => programState(p) === "모집중");     // 화면에서도 한 번 더 확인
    programsLoaded = true;
  } catch (err) { console.warn(err); programs = []; programsLoaded = false; }
  fillPrograms();
}
function fillPrograms() {
  const sel = F.program, type = F.payType.value, keep = sel.value;
  const list = programs.filter(p => p.pay_type === type);
  sel.length = 0;
  if (!type) { sel.add(new Option("지급 구분을 먼저 선택하세요", "")); sel.disabled = true; }
  else if (!programsLoaded) { sel.add(new Option("목록을 불러오지 못했습니다 (새로고침)", "")); sel.disabled = true; }
  else if (!list.length) { sel.add(new Option("모집중인 사업·대회 없음", "")); sel.disabled = true; }
  else {
    sel.add(new Option("선택", ""));
    list.forEach(p => sel.add(new Option(p.name, p.id)));
    sel.disabled = false;
    if (list.some(p => p.id === keep)) sel.value = keep;
  }
  $("#progReq").classList.toggle("hidden", sel.disabled);
  showProgHint();
}
function showProgHint() {
  const p = programs.find(x => x.id === F.program.value);
  const type = F.payType.value, none = type && programsLoaded && !programs.some(x => x.pay_type === type);
  $("#progHint").textContent = p ? `신청기간: ${periodText(p)}`
    : none ? "해당 지급 구분에 등록된 사업·대회가 없습니다. 선택 없이 신청할 수 있습니다." : "";
}
F.payType.addEventListener("change", fillPrograms);
F.program.addEventListener("change", showProgHint);
if (configOK()) loadPrograms();

/* 입력 정리 */
F.stuPhone.addEventListener("input", e => e.target.value = fmtPhone(e.target.value));
F.stuId.addEventListener("input", e => e.target.value = digits(e.target.value));
F.account.addEventListener("input", e => e.target.value = e.target.value.replace(/[^\d-]/g, ""));
F.stuName.addEventListener("blur", e => { if (!F.holder.value) F.holder.value = e.target.value.trim(); });

/* 통장 사본 첨부 */
$$(".drop").forEach(d => {
  d.innerHTML = EMPTY_DROP;
  const inp = F[d.dataset.for];
  d.addEventListener("click", () => inp.click());
  inp.addEventListener("change", () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > MAX) { toast("5MB 이하 파일만 첨부할 수 있습니다."); inp.value = ""; return; }
    if (!TYPES[f.type]) { toast("JPG·PNG·PDF 파일만 가능합니다."); inp.value = ""; return; }
    files[d.dataset.for] = f;
    if (f.type.startsWith("image/")) d.innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""><span class="fname">${esc(f.name)}</span>`;
    else d.innerHTML = `<span style="font-size:28px">📄</span><span class="fname">${esc(f.name)}</span>`;
    d.closest(".f").classList.remove("invalid");
  });
});

function clearExtras() {
  files.bankDoc = null; F.bankDoc.value = "";
  $$(".drop").forEach(d => d.innerHTML = EMPTY_DROP);
  F.deptEtc.classList.add("hidden");
  $$(".invalid").forEach(x => x.classList.remove("invalid"));
}
function resetForm() { F.reset(); clearExtras(); fillPrograms(); }
F.addEventListener("reset", () => setTimeout(() => { clearExtras(); fillPrograms(); }));

/* 제출 */
F.addEventListener("submit", async e => {
  e.preventDefault();
  $$(".invalid").forEach(x => x.classList.remove("invalid"));
  const bad = [];
  const mark = el => { const f = el.closest(".f"); if (f) { f.classList.add("invalid"); bad.push(f); } };
  const v = n => F[n].value.trim();

  if (!v("payType")) mark(F.payType);
  if (!F.program.disabled && !v("program")) mark(F.program);
  if (!/^\d{6,12}$/.test(v("stuId"))) mark(F.stuId);
  if (!v("stuName")) mark(F.stuName);
  if (!v("dept") || (v("dept") === "__etc" && !v("deptEtc"))) mark(F.dept);
  if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(v("stuPhone"))) mark(F.stuPhone);
  if (v("stuEmail") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("stuEmail"))) mark(F.stuEmail);
  if (!v("bank")) mark(F.bank);
  const accLen = digits(v("account")).length;
  if (accLen < 10 || accLen > 16) mark(F.account);
  if (!v("holder") || v("holder").replace(/\s/g, "") !== v("stuName").replace(/\s/g, "")) mark(F.holder);
  if (!F.agree1.checked) mark(F.agree1);
  if (bad.length) {
    bad[0].scrollIntoView({ behavior: "smooth", block: "center" });
    toast(`입력 내용을 확인하세요. (${bad.length}건)`); return;
  }

  const id = crypto.randomUUID();
  if (v("website")) { showDone(id); return; }           // 자동 입력 프로그램: 저장하지 않음

  const btn = $("#submitBtn"); btn.disabled = true; btn.textContent = "제출 중…";
  try {
    let bankPath = null;
    if (files.bankDoc) {
      bankPath = `${id}/bankbook.${TYPES[files.bankDoc.type]}`;
      await SB.upload(CONFIG.BUCKET, bankPath, files.bankDoc);
    }
    await SB.insert("applications", {
      id, pay_type: v("payType"), program_id: F.program.disabled ? null : (v("program") || null),
      stu_id: v("stuId"), name: v("stuName"),
      dept: v("dept") === "__etc" ? v("deptEtc") : v("dept"), grade: v("grade") || null,
      phone: v("stuPhone"), email: v("stuEmail") || null,
      bank: v("bank"), account: v("account"), holder: v("holder"),
      bank_doc_path: bankPath, agreed: true
    });
    showDone(id);
  } catch (err) {
    console.error(err);
    let msg = "제출하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    if (err.message === "TOO_MANY") msg = "같은 학번으로 하루 5회까지 신청할 수 있습니다. 내일 다시 신청하세요.";
    else if (err.message === "PROGRAM_CLOSED" || err.message === "PROGRAM_MISMATCH") {
      msg = "선택한 사업·대회의 신청이 마감되었거나 변경되었습니다. 목록을 새로 불러왔으니 다시 선택해 주세요.";
      loadPrograms();
    }
    else if (err.status === 413 || /size|large/i.test(err.message)) msg = "파일이 너무 큽니다. 5MB 이하로 줄여 주세요.";
    else if (/mime|type/i.test(err.message)) msg = "JPG·PNG·PDF 파일만 올릴 수 있습니다.";
    else if (err.code === "23514") msg = "입력 형식이 올바르지 않습니다. 내용을 다시 확인해 주세요.";
    else if (err instanceof TypeError) msg = "인터넷 연결을 확인해 주세요.";
    toast(msg, 5000);
  } finally {
    btn.disabled = !configOK(); btn.textContent = "등록 신청";
  }
});

function showDone(id) {
  $("#rcpt").textContent = "접수번호 " + id.slice(0, 8).toUpperCase() + " · " + loc(new Date().toISOString()).slice(0, 16);
  resetForm();
  $("#formWrap").classList.add("hidden");
  $("#doneWrap").classList.remove("hidden");
  window.scrollTo({ top: 0 });
}
$("#againBtn").addEventListener("click", () => {
  $("#doneWrap").classList.add("hidden");
  $("#formWrap").classList.remove("hidden");
});
