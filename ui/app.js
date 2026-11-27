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
  cat: null,         // Kategorie-Filter (null = alle)
  multi: new Set(),  // weitere markierte Mails (Mehrfachauswahl)
  anchor: null,      // Startpunkt für Shift-Auswahl
  base: [],          // alle geladenen Mails des Ordners (für die Sofortsuche)
  sel: null,         // Schlüssel der ausgewählten Mail ("ordner|uid")
  opened: null,      // Schlüssel der geöffneten Mail
  scope: "folder",   // Suche: "folder" oder "all"
  query: "",
  searching: false,
  testMode: false,   // den Testmodus gibt es nicht mehr; alles geht an den Server
  hidden: new Set(), // im Testmodus "gelöschte" Mails (nur in der App ausgeblendet)
  localSeen: new Map(), // im Testmodus geänderter Gelesen-Status
  keepShown: new Set(), // bei „Nur ungelesene“: gerade gelesene Mails bleiben sichtbar
  gone: new Map(),      // gelöschte/verschobene Mails → Zeitpunkt (damit sie nicht wieder auftauchen)
};
const key = (m) => m.folder + "|" + m.uid;
const find = (k) => S.list.find((m) => key(m) === k);
// Alle markierten Mails (Mehrfachauswahl oder die eine ausgewählte).
function selectedKeys() {
  if (S.multi.size) return [...S.multi].filter((k) => find(k));
  return S.sel && find(S.sel) ? [S.sel] : [];
}
const isSelected = (k) => k === S.sel || S.multi.has(k);
function selectRange(toKey) {
  const vl = viewList();
  const a = vl.findIndex((m) => key(m) === (S.anchor || S.sel));
  const b = vl.findIndex((m) => key(m) === toKey);
  if (a < 0 || b < 0) { S.multi.clear(); return; }
  S.multi = new Set(vl.slice(Math.min(a, b), Math.max(a, b) + 1).map(key));
  if (S.multi.size < 2) S.multi.clear();
}

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
    const move = (ev) => onMove(ev.clientX, ev.clientY);
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
let listH = 0;
dragSplit($("split-read"), (x, y) => {
  const r = $("main").getBoundingClientRect();
  if (S.view === "bottom") {
    listH = Math.round(clamp(y - r.top, 140, r.height - 200));
    document.body.style.setProperty("--list-h", listH + "px");
  } else {
    listW = Math.round(clamp(x - r.left, 260, r.width - 420));
    document.body.style.setProperty("--list-w", listW + "px");
  }
  fitMail();
}, () => { if (S.view === "bottom") { if (listH) store("listH", listH); } else if (listW) store("listW", listW); });
$("split-side").ondblclick = () => { document.body.style.removeProperty("--side-w"); store("sideW", ""); };
$("split-read").ondblclick = () => {
  if (S.view === "bottom") { document.body.style.removeProperty("--list-h"); store("listH", ""); }
  else { document.body.style.removeProperty("--list-w"); store("listW", ""); }
  fitMail();
};

/* ---------- Einstellungen: wo sich Mails öffnen ---------- */
function applyView(v) {
  S.view = ["right", "full", "bottom"].includes(v) ? v : "right";
  document.body.dataset.view = S.view;
  store("view", S.view);
  for (const b of document.querySelectorAll(".viewopts button")) b.setAttribute("aria-pressed", String(b.dataset.view === S.view));
  $("split-read").title = S.view === "bottom" ? "Ziehen, um Liste und Mail höher oder niedriger zu machen" : "Ziehen, um den Lesebereich breiter oder schmaler zu machen";
  if ($("main")) render();
  fitMail();
}
for (const b of document.querySelectorAll(".viewopts button")) b.onclick = () => applyView(b.dataset.view);
$("btn-settings").onclick = (e) => {
  e.stopPropagation();
  const p = $("settings"); p.hidden = !p.hidden;
  $("btn-settings").setAttribute("aria-expanded", String(!p.hidden));
};
document.addEventListener("pointerdown", (e) => {
  if (!$("settings").hidden && !e.target.closest("#settings, #btn-settings")) { $("settings").hidden = true; $("btn-settings").setAttribute("aria-expanded", "false"); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("settings").hidden) { e.stopPropagation(); $("settings").hidden = true; }
}, true);

/* ---------- Start ---------- */
async function start() {
  applyTheme(load("theme") || "auto");
  applySize(load("scale") || "1");
  applyWidths();
  const lh = Number(load("listH")) || 0;
  if (lh) document.body.style.setProperty("--list-h", lh + "px");
  applyView(load("view") || "right");
  invoke("app_version").then((v) => { $("ver").textContent = "Version " + v; }).catch(() => {});
  const acc = await invoke("get_account");
  if (!acc) return showSetup();
  S.acc = acc;
  setTestMode();
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
    S.acc = await invoke("get_account");
    setTestMode();
    showApp();
  } catch (err) {
    showSetup(String(err));
  } finally {
    btn.disabled = false; btn.textContent = "Verbinden";
  }
});

