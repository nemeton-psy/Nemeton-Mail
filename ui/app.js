// Nemeton Mail – Oberfläche
// Bedienung: Klick wählt aus, Doppelklick/Enter öffnet rechts, Entf löscht,
// Rücktaste/Esc schließt den Lesebereich, Pfeiltasten wechseln die Auswahl.
"use strict";

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

const S = {
  folders: [],
  folder: "INBOX",
  list: [],          // aktuell angezeigte Mails
  sel: null,         // Schlüssel der ausgewählten Mail ("ordner|uid")
  opened: null,      // Schlüssel der geöffneten Mail
  scope: "folder",   // Suche: "folder" oder "all"
  query: "",
  searching: false,
  testMode: true,    // Testmodus: auf dem Server wird nichts geändert
  hidden: new Set(), // im Testmodus "gelöschte" Mails (nur in der App ausgeblendet)
  localSeen: new Map(), // im Testmodus geänderter Gelesen-Status
};
const key = (m) => m.folder + "|" + m.uid;
const find = (k) => S.list.find((m) => key(m) === k);

/* ---------- Hilfen ---------- */
let toastT;
function toast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), isErr ? 7000 : 3500);
}
function fmtDate(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === y.toDateString()) return "Gestern";
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) ;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtLong(sec) {
  return sec ? new Date(sec * 1000).toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" }) : "";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function folderName(id) {
  return S.folders.find((f) => f.id === id)?.name ?? id;
}

/* ---------- Einstellungen (pro Gerät) ---------- */
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function applyTheme(t) {
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  for (const id of ["auto", "dark", "light"]) $("t-" + id).setAttribute("aria-pressed", String((t || "auto") === id));
  store("theme", t || "auto");
}
function applySize(v) {
  document.documentElement.style.setProperty("--scale", v);
  $("sz").value = v;
  store("scale", v);
  fitMail();
}

/* ---------- Breite von Ordnerleiste und Lesebereich ---------- */
function applyWidths() {
  const side = Number(load("sideW")) || 0, list = Number(load("listW")) || 0;
  if (side) document.body.style.setProperty("--side-w", side + "px");
  if (list) document.body.style.setProperty("--list-w", list + "px");
}
function dragSplit(handle, onMove, onEnd) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("drag");
    document.body.classList.add("dragging");
    const move = (ev) => onMove(ev.clientX);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.classList.remove("drag");
      document.body.classList.remove("dragging");
      onEnd();
      fitMail();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  });
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let sideW = 0, listW = 0;
dragSplit($("split-side"), (x) => {
  const left = document.querySelector(".body").getBoundingClientRect().left;
  sideW = Math.round(clamp(x - left, 150, 480));
  document.body.style.setProperty("--side-w", sideW + "px");
}, () => sideW && store("sideW", sideW));
dragSplit($("split-read"), (x) => {
  const r = $("main").getBoundingClientRect();
  listW = Math.round(clamp(x - r.left, 260, r.width - 420));
  document.body.style.setProperty("--list-w", listW + "px");
  fitMail();
}, () => listW && store("listW", listW));
$("split-side").ondblclick = () => { document.body.style.removeProperty("--side-w"); store("sideW", ""); };
$("split-read").ondblclick = () => { document.body.style.removeProperty("--list-w"); store("listW", ""); fitMail(); };

/* ---------- Start ---------- */
async function start() {
  applyTheme(load("theme") || "auto");
  applySize(load("scale") || "1");
  applyWidths();
  const acc = await invoke("get_account");
  if (!acc) return showSetup();
  setTestMode(acc.test_mode !== false);
  showApp();
}

function showSetup(message) {
  $("app").hidden = true;
  $("setup").hidden = false;
  $("s-error").hidden = !message;
  $("s-error").textContent = message || "";
  $("s-email").focus();
}

async function showApp() {
  $("setup").hidden = true;
  $("app").hidden = false;
  await loadFolders();
  await openFolder("INBOX");
}

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("s-submit");
  btn.disabled = true; btn.textContent = "Verbinde …";
  try {
    await invoke("save_account", {
      email: $("s-email").value.trim(),
      password: $("s-pass").value,
      host: $("s-host").value.trim(),
      port: Number($("s-port").value) || 993,
    });
    $("s-pass").value = "";
    setTestMode(true);
    showApp();
  } catch (err) {
    showSetup(String(err));
  } finally {
    btn.disabled = false; btn.textContent = "Verbinden";
  }
});

