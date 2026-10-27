import { firebaseConfig } from "./firebase-config.js?v=20261027a";
import { createDb } from "./db.js?v=20261027a";
import {
  nextOccurrence, diffDays, formatEventDate, formatSolar, weekdayKo,
  lunarToSolar, solarToLunar,
} from "./lunar.js?v=20261027a";

/* ---------------- 상수 ---------------- */
const FAMILIES = {
  common: { label: "공통", locked: false, icon: "🏠" },
  salt: { label: "소금이네", locked: true, icon: "assets/salt.svg" },
  bean: { label: "콩콩이네", locked: true, icon: "assets/bean.svg" },
};
const TYPE_LABEL = { annual: "매년", once: "일회성" };
const LOG_YEAR_FROM = 2026;        // 내역 연도 선택: 2026년이 가장 아래
const LOG_YEAR_SPAN = 20;          // 그 뒤 20년까지
const LOG_PLACEHOLDER = "종근이네 현금 10만원, 종하네 케이크와 선물";

/* ---------------- 상태 ---------------- */
const state = {
  db: null,
  family: "common",
  filter: "all",          // all | annual | once
  eventId: null,
  openYear: null,         // 상세에서 펼쳐진 연도 카드
  unlocked: { salt: false, bean: false },
  pwVersion: null,       // { salt, bean } from password-version.json
  cache: { events: {}, logs: {} },
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const modalRoot = $("#modalRoot");
const fab = $("#fab");

/* ---------------- 유틸 ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
async function sha256(text) {
  if (!crypto?.subtle) throw new Error("이 브라우저에서는 보안 해시를 사용할 수 없습니다. (https 필요)");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function authKey(family) {
  const v = state.pwVersion?.[family];
  if (!v) throw new Error("비밀번호 설정을 불러오지 못했습니다. 새로고침 해주세요.");
  return `${family}_v${v}`;
}
/** 비밀번호 리셋 버전: 브라우저 캐시를 거치지 않고 매번 새로 받아온다. */
async function loadPasswordVersion() {
  const url = new URL("./password-version.json", import.meta.url);
  url.searchParams.set("t", Date.now());
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`password-version.json ${res.status}`);
  return res.json();
}
function unlockStoreKey(family) { return `jd:unlock:${authKey(family)}`; }
function thisYear() { return new Date().getFullYear(); }
function familyIcon(family, size = 56) {
  const f = FAMILIES[family];
  return f.icon.endsWith(".svg") ? `<img src="${f.icon}" alt="" width="${size}" height="${size}" />` : f.icon;
}

function openModal(html) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="grip"></div>${html}</div></div>`;
  const bd = $(".modal-backdrop", modalRoot);
  bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(); });
  document.body.style.overflow = "hidden";
  setTimeout(() => $(".modal input, .modal textarea, .modal select", modalRoot)?.focus(), 50);
  return $(".modal", modalRoot);
}
function closeModal() { modalRoot.innerHTML = ""; document.body.style.overflow = ""; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function confirmDialog(title, desc, okLabel = "삭제") {
  return new Promise((resolve) => {
    const m = openModal(`
      <h3>${esc(title)}</h3>
      <p style="color:var(--ink-2);margin:0 0 16px;font-size:14px">${esc(desc)}</p>
      <div class="form"><div class="actions">
        <button class="btn" data-act="cancel">취소</button>
        <button class="btn primary" data-act="ok" style="background:var(--red);border-color:var(--red);color:#fff">${esc(okLabel)}</button>
      </div></div>`);
    m.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeModal();
      resolve(act === "ok");
    });
  });
}

/* ---------------- 라우팅 (#/family[/e/eventId]) ---------------- */
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const family = FAMILIES[parts[0]] ? parts[0] : "common";
  const eventId = parts[1] === "e" && parts[2] ? parts[2] : null;
  return { family, eventId };
}
function navigate(family, eventId = null) {
  location.hash = eventId ? `#/${family}/e/${eventId}` : `#/${family}`;
}
window.addEventListener("hashchange", route);