/* ---------- Ordner ---------- */
let foldersToken = 0;
async function loadFolders({ quiet = false } = {}) {
  const token = ++foldersToken;
  try {
    const list = sortFolders(await invoke("list_folders"));
    if (token !== foldersToken) return;
    S.folders = list;
  } catch (err) {
    if (!quiet) toast("Ordner konnten nicht geladen werden: " + err, true);
  }
  renderFolders();
  if (!quiet) return;
  // Zähler oben aktualisieren, ohne die Liste neu aufzubauen
  const f = S.folders.find((x) => x.id === S.folder);
  if (f && !S.query) $("sum").textContent = `${f.unseen} ungelesen · ${f.total} Nachrichten`;
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
    b.dataset.id = f.id;
    b.style.paddingLeft = (0.6 + f.depth * 0.9) + "em";
    b.innerHTML = `<span class="dotf"></span><span class="ini"></span><span class="lbl"></span><span class="n"></span>`;
    b.querySelector(".ini").textContent = f.name.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 2);
    b.querySelector(".lbl").textContent = f.name;
    b.querySelector(".n").textContent = f.unseen || "";
    b.onclick = () => openFolder(f.id);
    b.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-nemeton-mail")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      b.classList.add("drop");
    });
    b.addEventListener("dragleave", () => b.classList.remove("drop"));
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop");
      const keys = e.dataTransfer.getData("text/x-nemeton-mail").split("\n").filter(Boolean);
      if (keys.length) moveMany(keys, f.id);
    });
    box.appendChild(b);
  }
}

async function openFolder(id) {
  S.folder = id;
  S.keepShown.clear();
  S.opened = null;
  S.query = ""; $("q").value = "";
  renderFolders();
  await reloadList();
  $("mails").focus();
}

// Gelöschte oder verschobene Mails merken, bis der Server es sicher
// bestätigt hat. Eine Liste, die der Server kurz vorher geschickt hat,
// enthält sie sonst noch – und sie tauchten plötzlich wieder auf.
function markGone(keys) { const t = Date.now(); for (const k of keys) S.gone.set(k, t); }
function unmarkGone(keys) { for (const k of keys) S.gone.delete(k); }
function dropGone(list) {
  const old = Date.now() - 10 * 60000;
  for (const [k, t] of S.gone) if (t < old) S.gone.delete(k);
  return S.gone.size ? list.filter((m) => !S.gone.has(key(m))) : list;
}

let listToken = 0;
async function reloadList({ quiet = false } = {}) {
  const folder = S.folder;
  const token = ++listToken;
  $("ftitle").textContent = folderName(folder);
  if (!S.list.length && !quiet) $("mails").innerHTML = `<div class="empty">Lade Nachrichten …</div>`;
  let list;
  try {
    list = await invoke("list_messages", { folder, limit: 300, background: quiet });
  } catch (err) {
    if (token !== listToken || folder !== S.folder) return;
    if (quiet) return; // beim stillen Abgleich die Liste einfach stehen lassen
    S.list = []; S.base = [];
    toast("Nachrichten konnten nicht geladen werden: " + err, true);
    render();
    return;
  }
  // Inzwischen anderer Ordner oder neueres Laden gestartet: Ergebnis verwerfen.
  if (token !== listToken || folder !== S.folder || S.query) return;
  // Was in der App schon als gelesen markiert ist, bleibt gelesen.
  const seenHere = new Set(S.list.filter((m) => m.seen).map(key));
  S.list = applyLocal(dropGone(list)).map((m) => (!m.seen && seenHere.has(key(m)) && S.keepShown.has(key(m)) ? { ...m, seen: true } : m));
  S.base = S.list.slice();
  sortOutAds();
  if (!find(S.sel)) S.sel = S.list[0] ? key(S.list[0]) : null;
  for (const k of [...S.multi]) if (!find(k)) S.multi.delete(k);
  render();
}

/* ---------- Werbung aussortieren ---------- */
function loadSet(k) { try { return new Set(JSON.parse(load(k) || "[]")); } catch { return new Set(); } }
function saveSet(k, set) { store(k, JSON.stringify([...set])); }
const domainOf = (a) => String(a || "").toLowerCase().split("@")[1] || "";
function isAd(m) {
  const addr = String(m.from_addr || "").toLowerCase();
  if (!addr || loadSet("adKeep").has(addr)) return false;
  if (typeof isMine === "function" && isMine(addr)) return false;
  try { if (JSON.parse(load("addrbook") || "[]").some((x) => x.toLowerCase().includes("<" + addr + ">") || x.toLowerCase() === addr)) return false; } catch {}
  return m.bulk || loadSet("adSenders").has(addr) || loadSet("adDomains").has(domainOf(addr));
}
const adsOn = () => load("adsOn") === "1";
// Nach dem Laden des Posteingangs: Werbung in den Ordner „Werbung“.
let adBusy = false;
async function sortOutAds() {
  const inbox = S.folders.find((f) => f.role === "inbox")?.id || "INBOX";
  if (!adsOn() || S.folder !== inbox || S.testMode || adBusy) return;
  const ads = S.list.filter(isAd);
  if (!ads.length) return;
  adBusy = true;
  const keys = new Set(ads.map(key));
  markGone(keys);
  S.list = S.list.filter((m) => !keys.has(key(m)));
  S.base = S.base.filter((m) => !keys.has(key(m)));
  if (keys.has(S.sel)) S.sel = S.list[0] ? key(S.list[0]) : null;
  if (keys.has(S.opened)) S.opened = null;
  render();
  try {
    const n = await invoke("sort_ads", { folder: inbox, uids: ads.map((m) => m.uid) });
    toast(n === 1 ? "1 Werbemail in den Ordner „Werbung“ verschoben." : `${n} Werbemails in den Ordner „Werbung“ verschoben.`);
    refreshFoldersSoon();
  } catch (err) {
    toast("Werbung konnte nicht verschoben werden: " + err, true);
    unmarkGone(keys);
    reloadList();
  } finally { adBusy = false; }
}
// Ordner „Werbung“ gleich beim Einschalten anlegen, damit man ihn sieht.
async function ensureAdFolder() {
  if (S.testMode || S.folders.some((f) => f.id === "Werbung")) return;
  try { await invoke("create_folder", { parent: "", name: "Werbung" }); await loadFolders(); toast("Ordner „Werbung“ angelegt."); }
  catch (err) { if (!String(err).includes("gibt es schon")) toast("Ordner „Werbung“ konnte nicht angelegt werden: " + err, true); }
}
function markSender(m, kind) {
  const addr = String(m.from_addr || "").toLowerCase();
  const keep = loadSet("adKeep"), senders = loadSet("adSenders"), domains = loadSet("adDomains");
  if (kind === "keep") { keep.add(addr); senders.delete(addr); domains.delete(domainOf(addr)); toast(`${addr} wird nie aussortiert.`); }
  else if (kind === "ad") { senders.add(addr); keep.delete(addr); toast(`${addr} gilt ab jetzt als Werbung.`); }
  else if (kind === "domain") { domains.add(domainOf(addr)); keep.delete(addr); toast(`Alles von @${domainOf(addr)} gilt ab jetzt als Werbung.`); }
  saveSet("adKeep", keep); saveSet("adSenders", senders); saveSet("adDomains", domains);
  render();
  if (kind !== "keep") sortOutAds();
}
$("ads-on").checked = adsOn();
$("ads-on").onchange = (e) => {
  store("adsOn", e.target.checked ? "1" : "0");
  if (e.target.checked) {
    if (S.testMode) toast("Werbung wird erkannt und markiert. Verschoben wird erst, wenn der Testmodus aus ist.");
    else ensureAdFolder().then(sortOutAds);
  }
  render();
};