/* ---------- Ordner ---------- */
async function loadFolders() {
  try {
    S.folders = sortFolders(await invoke("list_folders"));
  } catch (err) {
    toast("Ordner konnten nicht geladen werden: " + err, true);
  }
  renderFolders();
}

// Systemordner (Posteingang, Entwürfe, …) bleiben oben in fester Reihenfolge.
// Alle anderen: Sonderzeichen zuerst, dann Zahlen (0, 1, 2 … 10), dann A–Z.
// Unterordner stehen direkt unter ihrem Oberordner.
const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
function sortFolders(list) {
  const sys = list.filter((f) => f.role);
  const rest = list.filter((f) => !f.role);
  rest.sort((a, b) => {
    const pa = a.path?.length ? a.path : [a.name], pb = b.path?.length ? b.path : [b.name];
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const c = collator.compare(pa[i], pb[i]);
      if (c) return c;
    }
    return pa.length - pb.length;
  });
  return [...sys, ...rest];
}

function renderFolders() {
  const box = $("folders");
  box.innerHTML = "";
  let headed = false;
  for (const f of S.folders) {
    if (!f.role && !headed) {
      const h = document.createElement("h2"); h.textContent = "Ordner"; box.appendChild(h); headed = true;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "folder" + (f.id === S.folder && !isAllSearch() ? " on" : "");
    b.title = f.name;
    b.style.paddingLeft = (0.6 + f.depth * 0.9) + "em";
    b.innerHTML = `<span class="dotf"></span><span class="ini"></span><span class="lbl"></span><span class="n"></span>`;
    b.querySelector(".ini").textContent = f.name.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 2);
    b.querySelector(".lbl").textContent = f.name;
    b.querySelector(".n").textContent = f.unseen || "";
    b.onclick = () => openFolder(f.id);
    box.appendChild(b);
  }
}

async function openFolder(id) {
  S.folder = id;
  S.opened = null;
  S.query = ""; $("q").value = "";
  renderFolders();
  await reloadList();
  $("mails").focus();
}

async function reloadList() {
  $("ftitle").textContent = folderName(S.folder);
  if (!S.list.length) $("mails").innerHTML = `<div class="empty">Lade Nachrichten …</div>`;
  try {
    S.list = applyLocal(await invoke("list_messages", { folder: S.folder, limit: 300 }));
  } catch (err) {
    S.list = [];
    toast("Nachrichten konnten nicht geladen werden: " + err, true);
  }
  if (!find(S.sel)) S.sel = S.list[0] ? key(S.list[0]) : null;
  render();
}

/* ---------- Suche ---------- */
const isAllSearch = () => S.scope === "all" && S.query !== "";
let searchT;
$("q").addEventListener("input", () => {
  clearTimeout(searchT);
  searchT = setTimeout(runSearch, 450);
});
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(searchT); runSearch(); }
  if (e.key === "Escape") { $("q").value = ""; runSearch(); $("mails").focus(); }
});
async function runSearch() {
  S.query = $("q").value.trim();
  S.opened = null;
  renderFolders();
  if (!S.query) return reloadList();
  S.searching = true; render();
  try {
    S.list = applyLocal(await invoke("search", { query: S.query, folder: S.scope === "all" ? null : S.folder }));
  } catch (err) {
    S.list = [];
    toast("Suche fehlgeschlagen: " + err, true);
  }
  S.searching = false;
  S.sel = S.list[0] ? key(S.list[0]) : null;
  render();
}
function setScope(s) {
  S.scope = s;
  $("s-folder").setAttribute("aria-pressed", String(s === "folder"));
  $("s-all").setAttribute("aria-pressed", String(s === "all"));
  if (S.query) runSearch();
}
$("s-folder").onclick = () => setScope("folder");
$("s-all").onclick = () => setScope("all");

