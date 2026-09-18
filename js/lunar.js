// 음력/양력 변환 래퍼 (korean-lunar-calendar, MIT)
import KoreanLunarCalendar from "https://cdn.jsdelivr.net/npm/korean-lunar-calendar@0.4.0/dist/korean-lunar-calendar.mjs";

const MONTH_DAYS_SOLAR = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function pad2(n) { return String(n).padStart(2, "0"); }

/** 음력 (year, month, day) → 양력 {year, month, day}. 해당 음력 날짜가 없으면(예: 30일 없는 달) 하루씩 앞당겨 시도. */
export function lunarToSolar(year, month, day, intercalation = false) {
  const cal = new KoreanLunarCalendar();
  for (let d = day; d >= Math.max(1, day - 2); d--) {
    if (cal.setLunarDate(year, month, d, intercalation)) {
      const s = cal.getSolarCalendar();
      return { year: s.year, month: s.month, day: s.day, adjusted: d !== day };
    }
  }
  return null;
}

/** 양력 → 음력 */
export function solarToLunar(year, month, day) {
  const cal = new KoreanLunarCalendar();
  if (!cal.setSolarDate(year, month, day)) return null;
  const l = cal.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, intercalation: !!l.intercalation };
}

export function daysInSolarMonth(month) { return MONTH_DAYS_SOLAR[month - 1] || 31; }
export function daysInLunarMonth() { return 30; }

function toDateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/**
 * 이벤트의 "다음 발생 양력 날짜"를 계산한다.
 * annual: 올해 기준으로 계산, 이미 지났으면 내년.
 * once: 저장된 연도로 계산 (지난 날짜여도 그대로).
 * 반환: { date: Date, year, month, day, adjusted, past: boolean }
 */
export function nextOccurrence(ev, today = new Date()) {
  const t0 = toDateOnly(today);
  const build = (y) => {
    if (ev.calendar === "lunar") {
      const s = lunarToSolar(y, ev.month, ev.day);
      if (!s) return null;
      return { date: new Date(s.year, s.month - 1, s.day), year: s.year, month: s.month, day: s.day, adjusted: s.adjusted };
    }
    const dim = new Date(y, ev.month, 0).getDate();
    const d = Math.min(ev.day, dim);
    return { date: new Date(y, ev.month - 1, d), year: y, month: ev.month, day: d, adjusted: d !== ev.day };
  };

  if (ev.type === "once") {
    const r = build(ev.year);
    if (!r) return null;
    r.past = r.date < t0;
    return r;
  }
  let r = build(t0.getFullYear());
  if (r && r.date < t0) {
    const n = build(t0.getFullYear() + 1);
    if (n) r = n;
  }
  if (!r) return null;
  r.past = false;
  return r;
}

export function diffDays(from, to) {
  const a = toDateOnly(from), b = toDateOnly(to);
  return Math.round((b - a) / 86400000);
}

export function formatEventDate(ev) {
  const cal = ev.calendar === "lunar" ? "음력" : "양력";
  if (ev.type === "once") return `${cal} ${ev.year}년 ${ev.month}월 ${ev.day}일`;
  return `${cal} ${ev.month}월 ${ev.day}일`;
}

export function formatSolar(o) {
  if (!o) return "";
  return `${o.year}.${pad2(o.month)}.${pad2(o.day)}`;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export function weekdayKo(date) { return WEEK[date.getDay()]; }