/* ---------- Suche ---------- */
const isAllSearch = () => S.scope === "all" && S.query !== "";
let searchT;
// Beim Tippen sofort in den schon geladenen Mails suchen (Absender, Betreff),
// kurz danach zusätzlich auf dem Server (auch im Text der Mails).
$("q").addEventListener("input", () => {
  clearTimeout(searchT);
  quickSearch();
  if (S.query) searchT = setTimeout(serverSearch, 600);
});
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(searchT); runSearch(); }
  if (e.key === "Escape") { $("q").value = ""; runSearch(); $("mails").focus(); }
});
const norm = (t) => String(t || "").toLocaleLowerCase("de");
function localMatches(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return S.base.filter((m) => {
    const hay = norm(`${m.from} ${m.from_addr} ${m.to} ${m.subject}`);
    return words.every((w) => hay.includes(w));
  });
}
function quickSearch() {
  const q = $("q").value.trim();
  if (q === S.query) return;
  S.query = q;
  if (!S.compose) S.opened = null;
  if (!q) { S.searching = false; S.list = S.base.slice(); renderFolders(); render(); return; }
  S.searching = true;
  S.list = S.scope === "all" ? [] : localMatches(q);
  S.sel = S.list[0] ? key(S.list[0]) : null;
  render();
}
// Nur eine Serversuche gleichzeitig. Wird währenddessen weitergetippt,
// folgt danach genau eine weitere Suche mit dem neuesten Text.
let searchBusy = false, searchAgain = false;
async function serverSearch() {
  if (!S.query) return;
  if (searchBusy) { searchAgain = true; return; }
  searchBusy = true;
  const q = S.query, scope = S.scope, folder = S.folder;
  let res = null, failed = null;
  try { res = applyLocal(await invoke("search", { query: q, folder: scope === "all" ? null : folder })); }
  catch (err) { failed = err; }
  searchBusy = false;
  if (q === S.query && scope === S.scope && folder === S.folder) {
    if (failed) toast("Suche fehlgeschlagen: " + failed, true);
    else {
      // Treffer aus der Sofortsuche behalten, Servertreffer dazunehmen.
      const seen = new Set(res.map(key));
      const extra = scope === "all" ? [] : localMatches(q).filter((m) => !seen.has(key(m)));
      S.list = [...res, ...extra].sort((a, b) => b.date - a.date);
    }
    S.searching = false;
    if (!find(S.sel)) S.sel = S.list[0] ? key(S.list[0]) : null;
    render();
  }
  if (searchAgain) { searchAgain = false; serverSearch(); }
}
async function runSearch() {
  clearTimeout(searchT);
  S.query = null; // erzwingt neue Sofortsuche
  quickSearch();
  renderFolders();
  if (!S.query) return reloadList();
  await serverSearch();
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
    ? (S.searching ? `${S.list.length ? S.list.length + " Treffer, " : ""}suche weiter …` : `${S.list.length} Treffer ${all ? "in allen Ordnern" : "in " + folderName(S.folder)}`)
    : f ? `${f.unseen} ungelesen · ${f.total} Nachrichten` : "";
  $("col-who").textContent = all ? "Von / An" : isSentFolder(S.folder) ? "An" : "Von";

  renderCatBar();
  const shown = viewList();
  if (S.searching && !S.list.length) {
    box.innerHTML = `<div class="empty">Suche läuft …</div>`;
  } else {
    if (!shown.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = S.list.length && S.cat
        ? (S.cat === "none" ? "Alle Mails hier haben eine Kategorie." : `Keine Mails in „${catById(S.cat)?.name || ""}“. Ordne Absender per Rechtsklick → „Kategorie“ zu oder zieh eine Mail auf die Kategorie oben.`)
        : S.query ? (S.scope === "all" ? "Nichts gefunden." : "Nichts gefunden. Versuch es mit „Alle Ordner“.") : "Dieser Ordner ist leer.";
      box.appendChild(e);
    }
    for (const m of shown) box.appendChild(row(m, all));
  }
  $("main").classList.toggle("open", S.opened !== null);
  $("main").classList.toggle("wide", S.opened === null || S.view === "bottom");
  $("main").classList.toggle("all", all);
  box.querySelector(".mail.on")?.scrollIntoView({ block: "nearest" });
}