async function route() {
  const { family, eventId } = parseHash();
  if (eventId !== state.eventId) state.openYear = null;
  state.family = family;
  state.eventId = eventId;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.family === family));
  fab.hidden = true;

  if (FAMILIES[family].locked && !state.unlocked[family]) {
    const ok = await tryAutoUnlock(family);
    if (!ok) return renderGate(family);
  }
  if (eventId) return renderDetail(eventId);
  return renderList();
}

/* ---------------- 비밀번호 게이트 ---------------- */
async function tryAutoUnlock(family) {
  try {
    const rec = await state.db.getAuth(authKey(family));
    if (!rec) return false;
    const saved = localStorage.getItem(unlockStoreKey(family));
    if (saved && saved === rec.hash) { state.unlocked[family] = true; return true; }
  } catch (e) { console.warn(e); }
  return false;
}

async function renderGate(family) {
  view.innerHTML = `<div class="loading">확인 중...</div>`;
  let rec = null;
  try { rec = await state.db.getAuth(authKey(family)); }
  catch (e) { view.innerHTML = `<div class="empty">비밀번호 정보를 불러오지 못했습니다.<br>${esc(e.message)}</div>`; return; }
  const label = FAMILIES[family].label;
  const isSetup = !rec;

  view.innerHTML = `
    <div class="gate ${family}">
      <div class="icon">${familyIcon(family)}</div>
      <h2>${esc(label)} ${isSetup ? "🗝️" : "🔒"}</h2>
      <p>${isSetup
        ? "아직 비밀번호가 없습니다. 이 탭에 사용할 비밀번호를 정해주세요.<br>같은 비밀번호를 아는 사람만 열람할 수 있습니다."
        : "이 탭은 비밀번호를 아는 가족만 볼 수 있습니다."}</p>
      <form class="form" id="gateForm" autocomplete="off">
        <div class="field">
          <label for="pw">비밀번호</label>
          <input type="password" id="pw" name="pw" autocomplete="${isSetup ? "new-password" : "current-password"}" required minlength="4" placeholder="4자 이상" />
        </div>
        ${isSetup ? `
        <div class="field">
          <label for="pw2">비밀번호 확인</label>
          <input type="password" id="pw2" name="pw2" autocomplete="new-password" required minlength="4" placeholder="한 번 더 입력" />
        </div>` : ""}
        <div class="error" id="gateErr"></div>
        <button class="btn primary block" type="submit">${isSetup ? "비밀번호 설정하고 입장" : "입장"}</button>
      </form>
    </div>`;

  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#gateErr");
    err.textContent = "";
    const pw = $("#pw").value;
    if (pw.length < 4) { err.textContent = "비밀번호는 4자 이상이어야 합니다."; return; }
    const btn = $("#gateForm button[type=submit]");
    btn.disabled = true;
    try {
      const hash = await sha256(`${authKey(family)}:${pw}`);
      if (isSetup) {
        const pw2 = $("#pw2").value;
        if (pw !== pw2) { err.textContent = "비밀번호 확인이 일치하지 않습니다."; btn.disabled = false; return; }
        await state.db.setAuth(authKey(family), hash);
        toast("비밀번호가 설정되었습니다");
      } else if (hash !== rec.hash) {
        err.textContent = "비밀번호가 맞지 않습니다.";
        btn.disabled = false;
        $("#pw").select();
        return;
      }
      localStorage.setItem(unlockStoreKey(family), hash);
      state.unlocked[family] = true;
      route();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false;
    }
  });
}

function lockFamily(family) {
  localStorage.removeItem(unlockStoreKey(family));
  state.unlocked[family] = false;
  toast("이 기기에서 잠갔습니다");
  navigate(family);
  route();
}

/* ---------------- 데이터 ---------------- */
async function loadEvents(family, force = false) {
  if (!force && state.cache.events[family]) return state.cache.events[family];
  const evs = await state.db.listEvents(family);
  state.cache.events[family] = evs;
  return evs;
}
async function loadLogs(eventId, force = false) {
  if (!force && state.cache.logs[eventId]) return state.cache.logs[eventId];
  const logs = await state.db.listLogs(eventId);
  state.cache.logs[eventId] = logs;
  return logs;
}
function invalidateEvents(family) { delete state.cache.events[family]; }

