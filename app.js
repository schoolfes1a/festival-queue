// ============================================================
// スタッフ画面の共通モジュール
//
//  - Firebase インスタンスの再エクスポート
//  - スタッフ認証ガード
//  - 共通ヘッダー / タブバーの生成（各ページで書かない）
//  - 注文データの購読（全ページで同じクエリ形状を使う）
//  - 表示ヘルパー・共通の更新処理
//
// スタッフ画面（reception / orders / settings / logs）は
// すべてこのファイルを経由する。UI やロジックを直すときは
// まずここを見ればよい、という状態を保つこと。
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

// ===== ナビゲーション定義 =====
// ページを増減するときはここだけ直せば全ページのタブが揃う。
export const NAV = [
  { id: "reception", href: "reception.html", label: "受付",       badge: "pending" },
  { id: "orders",    href: "orders.html",    label: "提供リスト", badge: "entered" },
  { id: "settings",  href: "settings.html",  label: "設定" },
  { id: "logs",      href: "logs.html",      label: "ログ" },
];

// ===== ステータス定義 =====
// 値そのものは既存の Firestore データと互換を保つため変更しない。
export const STATUS = {
  pending:   { label: "未入店",     cls: "status-pending"   },
  entered:   { label: "提供待ち",   cls: "status-entered"   },
  served:    { label: "提供済み",   cls: "status-served"    },
  cancelled: { label: "キャンセル", cls: "status-cancelled" },
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
  if (!items || items.length === 0) return `<span class="muted">（商品なし）</span>`;
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

// ===== 通知音 =====
// 端末によっては最初のユーザー操作より前は鳴らせないため、失敗は無視する。
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
    // 鳴らせない環境でも本来の操作は止めない
  }
}

// ===== トースト表示 =====
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

// ===== 共通シェル（ヘッダー＋タブ）=====
export function mountShell({ active, title }) {
  const host = document.getElementById("shell");
  if (!host) return;
  host.innerHTML = `
    <header class="topbar">
      <h1>${esc(title)}</h1>
      <div class="topbar-right">
        <span class="staff-chip" id="staff-label">…</span>
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
// onAuthStateChanged は複数回発火しうるので、初期化は必ず1回だけ走らせる。
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

// ===== データ購読 =====
// 全ページで同じ並び順（整理券番号の降順）を使う。
export function subscribeOrders(handler) {
  return onSnapshot(
    query(collection(db, "orders"), orderBy("ticketNumber", "desc")),
    (snap) => handler(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap),
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

// ===== タブのバッジ（未入店 / 提供待ちの件数）=====
// どのページを開いていても「今どこに何件たまっているか」が見えるようにする。
export function updateNavBadges(orders) {
  const counts = {
    pending: orders.filter((o) => o.status === "pending").length,
    entered: orders.filter((o) => o.status === "entered").length,
  };
  document.querySelectorAll("[data-badge]").forEach((el) => {
    const n = counts[el.dataset.badge] || 0;
    el.textContent = n;
    el.hidden = n === 0;
  });
}

// ===== 新着検知 =====
// 「新しい注文が入っても気づけない」対策。初回ロード分は新着扱いしない。
export function createArrivalWatcher(matches) {
  let primed = false;
  return function detect(snap) {
    const ids = [];
    snap.docChanges().forEach((c) => {
      if (c.type === "removed") return;
      const data = { id: c.doc.id, ...c.doc.data() };
      if (matches(data)) ids.push(c.doc.id);
    });
    if (!primed) {
      primed = true;
      return [];
    }
    return ids;
  };
}

// ===== 共通の更新処理 =====
// ステータス変更・呼び出し番号の変更はここに集約し、ログの取り方も1か所に揃える。
const STATUS_ACTION = {
  pending:   "未入店に戻す",
  entered:   "入店",
  served:    "提供済み",
  cancelled: "キャンセル",
};

export async function setOrderStatus(order, status, staffEmail) {
  // 描画直後に他端末の更新でリストが差し替わると、押した注文が
  // 手元の配列から消えていることがある。その場合は何もしない。
  if (!order) {
    toast("対象の注文が見つかりませんでした。画面を確認してください", "err");
    return;
  }
  try {
    await updateDoc(doc(db, "orders", order.id), {
      status,
      updatedAt: serverTimestamp(),
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
    toast("対象の注文が見つかりませんでした。画面を確認してください", "err");
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
    await setDoc(doc(db, "state", "ticket"), { currentNumber: value }, { merge: true });
    logOperation(staffEmail, reason, `${value}番`);
  } catch (e) {
    console.error(e);
    toast("呼び出し番号の更新に失敗しました", "err");
  }
}