function isSentFolder(id) {
  const r = S.folders.find((x) => x.id === id)?.role;
  return r === "sent" || r === "drafts";
}

function row(m, showFolder) {
  const el = document.createElement("div");
  const k = key(m);
  el.className = "mail" + (m.seen ? "" : " unread") + (isSelected(k) ? " on" : "") + (k === S.sel && S.multi.size ? " cursor" : "");
  el.innerHTML = `<span class="from"></span><span class="fold"></span><span class="date"></span><span class="subj"></span><span class="cats"></span>`;
  const sent = isSentFolder(m.folder);
  el.querySelector(".from").textContent = sent ? "An: " + (m.to || "(unbekannt)") : (m.from || m.from_addr || "(unbekannt)");
  el.querySelector(".from").title = sent ? m.to : m.from_addr;
  el.querySelector(".fold").textContent = folderName(m.folder);
  el.querySelector(".date").textContent = fmtDate(m.date);
  el.querySelector(".subj").textContent = m.subject || "(kein Betreff)";
  const inboxId = S.folders.find((f) => f.role === "inbox")?.id || "INBOX";
  if (adsOn() && m.folder === inboxId && isAd(m)) {
    const t = document.createElement("span"); t.className = "adtag"; t.textContent = "Werbung";
    t.title = S.testMode ? "Wird aussortiert, sobald der Testmodus aus ist" : "Wird in den Ordner „Werbung“ verschoben";
    el.querySelector(".subj").prepend(t);
  }
  const ct = catTags(m);
  if (ct) el.querySelector(".cats").appendChild(ct);
  if (m.has_att) {
    const a = document.createElement("span"); a.className = "clip"; a.textContent = "📎"; a.title = "Mit Anhang";
    el.querySelector(".subj").prepend(a);
  }
  if (showFolder) {
    const t = document.createElement("span"); t.className = "tag"; t.textContent = folderName(m.folder);
    el.querySelector(".subj").prepend(t);
  }
  el.onclick = (e) => {
    if (e.shiftKey) { selectRange(k); S.sel = k; }
    else if (e.metaKey || e.ctrlKey) {
      if (!S.multi.size && S.sel && S.sel !== k) S.multi.add(S.sel);
      if (S.multi.has(k)) S.multi.delete(k); else S.multi.add(k);
      if (S.multi.size < 2) { S.multi.clear(); }
      S.sel = k; S.anchor = k;
    } else { S.sel = k; S.anchor = k; S.multi.clear(); }
    render(); $("mails").focus();
  };
  el.ondblclick = () => openMail(k);
  // Ziehen in einen Ordner
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    const keys = isSelected(k) && S.multi.size ? selectedKeys() : [k];
    e.dataTransfer.setData("text/x-nemeton-mail", keys.join("\n"));
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  // Rechtsklick-Menü
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!isSelected(k)) { S.sel = k; S.anchor = k; S.multi.clear(); }
    render();
    if (S.multi.size > 1) showMultiMenu(e.clientX, e.clientY);
    else showMenu(e.clientX, e.clientY, k);
  });
  return el;
}

/* ---------- Testmodus ---------- */
function applyLocal(list) {
  if (!S.testMode) return list;
  return list
    .filter((m) => !S.hidden.has(key(m)))
    .map((m) => (S.localSeen.has(key(m)) ? { ...m, seen: S.localSeen.get(key(m)) } : m));
}
function setTestMode() { S.testMode = false; S.hidden.clear(); S.localSeen.clear(); }

/* ---------- Aktionen ---------- */
function bumpUnread(folder, delta) {
  const f = S.folders.find((x) => x.id === folder);
  if (f) { f.unseen = Math.max(0, f.unseen + delta); renderFolders(); }
}

async function toggleSeen(m) {
  const seen = !m.seen;
  m.seen = seen; if (seen) S.keepShown.add(key(m)); bumpUnread(m.folder, seen ? -1 : 1); render();
  if (S.testMode) { S.localSeen.set(key(m), seen); return; }
  try { await invoke("set_seen", { folder: m.folder, uid: m.uid, seen }); }
  catch (err) { m.seen = !seen; bumpUnread(m.folder, seen ? 1 : -1); render(); toast("Konnte nicht geändert werden: " + err, true); }
}

let openToken = 0;
async function openMail(k) {
  const m = find(k);
  if (!m || !leaveCompose()) return;
  S.sel = k; S.opened = k;
  if (!m.seen) { m.seen = true; S.keepShown.add(k); bumpUnread(m.folder, -1); if (S.testMode) S.localSeen.set(k, true); }
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
  S.msg = msg;
  const r = $("read");
  r.innerHTML = `
    <div class="read-head">
      <div class="acts">
        <button type="button" id="r-reply">Antworten</button>
        <button type="button" id="r-all" title="Antwort an alle Empfänger dieser Mail">Allen antworten</button>
        <button type="button" id="r-fwd">Weiterleiten</button>
        <button type="button" id="r-del">Löschen</button>
        <button type="button" class="close" id="r-close" title="Rücktaste">Schließen ✕</button>
      </div>
      <h4></h4>
      <div class="meta"><div class="av"></div><div style="min-width:0"><b></b><span class="to"></span></div></div>
      <div class="msgcats"></div>
      <div class="atts"></div>
    </div>
    <div class="read-body"><iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Inhalt der Nachricht"></iframe></div>`;
  r.querySelector("h4").textContent = msg.subject || "(kein Betreff)";
  r.querySelector(".av").textContent = (msg.from || msg.from_addr || "?").trim()[0]?.toUpperCase() || "?";
  r.querySelector(".meta b").textContent = msg.from_addr && msg.from !== msg.from_addr ? `${msg.from} <${msg.from_addr}>` : msg.from;
  r.querySelector(".to").textContent = `an ${msg.to}${msg.cc ? ", Kopie: " + msg.cc : ""} · ${fmtLong(msg.date)}`;
  const atts = r.querySelector(".atts");
  renderAttachments(atts, msg);
  renderMsgCats(msg);
  // Externe Inhalte (Bilder, Schriften aus dem Netz) sind zuerst gesperrt:
  // Beim Laden würde der Absender erfahren, dass und wann du die Mail liest.
  const hasExternal = !!msg.html && /(src|background|srcset)\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i.test(msg.html);
  const bar = document.createElement("div");
  bar.className = "extbar";
  bar.hidden = !hasExternal;
  bar.innerHTML = `<span>Zum Schutz deiner Privatsphäre wurden externe Inhalte in dieser Nachricht blockiert.</span><button type="button">Externe Inhalte anzeigen</button>`;
  r.querySelector(".read-body").before(bar);
  bar.querySelector("button").onclick = () => { bar.hidden = true; renderBody(msg, true); };
  const status = document.createElement("div");
  status.className = "linkstatus"; status.hidden = true;
  r.querySelector(".read-body").appendChild(status);
  renderBody(msg, false);
  $("r-close").onclick = closeMail;
  $("r-reply").onclick = () => openCompose("reply", msg);
  $("r-all").onclick = () => openCompose("all", msg);
  $("r-fwd").onclick = () => openCompose("forward", msg);
  $("r-del").onclick = () => remove(key(msg));
}