/** 이벤트 카드용 요약(logCount, lastYear, lastSummary)을 이벤트 문서에 반영 */
async function refreshEventSummary(ev, logs) {
  const lastYear = logs.length ? Math.max(...logs.map((l) => l.year)) : null;
  const lastLogs = logs.filter((l) => l.year === lastYear).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const patch = {
    logCount: logs.length,
    lastYear,
    lastSummary: lastLogs.map((l) => (l.content || "").replace(/\s+/g, " ").trim()).join(" / ").slice(0, 120),
  };
  await state.db.updateEvent(ev.id, patch);
  Object.assign(ev, patch);
  invalidateEvents(ev.family);
}

/* ---------------- 목록 ---------------- */
function ddayHtml(ev) {
  const occ = nextOccurrence(ev);
  if (!occ) return "";
  const d = diffDays(new Date(), occ.date);
  if (ev.type === "once" && d < 0) return `<span class="dday past">${Math.abs(d)}일 전</span>`;
  if (d === 0) return `<span class="dday today">오늘!</span>`;
  return `<span class="dday">D-${d}</span>`;
}
function occChip(ev) {
  const occ = nextOccurrence(ev);
  if (!occ) return "";
  const ann = ev.type === "annual" ? (occ.year === thisYear() ? "올해 " : "내년 ") : "";
  return `<span class="chip">${ann}${formatSolar(occ)} (${weekdayKo(occ.date)})</span>`;
}

/** 가장 가깝게 남은 일정이 맨 위. 이미 지난 일회성 이벤트는 맨 아래(최근 순). */
function sortEvents(evs) {
  const today = new Date();
  return evs.map((ev) => {
    const occ = nextOccurrence(ev);
    return { ev, d: occ ? diffDays(today, occ.date) : 99999 };
  }).sort((a, b) => {
    const ap = a.d < 0, bp = b.d < 0;
    if (ap !== bp) return ap ? 1 : -1;
    return ap ? b.d - a.d : a.d - b.d;
  }).map((x) => x.ev);
}