/* ---------- Liste ---------- */
function render() {
  const box = $("mails");
  box.innerHTML = "";
  const all = isAllSearch();
  $("ftitle").textContent = all ? "Suche in allen Ordnern" : folderName(S.folder);
  const f = S.folders.find((x) => x.id === S.folder);
  $("sum").textContent = S.query
    ? (S.searching ? "Suche läuft …" : `${S.list.length} Treffer ${all ? "in allen Ordnern" : "in " + folderName(S.folder)}`)
    : f ? `${f.unseen} ungelesen · ${f.total} Nachrichten` : "";
  $("col-who").textContent = all ? "Von / An" : isSentFolder(S.folder) ? "An" : "Von";

  if (S.searching) {
    box.innerHTML = `<div class="empty">Suche läuft …</div>`;
  } else {
    if (!S.list.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = S.query ? (S.scope === "all" ? "Nichts gefunden." : "Nichts gefunden. Versuch es mit „Alle Ordner“.") : "Dieser Ordner ist leer.";
      box.appendChild(e);
    }
    for (const m of S.list) box.appendChild(row(m, all));
  }
  $("main").classList.toggle("open", S.opened !== null);
  box.querySelector(".mail.on")?.scrollIntoView({ block: "nearest" });
}

function isSentFolder(id) {
  const r = S.folders.find((x) => x.id === id)?.role;
  return r === "sent" || r === "drafts";
}

function row(m, showFolder) {
  const el = document.createElement("div");
  const k = key(m);
  el.className = "mail" + (m.seen ? "" : " unread") + (k === S.sel ? " on" : "");
  el.innerHTML = `<span class="from"></span><span class="fold"></span><span class="date"></span><span class="tools"><button class="rd" type="button"></button><button class="del" type="button">Löschen</button></span><span class="subj"></span>`;
  const sent = isSentFolder(m.folder);
  el.querySelector(".from").textContent = sent ? "An: " + (m.to || "(unbekannt)") : (m.from || m.from_addr || "(unbekannt)");
  el.querySelector(".from").title = sent ? m.to : m.from_addr;
  el.querySelector(".fold").textContent = folderName(m.folder);
  el.querySelector(".date").textContent = fmtDate(m.date);
  el.querySelector(".subj").textContent = m.subject || "(kein Betreff)";
  if (showFolder) {
    const t = document.createElement("span"); t.className = "tag"; t.textContent = folderName(m.folder);
    el.querySelector(".subj").prepend(t);
  }
  const rd = el.querySelector(".rd");
  rd.textContent = m.seen ? "Ungelesen" : "Gelesen";
  rd.title = m.seen ? "Als ungelesen markieren" : "Als gelesen markieren";
  rd.onclick = (e) => { e.stopPropagation(); toggleSeen(m); };
  el.querySelector(".del").onclick = (e) => { e.stopPropagation(); remove(k); };
  el.onclick = () => { S.sel = k; render(); $("mails").focus(); };
  el.ondblclick = () => openMail(k);
  return el;
}

/* ---------- Testmodus ---------- */
function applyLocal(list) {
  if (!S.testMode) return list;
  return list
    .filter((m) => !S.hidden.has(key(m)))
    .map((m) => (S.localSeen.has(key(m)) ? { ...m, seen: S.localSeen.get(key(m)) } : m));
}
function setTestMode(on) {
  S.testMode = on;
  $("tm-group").classList.toggle("on", on);
  $("tm-on").setAttribute("aria-pressed", String(on));
  $("tm-off").setAttribute("aria-pressed", String(!on));
  $("tm-off").textContent = "Ausschalten";
  delete $("tm-off").dataset.confirm;
  $("tm-note").textContent = on
    ? "An – Server bleibt unverändert"
    : "Aus – Änderungen gehen an den Server";
  $("tm-group").title = on
    ? "Testmodus an: Auf dem Server wird nichts geändert. Löschen und Gelesen-Markieren passieren nur in der App."
    : "Testmodus aus: Löschen und Markieren werden auf dem Server ausgeführt.";
  if (!on) { S.hidden.clear(); S.localSeen.clear(); }
}
$("tm-off").onclick = async () => {
  if (!S.testMode) return;
  const b = $("tm-off");
  if (!b.dataset.confirm) {
    b.dataset.confirm = "1";
    b.textContent = "Wirklich ausschalten? Nochmal klicken";
    setTimeout(() => { if (S.testMode) setTestMode(true); }, 6000);
    return;
  }
  await invoke("set_test_mode", { on: false });
  setTestMode(false);
  toast("Testmodus aus: Änderungen gehen jetzt an den Server.");
  reloadList();
};
$("tm-on").onclick = async () => {
  if (S.testMode) return;
  await invoke("set_test_mode", { on: true });
  setTestMode(true);
  toast("Testmodus an: Auf dem Server wird nichts geändert.");
};