// Anhänge gut sichtbar als Kästchen: Klick öffnet die Datei mit dem
// passenden Programm, „Sichern“ legt sie in den Ordner „Downloads“.
function attIcon(name) {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e === "pdf") return "📄";
  if (["jpg", "jpeg", "png", "gif", "heic", "webp", "bmp", "tif", "tiff"].includes(e)) return "🖼️";
  if (["doc", "docx", "odt", "rtf", "txt", "pages"].includes(e)) return "📝";
  if (["xls", "xlsx", "ods", "csv", "numbers"].includes(e)) return "📊";
  if (["ppt", "pptx", "key", "odp"].includes(e)) return "📽️";
  if (["zip", "rar", "7z", "gz", "tar"].includes(e)) return "🗜️";
  if (["mp3", "wav", "m4a", "aac", "flac", "aif", "aiff", "ogg"].includes(e)) return "🎵";
  if (["mp4", "mov", "avi", "mkv", "m4v"].includes(e)) return "🎬";
  if (e === "ics") return "📅";
  return "📎";
}
function fmtBytes(n) {
  if (!n) return "";
  return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
function renderAttachments(box, msg) {
  box.innerHTML = "";
  if (!msg.attachments.length) { box.hidden = true; return; }
  box.hidden = false;
  const head = document.createElement("div");
  head.className = "atts-head";
  head.textContent = msg.attachments.length === 1 ? "📎 1 Anhang" : `📎 ${msg.attachments.length} Anhänge`;
  box.appendChild(head);
  const list = document.createElement("div");
  list.className = "atts-list";
  msg.attachments.forEach((name, index) => {
    const card = document.createElement("div");
    card.className = "attcard";
    const open = document.createElement("button");
    open.type = "button"; open.className = "att-open"; open.title = "Öffnen: " + name;
    open.innerHTML = `<span class="att-ic"></span><span class="att-txt"><span class="att-name"></span><span class="att-size"></span></span>`;
    open.querySelector(".att-ic").textContent = attIcon(name);
    open.querySelector(".att-name").textContent = name;
    open.querySelector(".att-size").textContent = fmtBytes(msg.att_sizes?.[index]);
    const save = document.createElement("button");
    save.type = "button"; save.className = "att-save"; save.textContent = "Sichern"; save.title = "Speichern unter …";
    const run = async (cmd, btn) => {
      btn.disabled = true;
      try {
        const res = await invoke(cmd, { folder: msg.folder, uid: msg.uid, index });
        if (res) toast(res);
      } catch (err) { toast("Anhang: " + err, true); }
      finally { btn.disabled = false; }
    };
    open.onclick = () => run("open_attachment", open);
    save.onclick = () => run("save_attachment", save);
    card.append(open, save);
    list.appendChild(card);
  });
  box.appendChild(list);
}

// Zeigt den Inhalt in einem abgeschotteten Rahmen: Skripte laufen nie,
// Formulare werden nicht abgeschickt, und Bilder aus dem Netz nur, wenn
// externe Inhalte erlaubt wurden.
function renderBody(msg, external) {
  const r = $("read");
  const frame = r.querySelector("iframe");
  const csp = external
    ? "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; font-src data: https:"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  const base = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">
    <style>body{font-family:${getComputedStyle(document.body).fontFamily};font-size:15px;line-height:1.6;color:#18202c;margin:1.2em 1.6em;overflow-wrap:anywhere}
    img,video{max-width:100%!important;height:auto!important}pre{white-space:pre-wrap}table{width:auto!important;max-width:100%!important}td,th{width:auto!important;overflow-wrap:anywhere}a{color:#2f6fdf}</style>`;
  frame.onload = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    if (!external) {
      // Feste Bildgrößen entfernen: gesperrte Bilder würden sonst als leere
      // Kästen die Mail unnötig breit machen.
      for (const img of doc.querySelectorAll("img")) { img.removeAttribute("width"); img.removeAttribute("height"); }
    }
    prepareLinks(doc);
    markOwnText(doc);
    wireLinks(doc);
    fitMail();
  };
  frame.srcdoc = msg.html ? base + msg.html : base + `<pre>${linkify(esc(msg.text || "(kein Inhalt)"))}</pre>`;
}

// Macht Webadressen in reinen Text-Mails anklickbar.
function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (u) => `<a href="${u}">${u}</a>`);
}