async function renderList() {
  const family = state.family;
  view.innerHTML = `<div class="loading">불러오는 중...</div>`;
  let evs;
  try { evs = await loadEvents(family); }
  catch (e) { view.innerHTML = `<div class="empty">불러오기 실패<br>${esc(e.message)}</div>`; return; }
  if (state.family !== family || state.eventId) return;

  const filtered = state.filter === "all" ? evs : evs.filter((e) => e.type === state.filter);
  const sorted = sortEvents(filtered);
  const counts = { all: evs.length, annual: evs.filter((e) => e.type === "annual").length, once: evs.filter((e) => e.type === "once").length };

  view.innerHTML = `
    <div class="toolbar">
      <div class="seg full" id="filterSeg">
        <button data-f="all" class="${state.filter === "all" ? "active" : ""}">전체 ${counts.all}</button>
        <button data-f="annual" class="${state.filter === "annual" ? "active" : ""}">매년 ${counts.annual}</button>
        <button data-f="once" class="${state.filter === "once" ? "active" : ""}">일회성 ${counts.once}</button>
      </div>
    </div>
    ${sorted.length === 0 ? `
      <div class="empty">
        <div class="big">🎁</div>
        ${evs.length === 0 ? "아직 등록된 이벤트가 없습니다.<br>오른쪽 아래 <b>＋</b> 버튼으로 첫 이벤트를 등록해보세요." : "해당 유형의 이벤트가 없습니다."}
      </div>` : `
      <div class="grid">
        ${sorted.map((ev) => `
          <article class="card ${ev.calendar}" data-id="${esc(ev.id)}" role="button" tabindex="0">
            <div class="title-row"><h2 class="title">${esc(ev.title)}</h2>${ddayHtml(ev)}</div>
            <div class="meta">
              <span class="chip ${ev.type}">${TYPE_LABEL[ev.type] || ""}</span>
              <span class="chip ${ev.calendar}">${esc(formatEventDate(ev))}</span>
              ${ev.calendar === "lunar" || ev.type === "annual" ? occChip(ev) : ""}
            </div>
            <div class="foot">
              <span class="last">${ev.lastYear ? `${ev.lastYear}년 · ${esc(ev.lastSummary || "")}` : "기록 없음"}</span>
              <span>기록 ${ev.logCount || 0}건</span>
            </div>
          </article>`).join("")}
      </div>`}
    ${FAMILIES[family].locked ? `<div class="footer" style="margin-top:20px"><button class="link" id="lockBtn">이 기기에서 ${esc(FAMILIES[family].label)} 잠그기</button></div>` : ""}
  `;
  fab.hidden = false;

  $("#filterSeg").addEventListener("click", (e) => {
    const f = e.target.closest("button")?.dataset.f;
    if (!f) return;
    state.filter = f;
    renderList();
  });
  view.querySelectorAll(".card").forEach((c) => {
    const go = () => navigate(family, c.dataset.id);
    c.addEventListener("click", go);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  $("#lockBtn")?.addEventListener("click", () => lockFamily(family));
}

/* ---------------- 이벤트 등록/수정 모달 ---------------- */
function monthOptions(sel) {
  return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}" ${m === sel ? "selected" : ""}>${m}월</option>`).join("");
}
function dayOptions(sel, max) {
  return Array.from({ length: max }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${d}일</option>`).join("");
}
/** to → from 내림차순 */
function yearOptions(sel, from, to, exclude = new Set()) {
  const out = [];
  for (let y = to; y >= from; y--) {
    if (exclude.has(y)) continue;
    out.push(`<option value="${y}" ${y === sel ? "selected" : ""}>${y}년</option>`);
  }
  return out.join("");
}

function openEventModal(ev = null) {
  const family = state.family;
  const isEdit = !!ev;
  const now = new Date();
  const f = {
    title: ev?.title || "",
    type: ev?.type || "annual",
    calendar: ev?.calendar || "solar",
    year: ev?.year || now.getFullYear(),
    month: ev?.month || now.getMonth() + 1,
    day: ev?.day || now.getDate(),
  };

  const m = openModal(`
    <h3>${isEdit ? "이벤트 수정" : "이벤트 등록"}</h3>
    <form class="form" id="evForm" autocomplete="off">
      <div class="field">
        <label for="evTitle">제목</label>
        <input type="text" id="evTitle" name="title" required maxlength="100" placeholder="예: 엄마 생신, 어버이날, 아버지 칠순" value="${esc(f.title)}" />
      </div>
      <div class="field">
        <label>유형</label>
        <div class="seg full" data-name="type">
          <button type="button" data-v="annual" class="${f.type === "annual" ? "active" : ""}">매년 반복</button>
          <button type="button" data-v="once" class="${f.type === "once" ? "active" : ""}">일회성</button>
        </div>
        <div class="help" id="typeHelp"></div>
      </div>
      <div class="field">
        <label>날짜 기준</label>
        <div class="seg full" data-name="calendar">
          <button type="button" data-v="solar" class="${f.calendar === "solar" ? "active" : ""}">양력</button>
          <button type="button" data-v="lunar" class="${f.calendar === "lunar" ? "active" : ""}">음력</button>
        </div>
      </div>
      <div class="field">
        <label>날짜</label>
        <div class="row">
          <select name="year" id="evYear" ${f.type === "once" ? "" : "hidden"}>${yearOptions(f.year, 1990, now.getFullYear() + 5)}</select>
          <select name="month" id="evMonth">${monthOptions(f.month)}</select>
          <select name="day" id="evDay">${dayOptions(f.day, 31)}</select>
        </div>
        <div class="help" id="datePreview"></div>
      </div>
      <div class="error" id="evErr"></div>
      <div class="actions">
        <button type="button" class="btn" data-act="cancel">취소</button>
        <button type="submit" class="btn primary">${isEdit ? "저장" : "등록"}</button>
      </div>
    </form>`);

  const form = $("#evForm", m);
  const yearSel = $("#evYear", m), monthSel = $("#evMonth", m), daySel = $("#evDay", m);

  const syncDays = () => {
    const month = +monthSel.value;
    const max = f.calendar === "lunar" ? 30 : (month === 2 ? 29 : new Date(2001, month, 0).getDate());
    const cur = Math.min(+daySel.value || 1, max);
    daySel.innerHTML = dayOptions(cur, max);
  };
  const preview = () => {
    const y = f.type === "once" ? +yearSel.value : thisYear();
    const mo = +monthSel.value, d = +daySel.value;
    const el = $("#datePreview", m);
    $("#typeHelp", m).textContent = f.type === "annual" ? "매년 같은 날 반복되는 행사. 기록이 연도별로 쌓입니다." : "특정 연도에 한 번만 있는 행사 (예: 칠순, 결혼식, 집들이).";
    if (f.calendar === "lunar") {
      const s = lunarToSolar(y, mo, d);
      el.textContent = s ? `→ ${y}년 양력 ${s.month}월 ${s.day}일 (${weekdayKo(new Date(s.year, s.month - 1, s.day))})${s.adjusted ? " · 해당 달에 그 날이 없어 앞당김" : ""}` : "변환할 수 없는 날짜입니다";
    } else {
      const dt = new Date(y, mo - 1, d);
      const l = solarToLunar(y, mo, d);
      el.textContent = `${y}년 ${mo}월 ${d}일 (${weekdayKo(dt)})` + (l ? ` · 음력 ${l.month}월 ${l.day}일` : "");
    }
  };

  m.querySelectorAll(".seg[data-name]").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      f[seg.dataset.name] = b.dataset.v;
      yearSel.hidden = f.type !== "once";
      syncDays();
      preview();
    });
  });
  [yearSel, monthSel, daySel].forEach((s) => s.addEventListener("change", () => { syncDays(); preview(); }));
  m.addEventListener("click", (e) => { if (e.target.closest("[data-act=cancel]")) closeModal(); });
  syncDays(); preview();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#evErr", m);
    const title = $("#evTitle", m).value.trim();
    if (!title) { err.textContent = "제목을 입력하세요."; return; }
    const data = {
      family, title,
      type: f.type,
      calendar: f.calendar,
      month: +monthSel.value,
      day: +daySel.value,
      year: f.type === "once" ? +yearSel.value : null,
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (isEdit) {
        await state.db.updateEvent(ev.id, data);
        Object.assign(ev, data);
        invalidateEvents(family);
        closeModal();
        toast("이벤트를 수정했습니다");
        route();
      } else {
        const id = await state.db.addEvent({ ...data, logCount: 0, lastYear: null, lastSummary: "" });
        invalidateEvents(family);
        closeModal();
        toast("이벤트를 등록했습니다");
        navigate(family, id);
      }
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false;
    }
  });
}
fab.addEventListener("click", () => openEventModal());

/* ---------------- 상세 (연도별 아코디언) ---------------- */
function occurrenceForYear(ev, year) {
  if (ev.calendar === "lunar") {
    const s = lunarToSolar(year, ev.month, ev.day);
    return s ? { year: s.year, month: s.month, day: s.day } : null;
  }
  const dim = new Date(year, ev.month, 0).getDate();
  return { year, month: ev.month, day: Math.min(ev.day, dim) };
}

async function renderDetail(eventId) {
  const family = state.family;
  view.innerHTML = `<div class="loading">불러오는 중...</div>`;
  let ev, logs;
  try {
    const cached = state.cache.events[family]?.find((e) => e.id === eventId);
    ev = cached || await state.db.getEvent(eventId);
    if (!ev) { view.innerHTML = `<div class="empty">이벤트를 찾을 수 없습니다.<br><br><button class="btn" onclick="location.hash='#/${family}'">목록으로</button></div>`; return; }
    if (ev.family !== family) { navigate(ev.family, ev.id); return; }
    logs = await loadLogs(eventId);
  } catch (e) { view.innerHTML = `<div class="empty">불러오기 실패<br>${esc(e.message)}</div>`; return; }
  if (state.eventId !== eventId) return;

  const occ = nextOccurrence(ev);
  const yTo = LOG_YEAR_FROM + LOG_YEAR_SPAN;
  // 연도별 그룹 (최근 연도가 맨 위), 같은 연도 안에서는 먼저 쓴 순
  const byYear = new Map();
  [...logs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((l) => {
    if (!byYear.has(l.year)) byYear.set(l.year, []);
    byYear.get(l.year).push(l);
  });
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const preferred = ev.type === "once" ? ev.year : thisYear();
  const defaultYear = Math.min(Math.max(preferred, LOG_YEAR_FROM), yTo);

  view.innerHTML = `
    <div class="back"><button class="btn ghost sm" id="backBtn">‹ 목록</button></div>
    <section class="detail-head">
      <div class="top">
        <h2>${esc(ev.title)}</h2>
        <div class="actions">
          <button class="btn ghost btn-icon" id="editEv" title="수정" aria-label="수정">✏️</button>
          <button class="btn ghost btn-icon" id="delEv" title="삭제" aria-label="삭제">🗑️</button>
        </div>
      </div>
      <div class="meta">
        <span class="chip ${ev.type}">${TYPE_LABEL[ev.type]}</span>
        <span class="chip ${ev.calendar}">${esc(formatEventDate(ev))}</span>
        ${occ ? `<span class="chip">${ev.type === "annual" ? (occ.year === thisYear() ? "올해 " : "내년 ") : ""}${formatSolar(occ)} (${weekdayKo(occ.date)})</span>` : ""}
        ${ddayHtml(ev)}
      </div>
    </section>

    <section class="log-form">
      <div class="title">📝 내역 추가</div>
      <form id="logForm" autocomplete="off">
        <div class="inline">
          <select name="year" id="logYear" aria-label="연도">${yearOptions(defaultYear, LOG_YEAR_FROM, yTo)}</select>
          <textarea name="content" id="logContent" required maxlength="2000" placeholder="${esc(LOG_PLACEHOLDER)}"></textarea>
        </div>
        <div class="error" id="logErr"></div>
        <div class="actions"><button type="submit" class="btn primary">등록</button></div>
      </form>
    </section>

    <section id="yearList" class="year-list">
      ${years.length === 0 ? `<div class="empty"><div class="big">📭</div>아직 기록이 없습니다.<br>위에서 첫 내역을 남겨보세요.</div>` :
        years.map((y) => {
          const entries = byYear.get(y);
          const o = ev.type === "annual" ? occurrenceForYear(ev, y) : null;
          const open = state.openYear === y;
          const preview = entries.map((l) => l.content.replace(/\s+/g, " ").trim()).join(" / ");
          return `
          <div class="ycard ${open ? "open" : ""}" data-year="${y}">
            <button class="yhead" type="button" aria-expanded="${open}">
              <div>
                <div class="year">${y}년</div>
                ${o ? `<div class="date">${formatSolar(o)}</div>` : ""}
              </div>
              <div class="preview">${esc(preview)}</div>
              ${entries.length > 1 ? `<span class="count">${entries.length}건</span>` : ""}
              <span class="chev">▼</span>
            </button>
            <div class="ybody">
              ${entries.map((l) => `
              <div class="entry" data-id="${esc(l.id)}">
                <textarea class="ycontent" maxlength="2000" placeholder="${esc(LOG_PLACEHOLDER)}">${esc(l.content)}</textarea>
                <div class="yops">
                  <button class="btn sm ghost left" data-op="del" style="color:var(--red)">삭제</button>
                  <button class="btn sm primary" data-op="save">저장</button>
                </div>
              </div>`).join("")}
            </div>
          </div>`;
        }).join("")}
    </section>
  `;

  $("#backBtn").addEventListener("click", () => navigate(family));
  $("#editEv").addEventListener("click", () => openEventModal(ev));
  $("#delEv").addEventListener("click", async () => {
    const ok = await confirmDialog("이벤트 삭제", `"${ev.title}" 이벤트와 기록 ${logs.length}건이 모두 삭제됩니다. 되돌릴 수 없습니다.`);
    if (!ok) return;
    try {
      await state.db.deleteEvent(ev.id);
      delete state.cache.logs[ev.id];
      invalidateEvents(family);
      toast("이벤트를 삭제했습니다");
      navigate(family);
    } catch (e) { toast("삭제 실패: " + e.message); }
  });

  $("#logForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#logErr");
    const content = $("#logContent").value.trim();
    const year = +$("#logYear").value;
    if (!content) { err.textContent = "내용을 입력하세요."; return; }
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const data = { year, content };
      const id = await state.db.addLog(ev.id, data);
      logs.push({ ...data, id, createdAt: Date.now() });
      state.cache.logs[ev.id] = logs;
      await refreshEventSummary(ev, logs);
      state.openYear = year;
      toast("내역을 등록했습니다");
      renderDetail(ev.id);
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false;
    }
  });

  const list = $("#yearList");
  list.addEventListener("click", async (e) => {
    const card = e.target.closest(".ycard");
    if (!card) return;
    const year = +card.dataset.year;

    // 헤더 클릭: 펼치기/접기 (동시에 하나만)
    if (e.target.closest(".yhead")) {
      const willOpen = !card.classList.contains("open");
      list.querySelectorAll(".ycard.open").forEach((c) => {
        c.classList.remove("open");
        c.querySelector(".yhead").setAttribute("aria-expanded", "false");
        c.querySelectorAll(".entry").forEach((en) => {
          en.querySelector(".ycontent").value = logs.find((l) => l.id === en.dataset.id)?.content || "";
        });
      });
      if (willOpen) {
        card.classList.add("open");
        card.querySelector(".yhead").setAttribute("aria-expanded", "true");
        state.openYear = year;
      } else {
        state.openYear = null;
      }
      return;
    }

    const op = e.target.closest("button[data-op]")?.dataset.op;
    if (!op) return;
    const entry = e.target.closest(".entry");
    const log = logs.find((l) => l.id === entry?.dataset.id);
    if (!log) return;

    if (op === "save") {
      const content = entry.querySelector(".ycontent").value.trim();
      if (!content) { toast("내용을 입력하세요"); return; }
      if (content === log.content) { toast("변경된 내용이 없습니다"); return; }
      try {
        await state.db.updateLog(ev.id, log.id, { content });
        log.content = content;
        await refreshEventSummary(ev, logs);
        card.querySelector(".preview").textContent = logs.filter((l) => l.year === year).map((l) => l.content.replace(/\s+/g, " ").trim()).join(" / ");
        toast("저장했습니다");
      } catch (ex) { toast("저장 실패: " + ex.message); }
    } else if (op === "del") {
      const ok = await confirmDialog("내역 삭제", `${log.year}년 기록 1건을 삭제합니다.`);
      if (!ok) return;
      try {
        await state.db.deleteLog(ev.id, log.id);
        logs.splice(logs.indexOf(log), 1);
        await refreshEventSummary(ev, logs);
        state.openYear = logs.some((l) => l.year === year) ? year : null;
        toast("삭제했습니다");
        renderDetail(ev.id);
      } catch (ex) { toast("삭제 실패: " + ex.message); }
    }
  });
}

/* ---------------- 초기화 ---------------- */
async function init() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => { state.filter = "all"; navigate(t.dataset.family); });
  });
  try {
    state.pwVersion = await loadPasswordVersion();
  } catch (e) {
    console.warn("비밀번호 버전 로드 실패", e);
  }
  try {
    state.db = await createDb(firebaseConfig);
  } catch (e) {
    view.innerHTML = `<div class="empty">데이터베이스 초기화 실패<br>${esc(e.message)}</div>`;
    return;
  }
  const badge = $("#modeBadge");
  if (state.db.kind === "local") {
    badge.textContent = "로컬 모드";
    badge.className = "mode-badge local";
    badge.title = "Firebase 설정이 없어 이 브라우저에만 저장됩니다.";
    badge.hidden = false;
    $("#footerText").innerHTML = "로컬 모드: 데이터가 이 브라우저(localStorage)에만 저장됩니다.";
  } else {
    $("#footerText").textContent = "자식된 도리 · 가족 행사 기록 아카이브";
  }
  if (!location.hash) location.hash = "#/common";
  route();
}
init();
