"use strict";
/* ---------- 공통 유틸 ---------- */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const digits = s => (s || "").replace(/\D/g, "");
function toast(m, ms = 2800) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = m;
  document.body.append(t); setTimeout(() => t.remove(), ms);
}
function fmtPhone(v) {
  v = digits(v);
  if (v.length < 4) return v;
  if (v.length < 8) return v.slice(0, 3) + "-" + v.slice(3);
  return v.slice(0, 3) + "-" + v.slice(3, v.length - 4) + "-" + v.slice(-4);
}
/* 한국 시간(브라우저 로컬) "YYYY-MM-DD HH:MM:SS" */
const loc = iso => {
  if (!iso) return "";
  const d = new Date(iso), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const maskAcc = a => { a = digits(a); return a.length > 6 ? a.slice(0, 3) + "*".repeat(a.length - 6) + a.slice(-3) : a; };

function applyTitle() {
  document.title = CONFIG.TITLE + (document.body.dataset.page === "admin" ? " · 관리자" : "");
  $$("[data-title]").forEach(e => e.textContent = CONFIG.TITLE);
  const c = $("#contact"); if (c && CONFIG.CONTACT) c.textContent = CONFIG.CONTACT;
}
function configOK() {
  return /^https:\/\/.+/.test(CONFIG.SUPABASE_URL) && !/YOUR-/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_KEY);
}
function showConfigBanner() {
  const b = document.createElement("div"); b.className = "banner";
  b.textContent = "⚠ 설정이 완료되지 않았습니다. config.js 에 Supabase 주소와 키를 입력하세요. (README 참고)";
  document.body.prepend(b);
}

/* 화면 안 확인창 (브라우저 confirm 대신 — 아티팩트·모바일에서도 동작) */
function askConfirm(msg, okText = "확인") {
  return new Promise(res => {
    const bg = document.createElement("div"); bg.className = "modal-bg"; bg.style.zIndex = 30;
    bg.innerHTML = `<div class="modal" style="max-width:400px"><h3>확인</h3><p style="white-space:pre-line;margin:0 0 18px"></p>
      <div class="actions"><button class="btn ghost" data-no type="button">취소</button><button class="btn danger" data-yes type="button"></button></div></div>`;
    $("p", bg).textContent = msg; $("[data-yes]", bg).textContent = okText;
    document.body.append(bg);
    const done = v => { bg.remove(); res(v); };
    $("[data-no]", bg).onclick = () => done(false);
    $("[data-yes]", bg).onclick = () => done(true);
    $("[data-no]", bg).focus();
  });
}
/* 오늘 날짜(브라우저 기준) "YYYY-MM-DD" */
const todayStr = () => loc(new Date().toISOString()).slice(0, 10);
/* 사업·대회 상태 */
function programState(p) {
  const t = todayStr();
  if (!p.active) return "마감";
  if (p.start_date && p.start_date > t) return "예정";
  if (p.end_date && p.end_date < t) return "기간종료";
  return "모집중";
}
const periodText = p => (p.start_date || p.end_date) ? `${p.start_date || ""} ~ ${p.end_date || ""}` : "상시";