/* ---------- Aktionen ---------- */
function bumpUnread(folder, delta) {
  const f = S.folders.find((x) => x.id === folder);
  if (f) { f.unseen = Math.max(0, f.unseen + delta); renderFolders(); }
}

async function toggleSeen(m) {
  const seen = !m.seen;
  m.seen = seen; bumpUnread(m.folder, seen ? -1 : 1); render();
  if (S.testMode) { S.localSeen.set(key(m), seen); return; }
  try { await invoke("set_seen", { folder: m.folder, uid: m.uid, seen }); }
  catch (err) { m.seen = !seen; bumpUnread(m.folder, seen ? 1 : -1); render(); toast("Konnte nicht geändert werden: " + err, true); }
}

let openToken = 0;
async function openMail(k) {
  const m = find(k);
  if (!m) return;
  S.sel = k; S.opened = k;
  if (!m.seen) { m.seen = true; bumpUnread(m.folder, -1); if (S.testMode) S.localSeen.set(k, true); }
  render();
  const token = ++openToken;
  $("read").innerHTML = `<div class="loading">Lade Nachricht …</div>`;
  try {
    const msg = await invoke("get_message", { folder: m.folder, uid: m.uid });
    if (token === openToken) showMessage(msg);
  } catch (err) {
    if (token === openToken) $("read").innerHTML = `<div class="loading">Die Nachricht konnte nicht geladen werden: ${esc(err)}</div>`;
  }
}

