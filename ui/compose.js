// Nemeton Mail – Mails schreiben, antworten, weiterleiten.
// Der Schreibbereich erscheint rechts, wo sonst die geöffnete Mail steht.
// Deine Schrift wird fest in die Mail geschrieben, damit sie beim
// Empfänger genauso ankommt. Eingefügter Text verliert fremde Schriften.
"use strict";

/* ---------- Deine Schrift ---------- */
// Nur Schriften, die auf Mac, Windows und iPhone vorhanden sind. Nur dann
// sieht die Empfangsperson wirklich dieselbe Schrift.
const FONTS = {
  "Verdana": "Verdana, Geneva, sans-serif",
  "Arial": "Arial, Helvetica, sans-serif",
  "Tahoma": "Tahoma, Verdana, sans-serif",
  "Trebuchet MS": "'Trebuchet MS', Helvetica, sans-serif",
  "Georgia": "Georgia, 'Times New Roman', serif",
  "Times New Roman": "'Times New Roman', Times, serif",
};
const MAIL_SIZE = 14; // Schriftgröße in Pixeln, wie sie verschickt wird
function myFontName() { const f = load("mailFont"); return FONTS[f] ? f : "Verdana"; }
function myFont() { return FONTS[myFontName()]; }
function myStyle() { return `font-family:${myFont()};font-size:${MAIL_SIZE}px;line-height:1.5;color:#1a1a1a`; }

function myAddresses() {
  const a = S.acc ? [S.acc.email, ...(S.acc.aliases || [])] : [];
  return a.map((x) => x.toLowerCase());
}
const isMine = (addr) => myAddresses().includes(String(addr || "").toLowerCase());

/* ---------- Signatur ---------- */
function sigFor(addr) {
  const own = load("sig:" + String(addr || "").toLowerCase());
  return (own && own.trim() ? own : load("sig:*") || "").trim();
}
function sigHtml(addr) {
  const t = sigFor(addr);
  return t ? textToHtml(t) : "";
}
// Einstellungen: Signatur je Absenderadresse oder für alle.
function fillSigUI() {
  if (!S.acc) return;
  const sel = $("sig-for"), ta = $("sig-text");
  const cur = sel.value || "*";
  sel.innerHTML = "";
  const add = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
  add("*", "alle Adressen");
  for (const a of [S.acc.email, ...(S.acc.aliases || [])]) add(a.toLowerCase(), a);
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "*";
  ta.value = load("sig:" + sel.value) || "";
  sel.onchange = () => { ta.value = load("sig:" + sel.value) || ""; };
  ta.oninput = () => store("sig:" + sel.value, ta.value);
}
$("btn-settings").addEventListener("click", fillSigUI);

/* ---------- Adressbuch (Vorschläge beim Tippen) ---------- */
function knownAddresses() {
  let saved = [];
  try { saved = JSON.parse(load("addrbook") || "[]"); } catch {}
  const set = new Map();
  for (const s of saved) set.set(s.toLowerCase(), s);
  for (const m of S.list) if (m.from_addr && !isMine(m.from_addr)) {
    const v = m.from && m.from !== m.from_addr ? `${m.from} <${m.from_addr}>` : m.from_addr;
    if (!set.has(m.from_addr.toLowerCase())) set.set(m.from_addr.toLowerCase(), v);
  }
  return [...set.values()];
}
function rememberAddresses(list) {
  let saved = [];
  try { saved = JSON.parse(load("addrbook") || "[]"); } catch {}
  for (const v of list) {
    const a = splitAddr(v).addr.toLowerCase();
    saved = saved.filter((s) => splitAddr(s).addr.toLowerCase() !== a);
    saved.unshift(v);
  }
  store("addrbook", JSON.stringify(saved.slice(0, 500)));
}

