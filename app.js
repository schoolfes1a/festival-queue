// ============================================================
// スタッフ画面の共通モジュール
//
// 運用の流れ:
//   ①整理券を発行  ②番号を呼ぶ  ③食券を購入  ④入店待ち  ⑤入店  ⑥提供(任意)
//
// 「呼び出し中」は状態として保存しない。
//   整理券番号 <= 呼び出し番号  かつ  まだ購入していない
// という条件から毎回導出する。番号を進めるだけで一覧に乗るので、
// 書き込み漏れによる食い違いが起きない。
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, doc, onSnapshot, query, orderBy,
  setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { logOrder, logOperation } from "./logger.js";

export { auth, db };

// ===== ナビゲーション =====
export const NAV = [
  { id: "reception", href: "reception.html", label: "受付",       badge: "called" },
  { id: "orders",    href: "orders.html",    label: "提供リスト", badge: "waiting" },
  { id: "sales",     href: "sales.html",     label: "売上" },
  { id: "settings",  href: "settings.html",  label: "設定" },
  { id: "logs",      href: "logs.html",      label: "ログ" },
];

// ===== 状態 =====
// called は導出専用（Firestore には保存しない）
export const STATUS = {
  issued:    { label: "呼び出し前", cls: "status-issued" },
  called:    { label: "呼び出し中", cls: "status-called" },
  purchased: { label: "入店待ち",   cls: "status-purchased" },
  entered:   { label: "入店済み",   cls: "status-entered" },
  served:    { label: "提供済み",   cls: "status-served" },
  skipped:   { label: "呼び飛ばし", cls: "status-skipped" },
  cancelled: { label: "キャンセル", cls: "status-cancelled" },
};

// 旧データ（pending / 注文と同時に発行していた頃）の読み替え
export function normalizeStatus(s) {
  if (!s || s === "pending") return "issued";
  return s;
}

// 保存された状態と呼び出し番号から、画面に出す状態を決める
export function effectiveStatus(order, currentNumber) {
  const s = normalizeStatus(order.status);
  if (s === "issued" && Number(order.ticketNumber) <= Number(currentNumber || 0)) return "called";
  return s;
}

// ===== 既定の設定 =====
export const DEFAULT_CONFIG = {
  useServed: true,  // 「提供済み」の工程を使うか
  autoCall:  true,  // 入店時に呼び出し番号を自動で進めるか
  lookahead: 3,     // 入店した番号の何個先まで呼ぶか
  soloMode:  false, // 受付1台で入店・提供まで全部やるか
};

// ===== 表示ヘルパー =====
export function esc(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

export function yen(n) {
  return "¥" + Number(n || 0).toLocaleString("ja-JP");
}

export function calcTotal(items) {
  return (items || []).reduce((sum, i) => sum + Number(i.price || 0) * Number(i.qty || 0), 0);
}

export function formatItems(items) {
  return (items || []).map((i) => `${i.name} ×${i.qty}`).join(", ");
}

export function itemsHtml(items) {
  if (!items || items.length === 0) return `<span class="muted">未購入</span>`;
  return items
    .map((i) => `<span class="item-chip">${esc(i.name)}<b>×${esc(i.qty)}</b></span>`)
    .join("");
}

export function statusLabel(status) {
  const s = STATUS[status];
  return s ? `<span class="${s.cls}">${s.label}</span>` : esc(status);
}

export function fmtTime(ts) {
  if (!ts) return "-";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("ja-JP");
}

export function fmtClock(ts) {
  if (!ts || !ts.toDate) return "";
  const d = ts.toDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// その日のうちかどうか（売上集計用）
export function isToday(ts) {
  if (!ts || !ts.toDate) return false;
  const d = ts.toDate();
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// ===== 通知音 =====
export function beep(times = 1) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch (e) {
    // 鳴らせない環境でも操作は止めない
  }
}

// ===== トースト =====
let toastTimer = null;
export function toast(message, kind = "ok") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast-${kind} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ===== 共通シェル =====
export function mountShell({ active, title }) {
  const host = document.getElementById("shell");
  if (!host) return;
  host.innerHTML = `
    <header class="topbar">
      <h1>${esc(title)}</h1>
      <div class="topbar-right">
        <span class="staff-chip" id="staff-label">…</span>
        <a class="text-link" href="display.html" target="_blank" rel="noopener">番号表示 ↗</a>
        <a class="text-link" href="index.html" target="_blank" rel="noopener">お客様画面 ↗</a>
        <button id="logout-btn" class="gray small">ログアウト</button>
      </div>
    </header>
    <nav class="tabbar page-tabbar">
      ${NAV.map((n) => `
        <a href="${n.href}" class="tab-link${n.id === active ? " active" : ""}">
          ${esc(n.label)}${n.badge ? `<span class="tab-badge" data-badge="${n.badge}" hidden>0</span>` : ""}
        </a>`).join("")}
    </nav>
  `;
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "login.html";
  });
}

