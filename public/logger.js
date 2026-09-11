// ログ記録用の共通モジュール。
// ここでの書き込みが失敗しても、本来の操作（注文確定・ログインなど）を
// 止めないよう、必ず try/catch で握りつぶしてコンソールにのみ出す。

import { db } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export async function logLogin(staffNumber, result) {
  try {
    await addDoc(collection(db, "log_login"), {
      staffNumber: staffNumber !== "" && staffNumber != null ? Number(staffNumber) : null,
      result, // "success" | "failure"
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("ログイン履歴の記録に失敗しました", e);
  }
}

export async function logAccess(page) {
  try {
    await addDoc(collection(db, "log_access"), {
      page,
      ua: navigator.userAgent,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("アクセス履歴の記録に失敗しました", e);
  }
}

export async function logOperation(staffEmail, action, detail) {
  try {
    await addDoc(collection(db, "log_operation"), {
      staffEmail: staffEmail || null,
      action,
      detail: detail || "",
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("操作履歴の記録に失敗しました", e);
  }
}

export async function logOrder(staffEmail, ticketNumber, action, detail) {
  try {
    await addDoc(collection(db, "log_order"), {
      staffEmail: staffEmail || null,
      ticketNumber: ticketNumber != null ? Number(ticketNumber) : null,
      action,
      detail: detail || "",
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("注文履歴の記録に失敗しました", e);
  }
}