// Bereitet die Links vor, ohne dass in der Mail ein Skript laufen muss
// (auf dem Mac laufen in der abgeschotteten Mail gar keine Skripte, auch
// nicht unsere eigenen): Erlaubte Links öffnen "in neuem Fenster", das
// fängt die App ab und gibt es an den Browser weiter. Alles andere
// (z.B. javascript:- oder Datei-Links) wird unklickbar gemacht.
function prepareLinks(doc) {
  for (const a of doc.querySelectorAll("a[href], area[href]")) {
    const href = a.getAttribute("href").trim();
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      if (!a.title) a.title = href;
    } else if (!href.startsWith("#")) {
      a.removeAttribute("href");
      a.removeAttribute("target");
    } else {
      a.removeAttribute("target");
    }
  }
}

// Links öffnen im normalen Browser, nie in der App. Erlaubt sind nur
// Webseiten (http/https) und E-Mail-Adressen (mailto). Beim Drüberfahren
// zeigt die Leiste unten, wohin der Link wirklich führt.
function wireLinks(doc) {
  const status = document.querySelector("#read .linkstatus");
  const target = (e) => (e.target.nodeType === 1 ? e.target : e.target.parentElement)?.closest?.("a[href], area[href]");
  doc.addEventListener("click", (e) => {
    const a = target(e);
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href").trim();
    if (/^(https?:|mailto:)/i.test(href)) {
      invoke("open_link", { url: href }).catch((err) => toast("Link konnte nicht geöffnet werden: " + err, true));
    } else if (!href.startsWith("#")) {
      toast("Dieser Link wird aus Sicherheitsgründen nicht geöffnet.", true);
    }
  });
  doc.addEventListener("mouseover", (e) => {
    const a = target(e);
    if (!status) return;
    if (a) { status.textContent = a.getAttribute("href"); status.hidden = false; }
    else status.hidden = true;
  });
  doc.addEventListener("mouseleave", () => { if (status) status.hidden = true; });
  for (const f of doc.querySelectorAll("form")) f.addEventListener("submit", (e) => e.preventDefault());
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
  if (S.compose) { if (!leaveCompose()) return; $("read").innerHTML = ""; }
  S.opened = null;
  render();
  $("mails").focus();
}

// Nimmt eine Mail aus der Liste (nach Löschen oder Verschieben).
// Ist sie gerade geöffnet, wird die nächste geöffnet.
function takeOut(k) {
  const i = S.list.findIndex((m) => key(m) === k);
  if (i < 0) return null;
  const m = S.list[i];
  const next = S.list[i + 1] || S.list[i - 1];
  const wasOpen = S.opened === k;
  S.list.splice(i, 1);
  const bi = S.base.findIndex((x) => key(x) === k);
  if (bi >= 0) S.base.splice(bi, 1);
  if (!m.seen) bumpUnread(m.folder, -1);
  S.sel = next ? key(next) : null;
  if (wasOpen) S.opened = null;
  render();
  if (wasOpen && next) openMail(key(next));
  return { m, i };
}
function putBack({ m, i }) {
  S.list.splice(i, 0, m);
  if (!S.base.some((x) => key(x) === key(m))) { S.base.push(m); S.base.sort((a, b) => b.date - a.date); }
  if (!m.seen) bumpUnread(m.folder, 1);
  render();
}

// Nimmt mehrere Mails aus der Liste; die nächste danach wird ausgewählt.
function takeOutMany(keys) {
  const set = new Set(keys);
  const vl = viewList();
  const lastIdx = Math.max(...vl.map((m, i) => (set.has(key(m)) ? i : -1)));
  const next = vl.slice(lastIdx + 1).find((m) => !set.has(key(m))) || [...vl].reverse().find((m) => !set.has(key(m)));
  const wasOpen = set.has(S.opened);
  const taken = S.list.filter((m) => set.has(key(m)));
  markGone(taken.map(key));
  S.list = S.list.filter((m) => !set.has(key(m)));
  S.base = S.base.filter((m) => !set.has(key(m)));
  for (const m of taken) if (!m.seen) bumpUnread(m.folder, -1);
  S.multi.clear();
  S.sel = next ? key(next) : null; S.anchor = S.sel;
  if (wasOpen) S.opened = null;
  render();
  if (wasOpen && next) openMail(key(next));
  return taken;
}
// Fasst Mails nach Ordner zusammen: {ordner: [uid, …]}
function byFolder(mails) {
  const g = {};
  for (const m of mails) (g[m.folder] ||= []).push(m.uid);
  return g;
}
const nMails = (n) => (n === 1 ? "1 Mail" : `${n} Mails`);

async function remove(k) { return removeMany([k]); }
async function removeMany(keys) {
  const taken = takeOutMany(keys);
  if (!taken.length) return;
  if (S.testMode) {
    for (const m of taken) S.hidden.add(key(m));
    toast(`Testmodus: ${nMails(taken.length)} nur in der App ausgeblendet. Auf dem Server bleibt alles.`);
    return;
  }
  try {
    for (const [folder, uids] of Object.entries(byFolder(taken))) await invoke("delete_messages", { folder, uids });
    toast(taken.length === 1 ? "In den Papierkorb verschoben: " + (taken[0].subject || "(kein Betreff)") : `${nMails(taken.length)} in den Papierkorb verschoben.`);
  } catch (err) {
    toast("Löschen fehlgeschlagen: " + err + " – die Liste wird neu geladen.", true);
    unmarkGone(taken.map(key));
    await reloadList();
  }
  refreshFoldersSoon();
}