// ===== 認証ガード =====
export function requireStaff(onReady) {
  let started = false;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      location.replace("login.html");
      return;
    }
    const label = document.getElementById("staff-label");
    if (label) label.textContent = user.email.split("@")[0];
    document.body.classList.add("is-ready");
    if (started) return;
    started = true;
    onReady(user);
  });
}

// ===== 購読 =====
export function subscribeOrders(handler) {
  return onSnapshot(
    query(collection(db, "orders"), orderBy("ticketNumber", "desc")),
    (snap) => handler(
      snap.docs.map((d) => ({ id: d.id, ...d.data(), status: normalizeStatus(d.data().status) })),
      snap
    ),
    (err) => {
      console.error("注文の購読に失敗しました", err);
      toast("注文データの取得に失敗しました。通信状況を確認してください", "err");
    }
  );
}

export function subscribeMenu(handler) {
  return onSnapshot(
    query(collection(db, "menu"), orderBy("name")),
    (snap) => handler(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error("メニューの購読に失敗しました", err)
  );
}

export function subscribeTicketState(handler) {
  return onSnapshot(
    doc(db, "state", "ticket"),
    (snap) => {
      const data = snap.data() || {};
      handler({
        currentNumber: Number(data.currentNumber || 0),
        latestTicket: Number(data.latestTicket || 0),
      });
    },
    (err) => console.error("呼び出し番号の購読に失敗しました", err)
  );
}

export function subscribeConfig(handler) {
  return onSnapshot(
    doc(db, "state", "config"),
    (snap) => handler({ ...DEFAULT_CONFIG, ...(snap.data() || {}) }),
    (err) => {
      console.error("設定の購読に失敗しました", err);
      handler({ ...DEFAULT_CONFIG });
    }
  );
}

export async function saveConfig(patch, staffEmail) {
  try {
    await setDoc(doc(db, "state", "config"), patch, { merge: true });
    logOperation(staffEmail, "設定変更", JSON.stringify(patch));
  } catch (e) {
    console.error(e);
    toast("設定の保存に失敗しました", "err");
  }
}

// ===== お客様画面むけの掲示板 =====
// お客様の端末に他の方の注文内容（備考など）を配らないよう、
// 番号だけを別ドキュメントに写して公開する。
// スタッフ画面が注文を受け取るたびに呼ばれ、内容が変わったときだけ書く。
let lastBoardJson = null;

export async function syncBoard(orders, currentNumber) {
  const calling = orders
    .filter((o) => effectiveStatus(o, currentNumber) === "called")
    .map((o) => Number(o.ticketNumber))
    .sort((a, b) => a - b);
  const skipped = orders
    .filter((o) => o.status === "skipped")
    .map((o) => Number(o.ticketNumber))
    .sort((a, b) => a - b);

  const json = JSON.stringify({ calling, skipped });
  if (json === lastBoardJson) return;
  lastBoardJson = json;

  try {
    await setDoc(doc(db, "state", "board"), { calling, skipped, updatedAt: serverTimestamp() });
  } catch (e) {
    console.error("掲示板の更新に失敗しました", e);
    lastBoardJson = null; // 次回また試す
  }
}

// ===== タブのバッジ =====
// 受付＝呼び出し中の件数、提供リスト＝入店待ち＋入店済みの件数。
// どのページを開いていても、いまどこに何件たまっているか分かるようにする。
export function updateNavBadges(orders, currentNumber) {
  const eff = (o) => effectiveStatus(o, currentNumber);
  const counts = {
    called: orders.filter((o) => eff(o) === "called").length,
    waiting: orders.filter((o) => eff(o) === "purchased" || eff(o) === "entered").length,
  };
  document.querySelectorAll("[data-badge]").forEach((el) => {
    const n = counts[el.dataset.badge] || 0;
    el.textContent = n;
    el.hidden = n === 0;
  });
}

// ===== 新着検知 =====
export function createArrivalWatcher(matches) {
  let primed = false;
  return function detect(snap) {
    const ids = [];
    snap.docChanges().forEach((c) => {
      if (c.type === "removed") return;
      const data = { id: c.doc.id, ...c.doc.data(), status: normalizeStatus(c.doc.data().status) };
      if (matches(data)) ids.push(c.doc.id);
    });
    if (!primed) {
      primed = true;
      return [];
    }
    return ids;
  };
}

// ===== 更新処理 =====
const STATUS_ACTION = {
  issued:    "呼び出しに戻す",
  purchased: "食券購入",
  entered:   "入店",
  served:    "提供済み",
  skipped:   "呼び飛ばし",
  cancelled: "キャンセル",
};

export async function setOrderStatus(order, status, staffEmail, extra = {}) {
  if (!order) {
    toast("対象の整理券が見つかりませんでした。画面を確認してください", "err");
    return;
  }
  try {
    await updateDoc(doc(db, "orders", order.id), {
      status,
      updatedAt: serverTimestamp(),
      ...extra,
    });
    logOrder(staffEmail, order.ticketNumber, STATUS_ACTION[status] || status, "");
    toast(`${order.ticketNumber}番を「${STATUS[status] ? STATUS[status].label : status}」にしました`);
  } catch (e) {
    console.error(e);
    toast("更新に失敗しました。もう一度お試しください", "err");
  }
}

export async function removeOrder(order, staffEmail) {
  if (!order) {
    toast("対象の整理券が見つかりませんでした", "err");
    return;
  }
  try {
    logOrder(staffEmail, order.ticketNumber, "削除", formatItems(order.items));
    await deleteDoc(doc(db, "orders", order.id));
    toast(`${order.ticketNumber}番を削除しました`);
  } catch (e) {
    console.error(e);
    toast("削除に失敗しました", "err");
  }
}

export async function setCurrentNumber(value, staffEmail, reason) {
  try {
    await setDoc(doc(db, "state", "ticket"), { currentNumber: Number(value) }, { merge: true });
    logOperation(staffEmail, reason, `${value}番`);
  } catch (e) {
    console.error(e);
    toast("呼び出し番号の更新に失敗しました", "err");
  }
}

// 入店させたとき、その番号の lookahead 個先まで自動で呼ぶ。
// 既に先を呼んでいる場合は戻さない。
export async function enterAndAdvance(order, staffEmail, config, currentNumber) {
  await setOrderStatus(order, "entered", staffEmail, { enteredAt: serverTimestamp() });
  if (!config.autoCall) return;
  const target = Number(order.ticketNumber) + Number(config.lookahead || 0);
  if (target > Number(currentNumber || 0)) {
    await setCurrentNumber(target, staffEmail, "入店にあわせて自動で呼び出し");
  }
}