/* ---------- Adressen ---------- */
// "Max Muster <max@x.de>" → {name, addr}
function splitAddr(s) {
  s = String(s).trim();
  const m = s.match(/^(.*?)<\s*([^<>\s]+)\s*>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"(.*)"$/, "$1").trim(), addr: m[2] };
  return { name: "", addr: s.replace(/^mailto:/i, "") };
}
const validAddr = (a) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(a);
function addrString({ name, addr }) {
  const n = (name || "").replace(/["\\]/g, "").trim();
  return n && n.toLowerCase() !== addr.toLowerCase() ? `"${n}" <${addr}>` : addr;
}
// Mehrere Adressen aus einem Text (Komma, Semikolon, Zeilenumbruch),
// ohne Kommas in "Nachname, Vorname" <adr> zu zerschneiden.
function splitMany(text) {
  const out = []; let cur = "", q = false, br = false;
  for (const c of String(text)) {
    if (c === '"') q = !q;
    if (c === "<") br = true;
    if (c === ">") br = false;
    if (!q && !br && (c === "," || c === ";" || c === "\n")) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let dragChip = null;
function makeChip(a) {
  const c = document.createElement("span");
  c.className = "chip" + (validAddr(a.addr) ? "" : " bad");
  c.draggable = true;
  c.dataset.addr = a.addr;
  c.dataset.name = a.name || "";
  c.title = (a.name ? `${a.name} <${a.addr}>` : a.addr) +
    (validAddr(a.addr) ? "\nZum Verschieben in An, Kopie oder Blindkopie ziehen. Doppelklick zum Ändern." : "\nDiese Adresse sieht nicht richtig aus. Doppelklick zum Ändern.");
  const t = document.createElement("span"); t.className = "chip-t"; t.textContent = a.name || a.addr;
  const x = document.createElement("button"); x.type = "button"; x.className = "chip-x"; x.textContent = "×"; x.title = "Entfernen"; x.tabIndex = -1;
  x.onclick = (e) => { e.stopPropagation(); c.remove(); markDirty(); };
  c.append(t, x);
  c.addEventListener("dragstart", (e) => {
    dragChip = c; c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", addrString(a));
  });
  c.addEventListener("dragend", () => { c.classList.remove("dragging"); dragChip = null; document.querySelectorAll(".addrs.drop").forEach((f) => f.classList.remove("drop")); });
  c.addEventListener("dblclick", () => {
    const input = c.parentElement.querySelector("input");
    commitInput(input);
    input.value = a.name ? `${a.name} <${a.addr}>` : a.addr;
    c.remove(); input.focus(); markDirty();
  });
  return c;
}
function addChips(field, list) {
  const input = field.querySelector("input");
  const have = new Set([...document.querySelectorAll("#compose .chip")].map((c) => c.dataset.addr.toLowerCase()));
  for (const v of list) {
    const a = typeof v === "string" ? splitAddr(v) : v;
    if (!a.addr || have.has(a.addr.toLowerCase())) continue;
    have.add(a.addr.toLowerCase());
    field.insertBefore(makeChip(a), input);
  }
}
function commitInput(input) {
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  addChips(input.parentElement, splitMany(v));
  markDirty();
}
function wireField(field) {
  const input = field.querySelector("input");
  field.addEventListener("click", (e) => { if (e.target === field) input.focus(); });
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && input.value.trim())) && !e.isComposing) {
      if (input.value.trim()) { e.preventDefault(); commitInput(input); }
      else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && !input.value) {
      const last = input.previousElementSibling;
      if (last?.classList.contains("chip")) { e.preventDefault(); last.remove(); markDirty(); }
    }
  });
  input.addEventListener("blur", () => commitInput(input));
  input.addEventListener("change", () => { if (/[>@].*$/.test(input.value) && validAddr(splitAddr(input.value).addr)) commitInput(input); });
  input.addEventListener("paste", (e) => {
    const t = e.clipboardData?.getData("text/plain");
    if (t && /[,;\n]/.test(t)) { e.preventDefault(); input.value += t; commitInput(input); }
  });
  field.addEventListener("dragover", (e) => {
    if (!dragChip) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    field.classList.add("drop");
  });
  field.addEventListener("dragleave", (e) => { if (!field.contains(e.relatedTarget)) field.classList.remove("drop"); });
  field.addEventListener("drop", (e) => {
    if (!dragChip) return;
    e.preventDefault();
    field.classList.remove("drop");
    const before = e.target.closest?.(".chip");
    field.insertBefore(dragChip, before && before !== dragChip && before.parentElement === field ? before : input);
    markDirty();
  });
}
function chipsOf(name) {
  return [...document.querySelectorAll(`#compose .addrs[data-field="${name}"] .chip`)]
    .map((c) => ({ name: c.dataset.name, addr: c.dataset.addr }));
}