async function moveMail(k, target) { return moveMany([k], target); }
async function moveMany(keys, target) {
  keys = keys.filter((k) => { const m = find(k); return m && m.folder !== target; });
  if (!keys.length) return;
  const name = folderName(target);
  const taken = takeOutMany(keys);
  if (S.testMode) {
    for (const m of taken) S.hidden.add(key(m));
    toast(`Testmodus: ${nMails(taken.length)} nur in der App nach „${name}“ verschoben. Auf dem Server bleibt alles, wie es ist.`);
    return;
  }
  try {
    for (const [folder, uids] of Object.entries(byFolder(taken))) {
      if (uids.length === 1) await invoke("move_message", { folder, uid: uids[0], target });
      else await invoke("move_messages", { folder, uids, target });
    }
    toast(`${nMails(taken.length)} nach „${name}“ verschoben.`);
  } catch (err) {
    // Nicht raten: neu laden, damit die Liste zeigt, was wirklich passiert ist.
    toast(`Verschieben nach „${name}“ fehlgeschlagen: ${err}. Die Liste wird neu geladen.`, true);
    unmarkGone(taken.map(key));
    await reloadList();
  }
  refreshFoldersSoon();
}

async function setSeenMany(keys, seen) {
  const ms = keys.map(find).filter((m) => m && m.seen !== seen);
  for (const m of ms) { m.seen = seen; if (seen) S.keepShown.add(key(m)); bumpUnread(m.folder, seen ? -1 : 1); if (S.testMode) S.localSeen.set(key(m), seen); }
  render();
  if (S.testMode) return;
  for (const m of ms) {
    try { await invoke("set_seen", { folder: m.folder, uid: m.uid, seen }); }
    catch (err) { toast("Konnte nicht geändert werden: " + err, true); break; }
  }
}

// Antworten/Weiterleiten aus der Liste heraus (ohne die Mail zu öffnen).
async function composeFor(k, kind) {
  const m = find(k);
  if (!m) return;
  if (S.msg && key(S.msg) === k) return openCompose(kind, S.msg);
  try { openCompose(kind, await invoke("get_message", { folder: m.folder, uid: m.uid })); }
  catch (err) { toast("Die Nachricht konnte nicht geladen werden: " + err, true); }
}

/* ---------- Rechtsklick-Menü ---------- */
function folderSubmenu(label, exclude, action) {
  const mv = menuItem(menu, label, null, { sub: true });
  const sub = document.createElement("div");
  sub.className = "menu sub"; sub.setAttribute("role", "menu");
  for (const f of S.folders) {
    if (f.id === exclude) continue;
    const b = menuItem(sub, f.name, () => action(f.id));
    b.style.paddingLeft = (0.9 + f.depth * 0.9) + "em";
  }
  mv.appendChild(sub);
  const openSub = () => {
    sub.classList.add("show");
    const r = mv.getBoundingClientRect(), sr = sub.getBoundingClientRect();
    sub.style.left = (r.right + sr.width > innerWidth ? -sr.width + 4 : r.width - 4) + "px";
    sub.style.top = Math.min(0, innerHeight - r.top - sr.height - 8) + "px";
  };
  mv.addEventListener("mouseenter", openSub);
  mv.addEventListener("click", (e) => { e.stopPropagation(); openSub(); });
  mv.addEventListener("mouseleave", () => sub.classList.remove("show"));
}
function placeMenu(x, y) {
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}
// Menü für mehrere markierte Mails
function showMultiMenu(x, y) {
  const keys = selectedKeys();
  menu.innerHTML = "";
  const h = document.createElement("div"); h.className = "menu-h"; h.textContent = `${keys.length} Mails markiert`; menu.appendChild(h);
  menuItem(menu, "Als gelesen markieren", () => setSeenMany(keys, true));
  menuItem(menu, "Als ungelesen markieren", () => setSeenMany(keys, false));
  addCatSubmenuMany(keys.map(find).filter(Boolean));
  const sep = document.createElement("div"); sep.className = "sep"; menu.appendChild(sep);
  folderSubmenu("Verschieben in", null, (id) => moveMany(keys, id));
  const sep2 = document.createElement("div"); sep2.className = "sep"; menu.appendChild(sep2);
  menuItem(menu, `${nMails(keys.length)} löschen`, () => removeMany(keys), { danger: true });
  placeMenu(x, y);
}
const menu = document.createElement("div");
menu.className = "menu"; menu.hidden = true; menu.setAttribute("role", "menu");
document.body.appendChild(menu);
function hideMenu() { menu.hidden = true; menu.innerHTML = ""; }
function menuItem(parent, label, action, opts = {}) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "mi" + (opts.danger ? " danger" : ""); b.setAttribute("role", "menuitem");
  b.textContent = label;
  if (opts.sub) b.classList.add("has-sub");
  if (action) b.onclick = () => { hideMenu(); action(); };
  parent.appendChild(b);
  return b;
}
function showMenu(x, y, k) {
  const m = find(k);
  if (!m) return;
  menu.innerHTML = "";
  menuItem(menu, "Öffnen", () => openMail(k));
  menuItem(menu, m.seen ? "Als ungelesen markieren" : "Als gelesen markieren", () => toggleSeen(m));
  addCatSubmenu(m);
  const sepR = document.createElement("div"); sepR.className = "sep"; menu.appendChild(sepR);
  menuItem(menu, "Antworten", () => composeFor(k, "reply"));
  menuItem(menu, "Allen antworten", () => composeFor(k, "all"));
  menuItem(menu, "Weiterleiten", () => composeFor(k, "forward"));
  const sep = document.createElement("div"); sep.className = "sep"; menu.appendChild(sep);
  folderSubmenu("Verschieben in", m.folder, (id) => moveMail(k, id));
  const sepA = document.createElement("div"); sepA.className = "sep"; menu.appendChild(sepA);
  if (m.from_addr) {
    const dom = domainOf(m.from_addr);
    menuItem(menu, "Absender ist Werbung", () => markSender(m, "ad"));
    if (dom) menuItem(menu, `Alles von @${dom} ist Werbung`, () => markSender(m, "domain"));
    menuItem(menu, "Absender nie aussortieren", () => markSender(m, "keep"));
  }
  const sep2 = document.createElement("div"); sep2.className = "sep"; menu.appendChild(sep2);
  menuItem(menu, "Löschen", () => remove(k), { danger: true });
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
}
document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { e.stopPropagation(); hideMenu(); } }, true);
addEventListener("blur", hideMenu);
$("mails").addEventListener("scroll", hideMenu);

