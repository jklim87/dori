// 데이터 저장소 어댑터
// - Firestore: firebase-config.js 에 apiKey 가 있을 때
// - Local: apiKey 가 비어 있을 때 (브라우저 localStorage, 개발/QA용)
//
// 공통 인터페이스
//   getAuth(key) -> {hash} | null
//   setAuth(key, hash)
//   listEvents(family) -> Event[]
//   getEvent(id) -> Event | null
//   addEvent(data) -> id
//   updateEvent(id, patch)
//   deleteEvent(id)           // 하위 logs 포함 삭제
//   listLogs(eventId) -> Log[]
//   addLog(eventId, data) -> id
//   updateLog(eventId, logId, patch)
//   deleteLog(eventId, logId)

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- Local (localStorage) ---------------- */
class LocalDb {
  constructor() {
    this.kind = "local";
    this.key = "jasik-dori:v1";
    this._load();
  }
  _load() {
    try {
      this.data = JSON.parse(localStorage.getItem(this.key)) || {};
    } catch { this.data = {}; }
    this.data.auth ||= {};
    this.data.events ||= {};
    this.data.logs ||= {};
  }
  _save() { localStorage.setItem(this.key, JSON.stringify(this.data)); }

  async getAuth(key) { return this.data.auth[key] || null; }
  async setAuth(key, hash) {
    if (this.data.auth[key]) throw new Error("이미 비밀번호가 설정되어 있습니다.");
    this.data.auth[key] = { hash, createdAt: Date.now() };
    this._save();
  }

  async listEvents(family) {
    return Object.values(this.data.events).filter((e) => e.family === family).map((e) => ({ ...e }));
  }
  async getEvent(id) { const e = this.data.events[id]; return e ? { ...e } : null; }
  async addEvent(data) {
    const id = uid();
    this.data.events[id] = { ...data, id, createdAt: Date.now(), updatedAt: Date.now() };
    this._save();
    return id;
  }
  async updateEvent(id, patch) {
    if (!this.data.events[id]) throw new Error("이벤트가 없습니다.");
    Object.assign(this.data.events[id], patch, { updatedAt: Date.now() });
    this._save();
  }
  async deleteEvent(id) {
    delete this.data.events[id];
    delete this.data.logs[id];
    this._save();
  }

  async listLogs(eventId) {
    return Object.values(this.data.logs[eventId] || {}).map((l) => ({ ...l }));
  }
  async addLog(eventId, data) {
    const id = uid();
    this.data.logs[eventId] ||= {};
    this.data.logs[eventId][id] = { ...data, id, createdAt: Date.now(), updatedAt: Date.now() };
    this._save();
    return id;
  }
  async updateLog(eventId, logId, patch) {
    const l = this.data.logs[eventId]?.[logId];
    if (!l) throw new Error("내역이 없습니다.");
    Object.assign(l, patch, { updatedAt: Date.now() });
    this._save();
  }
  async deleteLog(eventId, logId) {
    if (this.data.logs[eventId]) delete this.data.logs[eventId][logId];
    this._save();
  }
}

/* ---------------- Firestore ---------------- */
class FirestoreDb {
  constructor(app, fs) {
    this.kind = "firestore";
    this.fs = fs;
    this.db = fs.getFirestore(app);
  }
  _ts(d) {
    // Firestore Timestamp → millis
    if (!d) return null;
    if (typeof d.toMillis === "function") return d.toMillis();
    if (typeof d === "number") return d;
    return null;
  }
  _norm(snap) {
    const d = snap.data();
    return { ...d, id: snap.id, createdAt: this._ts(d.createdAt), updatedAt: this._ts(d.updatedAt) };
  }

  async getAuth(key) {
    const { doc, getDoc } = this.fs;
    const s = await getDoc(doc(this.db, "auth", key));
    return s.exists() ? s.data() : null;
  }
  async setAuth(key, hash) {
    const { doc, setDoc, serverTimestamp } = this.fs;
    try {
      await setDoc(doc(this.db, "auth", key), { hash, createdAt: serverTimestamp() });
    } catch (e) {
      if (String(e.code || e.message).includes("permission")) {
        throw new Error("이미 다른 사람이 비밀번호를 설정했습니다. 새로고침 후 다시 시도하세요.");
      }
      throw e;
    }
  }

  async listEvents(family) {
    const { collection, getDocs, query, where } = this.fs;
    const q = query(collection(this.db, "events"), where("family", "==", family));
    const s = await getDocs(q);
    return s.docs.map((d) => this._norm(d));
  }
  async getEvent(id) {
    const { doc, getDoc } = this.fs;
    const s = await getDoc(doc(this.db, "events", id));
    return s.exists() ? this._norm(s) : null;
  }
  async addEvent(data) {
    const { collection, addDoc, serverTimestamp } = this.fs;
    const ref = await addDoc(collection(this.db, "events"), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    return ref.id;
  }
  async updateEvent(id, patch) {
    const { doc, updateDoc, serverTimestamp } = this.fs;
    await updateDoc(doc(this.db, "events", id), { ...patch, updatedAt: serverTimestamp() });
  }
  async deleteEvent(id) {
    const { doc, collection, getDocs, writeBatch } = this.fs;
    const logs = await getDocs(collection(this.db, "events", id, "logs"));
    const batch = writeBatch(this.db);
    logs.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(this.db, "events", id));
    await batch.commit();
  }

  async listLogs(eventId) {
    const { collection, getDocs } = this.fs;
    const s = await getDocs(collection(this.db, "events", eventId, "logs"));
    return s.docs.map((d) => this._norm(d));
  }
  async addLog(eventId, data) {
    const { collection, addDoc, serverTimestamp } = this.fs;
    const ref = await addDoc(collection(this.db, "events", eventId, "logs"), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    return ref.id;
  }
  async updateLog(eventId, logId, patch) {
    const { doc, updateDoc, serverTimestamp } = this.fs;
    await updateDoc(doc(this.db, "events", eventId, "logs", logId), { ...patch, updatedAt: serverTimestamp() });
  }
  async deleteLog(eventId, logId) {
    const { doc, deleteDoc } = this.fs;
    await deleteDoc(doc(this.db, "events", eventId, "logs", logId));
  }
}

/* ---------------- factory ---------------- */
export async function createDb(firebaseConfig) {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    return new LocalDb();
  }
  const [{ initializeApp }, fs] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  return new FirestoreDb(app, fs);
}