/* ---------- Zitat aus der Originalmail ---------- */
// Entfernt alles Gefährliche aus einer fremden Mail, bevor sie zitiert wird.
function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript, iframe, frame, frameset, object, embed, applet, link, meta, base, form, input, button, textarea, select, title").forEach((n) => n.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase(), v = at.value.trim().toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src" || n === "action" || n === "xlink:href") && /^(javascript|vbscript|data:text)/.test(v))) el.removeAttribute(at.name);
    }
  }
  const styles = [...doc.querySelectorAll("style")].map((s) => s.outerHTML).join("");
  doc.querySelectorAll("style").forEach((s) => s.remove());
  return styles + doc.body.innerHTML;
}
function textToHtml(t) {
  return esc(t || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n$&"), "text/html");
  doc.querySelectorAll("style, script, title").forEach((n) => n.remove());
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
function origHtml(msg) { return msg.html ? cleanHtml(msg.html) : `<div>${textToHtml(msg.text)}</div>`; }
function origText(msg) { return msg.text || (msg.html ? htmlToText(msg.html) : ""); }
function personLine(name, addr) { return name && name !== addr ? `${name} <${addr}>` : addr; }
function attribution(msg) {
  const d = msg.date ? new Date(msg.date * 1000) : null;
  const when = d ? `Am ${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })} um ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "";
  return `${when} schrieb ${personLine(msg.from, msg.from_addr)}:`.trim();
}
function forwardHeader(msg) {
  const rows = [["Betreff", msg.subject], ["Datum", fmtLong(msg.date)], ["Von", personLine(msg.from, msg.from_addr)], ["An", msg.to]];
  if (msg.cc) rows.push(["Kopie", msg.cc]);
  return rows;
}

/* ---------- Schreibbereich ---------- */
function markDirty() { if (S.compose) S.compose.dirty = true; }

// Wird aufgerufen, bevor etwas anderes im rechten Bereich erscheinen soll.
// Gibt false zurück, wenn gerade ungesicherter Text geschrieben wird.
function leaveCompose() {
  if (!S.compose) return true;
  if (S.compose.dirty) {
    toast("Du schreibst gerade eine Mail. Bitte erst senden oder verwerfen.", true);
    return false;
  }
  S.compose = null;
  return true;
}

function prefixed(subject, re, prefix) {
  subject = subject || "";
  return re.test(subject) ? subject : prefix + subject;
}
function uniqAddrs(list) {
  const seen = new Set(), out = [];
  for (const a of list) {
    const k = (a.addr || "").toLowerCase();
    if (!k || seen.has(k) || isMine(k)) continue;
    seen.add(k); out.push(a);
  }
  return out;
}

// kind: "new" | "reply" | "all" | "forward"
function openCompose(kind, msg) {
  if (S.compose && S.compose.dirty) { toast("Du schreibst gerade eine Mail. Bitte erst senden oder verwerfen.", true); return; }
  ++openToken; // laufendes Laden einer Mail abbrechen
  const c = S.compose = { kind, msg: msg || null, dirty: false, files: [], fwdAtts: [], quote: kind !== "new" };
  let to = [], cc = [], subject = "";
  if (msg && (kind === "reply" || kind === "all")) {
    const fromMe = msg.from_list.length && msg.from_list.every((a) => isMine(a.addr));
    const base = fromMe ? msg.to_list : (msg.reply_to.length ? msg.reply_to : msg.from_list);
    to = kind === "all" ? uniqAddrs([...base, ...msg.to_list]) : uniqAddrs(base);
    if (!to.length && fromMe) to = msg.to_list;
    cc = kind === "all" ? uniqAddrs(msg.cc_list).filter((a) => !to.some((t) => t.addr.toLowerCase() === a.addr.toLowerCase())) : [];
    subject = prefixed(msg.subject, /^\s*(re|aw|antw)\s*:/i, "Re: ");
  } else if (msg && kind === "forward") {
    subject = prefixed(msg.subject, /^\s*(fwd?|wg|wtrlt)\s*:/i, "Fwd: ");
    c.fwdAtts = [...msg.attachments];
  }
  // Absender: die eigene Adresse, an die die Mail ging (z.B. ein Alias).
  let from = load("lastFrom");
  if (msg) {
    const hit = [...msg.to_list, ...msg.cc_list].find((a) => isMine(a.addr));
    if (hit) from = hit.addr.toLowerCase();
  }
  if (!from || !isMine(from)) from = S.acc.email.toLowerCase();

  S.opened = "compose";
  render();
  const r = $("read");
  const title = { new: "Neue Nachricht", reply: "Antworten", all: "Allen antworten", forward: "Weiterleiten" }[kind];
  r.innerHTML = `
    <div class="compose" id="compose">
      <div class="c-head">
        <div class="acts">
          <button type="button" class="primary" id="c-send" title="Senden (${navigator.platform.startsWith("Mac") ? "⌘" : "Strg"}+Enter)">Senden</button>
          <button type="button" id="c-attach">📎 Anhang</button>
          <input type="file" id="c-file" multiple hidden>
          <span class="c-title"></span>
          <button type="button" class="close" id="c-discard">Verwerfen ✕</button>
        </div>
        <div class="c-row" id="c-name-row" hidden><label for="c-name">Dein Name</label>
          <input id="c-name" placeholder="So sehen Empfänger dich, z.B. Patrick Muster"></div>
        <div class="c-row"><label for="c-from">Von</label><div class="c-from-box"><select id="c-from"></select>
          <span class="c-alias" id="c-alias" hidden><input id="c-alias-in" type="email" placeholder="weitere@adresse.de"><button type="button" id="c-alias-ok">Hinzufügen</button></span></div></div>
        <div class="c-row"><label>An</label><div class="addrs" data-field="to"><input list="addrbook" aria-label="An"></div></div>
        <div class="c-row"><label>Kopie</label><div class="addrs" data-field="cc"><input list="addrbook" aria-label="Kopie (CC)"></div></div>
        <div class="c-row"><label>Blindkopie</label><div class="addrs" data-field="bcc"><input list="addrbook" aria-label="Blindkopie (BCC)"></div></div>
        <div class="c-row"><label for="c-subj">Betreff</label><input id="c-subj"></div>
        <div class="c-atts" id="c-atts"></div>
      </div>
      <div class="c-tools">
        <button type="button" data-cmd="bold" title="Fett"><b>F</b></button>
        <button type="button" data-cmd="italic" title="Kursiv"><i>K</i></button>
        <button type="button" data-cmd="underline" title="Unterstrichen"><u>U</u></button>
        <button type="button" data-cmd="insertUnorderedList" title="Aufzählung">• Liste</button>
        <span class="c-sep"></span>
        <label class="c-font">Meine Schrift: <select id="c-font"></select></label>
        <span class="c-hint">Tipp: Adressen kannst du mit der Maus zwischen An, Kopie und Blindkopie verschieben.</span>
      </div>
      <div class="c-scroll" id="c-scroll">
        <div class="c-edit" id="c-edit" contenteditable="true" spellcheck="true" aria-label="Text der Nachricht"></div>
        <div class="c-quote" id="c-quote" hidden>
          <div class="c-qhead"><span id="c-qtitle"></span><button type="button" id="c-qdel">Zitat entfernen</button></div>
          <iframe sandbox="allow-same-origin" title="Zitierte Nachricht"></iframe>
        </div>
      </div>
      <datalist id="addrbook"></datalist>
    </div>`;
  r.querySelector(".c-title").textContent = title;
  $("c-name-row").hidden = !!S.acc.name;

  // Absender
  const sel = $("c-from");
  for (const a of [S.acc.email, ...(S.acc.aliases || [])]) {
    const o = document.createElement("option"); o.value = a.toLowerCase(); o.textContent = (S.acc.name ? `${S.acc.name} <${a}>` : a); sel.appendChild(o);
  }
  const more = document.createElement("option"); more.value = "+"; more.textContent = "Weitere Absenderadresse hinzufügen …"; sel.appendChild(more);
  sel.value = from;
  const ed0 = $("c-edit");
  const setSig = () => {
    ed0.querySelector(".nm-sig")?.remove();
    const h = sigHtml(from);
    if (h) {
      if (!ed0.firstChild) ed0.innerHTML = "<div><br></div>";
      const d = document.createElement("div"); d.className = "nm-sig"; d.innerHTML = "<br>" + h; ed0.appendChild(d);
    }
  };
  setSig();
  sel.onchange = () => {
    if (sel.value === "+") { $("c-alias").hidden = false; $("c-alias-in").focus(); sel.value = from; }
    else { from = sel.value; store("lastFrom", from); setSig(); }
  };
  $("c-alias-ok").onclick = async () => {
    const v = $("c-alias-in").value.trim().toLowerCase();
    if (!validAddr(v)) { toast("Bitte eine vollständige E-Mail-Adresse eingeben.", true); return; }
    try {
      await invoke("save_identity", { name: S.acc.name || "", aliases: [...(S.acc.aliases || []), v] });
      S.acc = await invoke("get_account");
      const o = document.createElement("option"); o.value = v; o.textContent = S.acc.name ? `${S.acc.name} <${v}>` : v;
      sel.insertBefore(o, more); sel.value = from = v; store("lastFrom", v);
      $("c-alias").hidden = true; $("c-alias-in").value = "";
      toast("Absenderadresse hinzugefügt. Sie muss bei Posteo als Alias eingerichtet sein.");
    } catch (err) { toast(String(err), true); }
  };

  // Adressfelder
  const dl = $("addrbook");
  for (const v of knownAddresses()) { const o = document.createElement("option"); o.value = v; dl.appendChild(o); }
  document.querySelectorAll("#compose .addrs").forEach(wireField);
  addChips(document.querySelector('#compose .addrs[data-field="to"]'), to);
  addChips(document.querySelector('#compose .addrs[data-field="cc"]'), cc);
  $("c-subj").value = subject;

  // Schrift
  const fs = $("c-font");
  for (const name of Object.keys(FONTS)) { const o = document.createElement("option"); o.value = name; o.textContent = name; o.style.fontFamily = FONTS[name]; fs.appendChild(o); }
  fs.value = myFontName();
  const ed = $("c-edit");
  const applyFont = () => { ed.style.fontFamily = myFont(); fs.style.fontFamily = myFont(); };
  applyFont();
  fs.onchange = () => { store("mailFont", fs.value); applyFont(); };

  // Text: eingefügter Text kommt immer ohne fremde Schrift und Formatierung.
  ed.addEventListener("paste", (e) => {
    const t = e.clipboardData?.getData("text/plain");
    if (t == null) return;
    e.preventDefault();
    document.execCommand("insertText", false, t);
  });
  ed.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) return; // Dateien → Anhang (siehe unten)
    const t = e.dataTransfer?.getData("text/plain");
    if (t) { e.preventDefault(); document.execCommand("insertText", false, t); }
  });
  for (const b of document.querySelectorAll("#compose .c-tools [data-cmd]")) {
    b.addEventListener("mousedown", (e) => e.preventDefault()); // Auswahl im Text behalten
    b.onclick = () => { ed.focus(); document.execCommand(b.dataset.cmd, false, null); markDirty(); };
  }
  $("compose").addEventListener("input", (e) => { if (e.target.id !== "c-alias-in") markDirty(); });
  $("compose").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendCompose(); }
  });

  // Anhänge
  $("c-attach").onclick = () => $("c-file").click();
  $("c-file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  const box = $("compose");
  box.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); box.classList.add("filedrop"); } });
  box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("filedrop"); });
  box.addEventListener("drop", (e) => {
    box.classList.remove("filedrop");
    if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
  });
  renderAtts();

  // Zitat
  if (msg) showQuote(msg, kind);
  $("c-qdel").onclick = () => { c.quote = false; $("c-quote").hidden = true; markDirty(); };

  $("c-send").onclick = sendCompose;
  $("c-discard").onclick = discardCompose;

  if (!S.acc.name) $("c-name").focus();
  else if (!to.length) document.querySelector('#compose .addrs[data-field="to"] input').focus();
  else focusStart(ed);
}
// Schreibmarke an den Anfang (über die Signatur).
function focusStart(ed) {
  ed.focus();
  const r = document.createRange();
  r.setStart(ed.firstChild || ed, 0); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

function showQuote(msg, kind) {
  $("c-quote").hidden = false;
  $("c-qtitle").textContent = kind === "forward" ? "Weitergeleitete Nachricht" : attribution(msg);
  const frame = document.querySelector("#c-quote iframe");
  const head = kind === "forward"
    ? `<div class="fwd">-------- Weitergeleitete Nachricht --------<br>${forwardHeader(msg).map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join("<br>")}</div><br>`
    : "";
  frame.onload = () => {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    for (const img of doc.querySelectorAll("img")) { img.removeAttribute("width"); img.removeAttribute("height"); }
    for (const a of doc.querySelectorAll("a[href]")) a.removeAttribute("href");
    markOwnText(doc);
    const fit = () => { frame.style.height = Math.min(4000, doc.documentElement.scrollHeight + 4) + "px"; };
    fit(); setTimeout(fit, 300);
  };
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <style>body{font-family:${getComputedStyle(document.body).fontFamily};font-size:14px;line-height:1.5;color:#3a4250;margin:.4em 0;overflow-wrap:anywhere}
    img{max-width:100%!important;height:auto!important}table{max-width:100%!important}.fwd{color:#555}</style>` + head + origHtml(msg);
}

/* ---------- Anhänge ---------- */
const MAX_TOTAL = 25 * 1024 * 1024; // Posteo nimmt bis ca. 50 MB, wegen Kodierung lieber 25 MB
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
function addFiles(list) {
  const c = S.compose;
  if (!c) return;
  for (const f of list) {
    const total = c.files.reduce((s, x) => s + x.size, 0) + f.size;
    if (total > MAX_TOTAL) { toast(`„${f.name}“ ist zu groß. Zusammen sind höchstens 25 MB möglich.`, true); continue; }
    c.files.push(f);
  }
  markDirty(); renderAtts();
}
function renderAtts() {
  const c = S.compose, box = $("c-atts");
  if (!c || !box) return;
  box.innerHTML = "";
  const add = (label, onRemove, title) => {
    const s = document.createElement("span"); s.className = "att"; s.title = title || label;
    const t = document.createElement("span"); t.textContent = "📎 " + label;
    const x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.title = "Entfernen"; x.onclick = () => { onRemove(); markDirty(); renderAtts(); };
    s.append(t, x); box.appendChild(s);
  };
  c.fwdAtts.forEach((n, i) => add(n, () => c.fwdAtts.splice(i, 1), "Anhang der weitergeleiteten Mail"));
  c.files.forEach((f, i) => add(`${f.name} (${fmtSize(f.size)})`, () => c.files.splice(i, 1)));
  box.hidden = !box.children.length;
}
function fileToBase64(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

/* ---------- Mail zusammenbauen ---------- */
// Schreibt deine Schrift in jedes Element, damit auch Programme wie Outlook
// sie nicht durch ihre eigene ersetzen.
function myHtml() {
  const ed = $("c-edit").cloneNode(true);
  ed.querySelectorAll("[style]").forEach((el) => { el.style.removeProperty("font-family"); el.style.removeProperty("font-size"); });
  ed.querySelectorAll("font").forEach((f) => f.replaceWith(...f.childNodes));
  for (const el of ed.querySelectorAll("div, p, li, ul, ol, span, td")) {
    el.style.fontFamily = myFont();
    if (!/^(SPAN)$/.test(el.tagName)) el.style.fontSize = MAIL_SIZE + "px";
  }
  return ed.innerHTML;
}
function myText() {
  const ed = $("c-edit");
  return (ed.innerText || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function buildBodies() {
  const c = S.compose, msg = c.msg;
  const wrap = (inner) => `<div class="nemeton-text" data-nemeton-font="${esc(myFontName())}" style="${myStyle()}">${inner}</div>`;
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` + wrap(myHtml() || "<br>");
  let text = myText();
  if (msg && c.quote) {
    if (c.kind === "forward") {
      const rows = forwardHeader(msg);
      html += wrap(`<br>-------- Weitergeleitete Nachricht --------<br>${rows.map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join("<br>")}<br><br>`) + origHtml(msg);
      text += `\n\n-------- Weitergeleitete Nachricht --------\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${origText(msg)}`;
    } else {
      html += wrap(`<br>${esc(attribution(msg))}`) +
        `<blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #c8ccd2;padding-left:1ex">${origHtml(msg)}</blockquote>`;
      text += `\n\n${attribution(msg)}\n` + origText(msg).split("\n").map((l) => "> " + l).join("\n");
    }
  }
  html += "</body></html>";
  return { html, text };
}

async function sendCompose() {
  const c = S.compose;
  if (!c || c.sending) return;
  document.querySelectorAll("#compose .addrs input").forEach(commitInput);
  const to = chipsOf("to"), cc = chipsOf("cc"), bcc = chipsOf("bcc");
  const all = [...to, ...cc, ...bcc];
  if (!all.length) { toast("Bitte mindestens einen Empfänger eintragen.", true); document.querySelector('#compose .addrs[data-field="to"] input').focus(); return; }
  const bad = all.find((a) => !validAddr(a.addr));
  if (bad) { toast(`„${bad.addr}“ ist keine gültige E-Mail-Adresse. Doppelklick auf die rote Adresse zum Ändern.`, true); return; }
  const subj = $("c-subj").value.trim();
  if (!subj && !c.subjWarned) { c.subjWarned = true; toast("Die Mail hat noch keinen Betreff. Nochmal auf Senden klicken, um sie ohne Betreff zu schicken."); $("c-subj").focus(); return; }
  const btn = $("c-send");
  c.sending = true; btn.disabled = true; btn.textContent = "Wird gesendet …";
  try {
    const name = $("c-name").value.trim();
    if (!S.acc.name && name) {
      await invoke("save_identity", { name, aliases: S.acc.aliases || [] });
      S.acc = await invoke("get_account");
    }
    const { html, text } = buildBodies();
    const attachments = [];
    for (const f of c.files) attachments.push({ name: f.name, mime: f.type || "application/octet-stream", data: await fileToBase64(f) });
    const msg = c.msg;
    const isReply = msg && (c.kind === "reply" || c.kind === "all");
    const draft = {
      from: $("c-from").value,
      to: to.map(addrString), cc: cc.map(addrString), bcc: bcc.map(addrString),
      subject: subj, html, text, attachments,
      in_reply_to: isReply ? msg.message_id || null : null,
      references: isReply ? [msg.references, msg.message_id].filter(Boolean).join(" ") || null : null,
      forward: msg && c.kind === "forward" && msg.attachments.length ? { folder: msg.folder, uid: msg.uid } : null,
      forward_skip: msg && c.kind === "forward" ? msg.attachments.filter((n) => !c.fwdAtts.includes(n)) : null,
      answered: isReply ? { folder: msg.folder, uid: msg.uid } : null,
    };
    const result = await invoke("send_mail", { draft });
    rememberAddresses(all.map(addrString));
    S.compose = null;
    toast(result);
    afterCompose(msg);
    if (!S.testMode) loadFolders();
  } catch (err) {
    toast(String(err), true);
    if (S.compose) { S.compose.sending = false; btn.disabled = false; btn.textContent = "Senden"; }
  }
}

function discardCompose() {
  const c = S.compose;
  if (!c) return;
  const b = $("c-discard");
  if (c.dirty && !b.dataset.confirm) {
    b.dataset.confirm = "1"; b.textContent = "Wirklich verwerfen? Nochmal klicken";
    setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = "Verwerfen ✕"; } }, 5000);
    return;
  }
  S.compose = null;
  afterCompose(c.msg);
}
// Nach Senden oder Verwerfen: zurück zur ursprünglichen Mail, sonst zu.
function afterCompose(msg) {
  const k = msg && key(msg);
  if (k && find(k)) openMail(k);
  else { S.opened = null; render(); $("read").innerHTML = ""; $("mails").focus(); }
}