/* ---------- Mausrad: mehr Zeilen pro Schritt ---------- */
$("mails").addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.deltaX) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? $("mails").clientHeight : 1;
  $("mails").scrollTop += e.deltaY * unit * 2.5;
  hideMenu();
}, { passive: false });

/* ---------- Tastatur ---------- */
$("mails").addEventListener("keydown", (e) => {
  const vl = viewList();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    S.multi = new Set(vl.map(key)); if (S.multi.size < 2) S.multi.clear();
    render(); return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = vl.findIndex((m) => key(m) === S.sel);
  const move = (d) => {
    const n = vl[Math.min(Math.max(i + d, 0), vl.length - 1)];
    if (!n) return;
    if (e.shiftKey) {
      // Shift + Pfeil: Auswahl erweitern, nichts öffnen
      if (!S.anchor || !find(S.anchor)) S.anchor = S.sel;
      S.sel = key(n);
      selectRange(S.sel);
      render(); return;
    }
    S.sel = key(n); S.anchor = S.sel; S.multi.clear();
    if (S.opened !== null && S.opened !== "compose") openMail(S.sel); else render();
  };
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); move(1); break;
    case "ArrowUp": e.preventDefault(); move(-1); break;
    case "Enter": if (S.sel) openMail(S.sel); break;
    case "Delete": e.preventDefault(); if (S.sel || S.multi.size) removeMany(selectedKeys()); break;
    case "Backspace":
    case "Escape": e.preventDefault(); if (S.multi.size) { S.multi.clear(); render(); } else if (S.opened !== null) closeMail(); break;
  }
});
// Rücktaste/Esc auch, wenn der Fokus im Lesebereich liegt.
document.addEventListener("keydown", (e) => {
  if (S.opened === null || S.compose || e.target.closest?.("input, textarea, select, [contenteditable], #mails")) return;
  if (e.key === "Backspace" || e.key === "Escape") { e.preventDefault(); closeMail(); }
  if (e.key === "Delete") { e.preventDefault(); if (S.opened !== "compose") remove(S.opened); }
});

// Klick in den Inhalt einer Mail: Die Mail liegt in einem abgeschotteten
// Rahmen, der Tastendrücke nicht an die App weitergibt. Deshalb holt die App
// den Tastatur-Fokus gleich zurück, damit Entf, Pfeiltasten und Rücktaste
// weiter funktionieren – auch wenn man aus einem anderen Fenster direkt in
// die Mail klickt. Markierter Text lässt sich trotzdem kopieren.
const readFrame = () => document.querySelector("#read .read-body iframe");
function reclaimFocus() {
  const a = document.activeElement;
  if (a && a.tagName === "IFRAME" && a === readFrame() && !S.compose) $("mails").focus({ preventScroll: true });
}
addEventListener("blur", () => setTimeout(reclaimFocus, 0));
setInterval(() => { if (document.hasFocus()) reclaimFocus(); }, 400);
document.addEventListener("keydown", (e) => {
  const f = readFrame();
  if (!f || S.compose || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const win = f.contentWindow;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
    const text = win?.getSelection()?.toString();
    if (!text) return;
    e.preventDefault();
    const fallback = () => { try { f.contentDocument.execCommand("copy"); } catch {} };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    return;
  }
  // Blättern in der geöffneten Mail
  if (e.key === "PageDown" || e.key === "PageUp" || (e.key === " " && e.target.id === "mails")) {
    if (!win) return;
    e.preventDefault();
    const dir = e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -1 : 1;
    win.scrollBy({ top: dir * win.innerHeight * 0.85, behavior: "smooth" });
  }
}, true);

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
$("btn-new").onclick = () => openCompose("new");
$("btn-logout").onclick = async () => {
  await invoke("logout");
  S.list = []; S.folders = []; S.sel = S.opened = null;
  showSetup();
};


// Abgleich mit dem Server: jede Minute und sofort, wenn du ins Fenster
// zurückkommst. So stimmt die Liste mit dem Handy überein.
let syncBusy = false, lastSync = Date.now();
async function syncNow() {
  if (syncBusy || $("app").hidden || S.query) return;
  syncBusy = true; lastSync = Date.now();
  try { await reloadList({ quiet: true }); await loadFolders({ quiet: true }); } catch {} finally { syncBusy = false; }
}
// Nach Löschen/Verschieben die Ordnerzahlen einmal kurz danach auffrischen,
// nicht nach jeder einzelnen Aktion (das bremste schnelles Aufräumen).
let foldersT;
function refreshFoldersSoon() { clearTimeout(foldersT); foldersT = setTimeout(() => loadFolders({ quiet: true }), 4000); }
setInterval(syncNow, 60000);
addEventListener("focus", () => { if (Date.now() - lastSync > 15000) syncNow(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastSync > 15000) syncNow(); });

// Start: siehe Ende von categories.js (wird als letzte Datei geladen).