function showMessage(msg) {
  const r = $("read");
  r.innerHTML = `
    <div class="read-head">
      <div class="acts">
        <button type="button" disabled title="Kommt bald">Antworten</button>
        <button type="button" disabled title="Kommt bald">Weiterleiten</button>
        <button type="button" id="r-del">Löschen</button>
        <button type="button" class="close" id="r-close" title="Rücktaste">Schließen ✕</button>
      </div>
      <h4></h4>
      <div class="meta"><div class="av"></div><div style="min-width:0"><b></b><span class="to"></span></div></div>
      <div class="atts"></div>
    </div>
    <div class="read-body"><iframe sandbox="allow-same-origin" title="Inhalt der Nachricht"></iframe></div>`;
  r.querySelector("h4").textContent = msg.subject || "(kein Betreff)";
  r.querySelector(".av").textContent = (msg.from || msg.from_addr || "?").trim()[0]?.toUpperCase() || "?";
  r.querySelector(".meta b").textContent = msg.from_addr && msg.from !== msg.from_addr ? `${msg.from} <${msg.from_addr}>` : msg.from;
  r.querySelector(".to").textContent = `an ${msg.to}${msg.cc ? ", Kopie: " + msg.cc : ""} · ${fmtLong(msg.date)}`;
  const atts = r.querySelector(".atts");
  for (const a of msg.attachments) { const s = document.createElement("span"); s.textContent = "📎 " + a; atts.appendChild(s); }
  // Inhalt in einem abgeschotteten Rahmen: keine Skripte, keine Bilder aus dem Netz.
  const base = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
    <style>body{font-family:${getComputedStyle(document.body).fontFamily};font-size:15px;line-height:1.6;color:#18202c;margin:1.2em 1.6em;overflow-wrap:anywhere}
    img,video{max-width:100%!important;height:auto!important}pre{white-space:pre-wrap}table{width:auto!important;max-width:100%!important}td,th{width:auto!important;overflow-wrap:anywhere}</style>`;
  r.querySelector("iframe").srcdoc = msg.html
    ? base + msg.html
    : base + `<pre>${esc(msg.text || "(kein Inhalt)")}</pre>`;
  const frame = r.querySelector("iframe");
  frame.addEventListener("load", () => {
    // Feste Bildgrößen entfernen: Bilder aus dem Netz sind gesperrt und
    // würden sonst als leere Kästen die Mail unnötig breit machen.
    for (const img of frame.contentDocument?.querySelectorAll("img") ?? []) {
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    fitMail();
  });
  $("r-close").onclick = closeMail;
  $("r-del").onclick = () => remove(key(msg));
}

// Mail immer auf die Breite des Lesebereichs einpassen: erst mit der
// gewählten Schriftgröße vergrößern, und falls die Mail (z.B. ein Newsletter
// mit fester Breite) dann breiter ist als der Platz, so weit verkleinern,
// dass nichts seitlich gescrollt werden muss.
function fitMail() {
  const frame = document.querySelector("#read iframe");
  const doc = frame?.contentDocument;
  if (!doc?.body) return;
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--scale")) || 1;
  doc.documentElement.style.zoom = "1";
  doc.body.style.zoom = String(scale);
  const avail = doc.documentElement.clientWidth;
  const need = doc.documentElement.scrollWidth;
  if (need > avail + 1) {
    doc.body.style.zoom = String(Math.max(0.3, scale * (avail / need)));
  }
}
if (window.ResizeObserver) new ResizeObserver(() => fitMail()).observe($("read"));

function closeMail() {
  S.opened = null;
  render();
  $("mails").focus();
}

async function remove(k) {
  const i = S.list.findIndex((m) => key(m) === k);
  if (i < 0) return;
  const m = S.list[i];
  const next = S.list[i + 1] || S.list[i - 1];
  const wasOpen = S.opened === k;
  S.list.splice(i, 1);
  if (!m.seen) bumpUnread(m.folder, -1);
  S.sel = next ? key(next) : null;
  if (wasOpen) S.opened = null;
  render();
  if (wasOpen && next) openMail(key(next));
  if (S.testMode) {
    S.hidden.add(k);
    toast("Testmodus: nur in der App ausgeblendet. Auf dem Server bleibt die Mail.");
    return;
  }
  try {
    await invoke("delete_message", { folder: m.folder, uid: m.uid });
    toast("In den Papierkorb verschoben: " + (m.subject || "(kein Betreff)"));
    loadFolders();
  } catch (err) {
    S.list.splice(i, 0, m);
    render();
    toast("Löschen fehlgeschlagen: " + err, true);
  }
}

/* ---------- Tastatur ---------- */
$("mails").addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = S.list.findIndex((m) => key(m) === S.sel);
  const move = (d) => {
    const n = S.list[Math.min(Math.max(i + d, 0), S.list.length - 1)];
    if (!n) return;
    S.sel = key(n);
    if (S.opened !== null) openMail(S.sel); else render();
  };
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); move(1); break;
    case "ArrowUp": e.preventDefault(); move(-1); break;
    case "Enter": if (S.sel) openMail(S.sel); break;
    case "Delete": e.preventDefault(); if (S.sel) remove(S.sel); break;
    case "Backspace":
    case "Escape": e.preventDefault(); if (S.opened !== null) closeMail(); break;
  }
});
// Rücktaste/Esc auch, wenn der Fokus im Lesebereich liegt.
document.addEventListener("keydown", (e) => {
  if (S.opened === null || e.target.closest?.("input, textarea, #mails")) return;
  if (e.key === "Backspace" || e.key === "Escape") { e.preventDefault(); closeMail(); }
  if (e.key === "Delete") { e.preventDefault(); remove(S.opened); }
});

/* ---------- Leiste unten links ---------- */
$("t-auto").onclick = () => applyTheme("auto");
$("t-dark").onclick = () => applyTheme("dark");
$("t-light").onclick = () => applyTheme("light");
$("sz").oninput = (e) => applySize(e.target.value);
$("btn-refresh").onclick = async () => {
  const b = $("btn-refresh");
  if (b.classList.contains("busy")) return;
  b.classList.add("busy"); b.textContent = "↻ Rufe ab …";
  try {
    await loadFolders();
    await (S.query ? runSearch() : reloadList());
    toast("Mails abgerufen.");
  } finally {
    b.classList.remove("busy"); b.textContent = "↻ Abrufen";
  }
};
$("btn-new").onclick = () => toast("Mails schreiben kommt im nächsten Schritt.");
$("btn-logout").onclick = async () => {
  await invoke("logout");
  S.list = []; S.folders = []; S.sel = S.opened = null;
  showSetup();
};

// Alle 2 Minuten nach neuen Mails sehen (nicht während einer Suche).
setInterval(() => {
  if ($("app").hidden || S.query) return;
  loadFolders();
  reloadList();
}, 120000);

start().catch((err) => showSetup(String(err)));