/* ---------- Eigene Zitate in deiner Schrift anzeigen ---------- */
// Wenn jemand auf deine Mail antwortet, steht dein Text als Zitat darunter.
// Manche Programme werfen dabei die Schrift weg. Hier wird dein zitierter
// Text wieder in deiner Schrift gezeigt. Erkennt wird er an der Zeile
// „Am … schrieb Patrick <adresse>“ bzw. „Von: Patrick <adresse>“.
function markOwnText(doc) {
  const mine = myAddresses();
  if (!mine.length) return;
  const font = myFont();
  const hasMine = (t) => { t = (t || "").toLowerCase(); return mine.some((a) => t.includes(a)); };
  const paint = (root) => {
    const walk = (el) => {
      if (el !== root && el.tagName === "BLOCKQUOTE" && !own.has(el)) return; // Zitat von jemand anderem
      if (el.style) el.style.setProperty("font-family", font, "important");
      for (const ch of el.children) walk(ch);
    };
    walk(root);
  };
  const own = new Set();
  // 1. Unsere eigene Markierung (falls sie erhalten blieb)
  doc.querySelectorAll(".nemeton-text, [data-nemeton-font]").forEach((el) => own.add(el));
  // 2. Zitatblöcke mit Kopfzeile davor („Am … schrieb …“)
  for (const bq of doc.querySelectorAll("blockquote")) {
    let prev = bq.previousElementSibling, txt = "", n = 0;
    while (prev && n < 3) { txt = prev.textContent + " " + txt; if (/schrieb|wrote|écrit|scrisse|escribió/i.test(prev.textContent)) break; prev = prev.previousElementSibling; n++; }
    if (!bq.previousElementSibling) { // Kopfzeile kann auch eine Ebene höher stehen
      const p = bq.parentElement?.previousElementSibling;
      if (p) txt = p.textContent + " " + txt;
    }
    if (hasMine(txt) && /schrieb|wrote|écrit|scrisse|escribió/i.test(txt)) own.add(bq);
  }
  // 3. Outlook-Art: Kopfblock „Von: … Gesendet: …“, danach der zitierte Text
  for (const el of doc.querySelectorAll("div, p")) {
    const t = el.textContent || "";
    if (t.length > 600 || !/^\s*(von|from)\s*:/i.test(t) || !/(gesendet|sent|datum|date)\s*:/i.test(t)) continue;
    let head = el;
    while (head.parentElement && head.parentElement !== doc.body && head.parentElement.textContent.trim().length - t.trim().length < 5) head = head.parentElement;
    const fromLine = (t.match(/(von|from)\s*:(.*?)(gesendet|sent|datum|date|an|to)\s*:/is) || [])[2] || "";
    if (!hasMine(fromLine)) continue;
    for (let sib = head.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const st = sib.textContent || "";
      if (/^\s*(von|from)\s*:/i.test(st) && /(gesendet|sent)\s*:/i.test(st)) break; // nächster Kopfblock
      own.add(sib);
    }
  }
  own.forEach(paint);
}
