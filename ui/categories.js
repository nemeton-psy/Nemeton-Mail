// Nemeton Mail – Kategorien (Testversion).
// Statt Mails in Ordner zu schieben, bekommen Absender Kategorien wie
// „Versand“ oder „Rechnungen“. Jede Mail eines Absenders trägt dann
// automatisch dessen Kategorien – auch alle künftigen. Über die Leiste
// über der Liste lässt sich nach Kategorie filtern. Auf dem Server wird
// dabei nichts verändert; die Zuordnung liegt auf diesem Gerät.
"use strict";

const CAT_COLORS = ["#2f6fdf", "#d9822b", "#2e9e6a", "#c2417a", "#7a5cd6", "#c9a227", "#1f9bb5", "#8a6a50"];
const CAT_DEFAULTS = [
  { id: "versand", name: "Versand", color: "#d9822b" },
  { id: "rechnungen", name: "Rechnungen", color: "#2e9e6a" },
  { id: "job", name: "Job", color: "#2f6fdf" },
  { id: "eltern", name: "Elternschaft", color: "#c2417a" },
];
function cats() {
  const raw = load("cats");
  if (raw === null) return CAT_DEFAULTS.map((c) => ({ ...c }));
  try { return JSON.parse(raw) || []; } catch { return []; }
}
function saveCats(list) { store("cats", JSON.stringify(list)); }
// Regeln: Absenderadresse oder „@firma.de“ → Liste von Kategorie-IDs
function catRules() { try { return JSON.parse(load("catRules") || "{}") || {}; } catch { return {}; } }
function saveCatRules(r) { store("catRules", JSON.stringify(r)); }

const addrOf = (m) => String((isSentFolder(m.folder) ? "" : m.from_addr) || "").toLowerCase();
function catsOf(m) {
  const a = addrOf(m);
  if (!a) return [];
  const r = catRules(), known = new Set(cats().map((c) => c.id));
  const ids = new Set([...(r[a] || []), ...(r["@" + (a.split("@")[1] || "")] || [])]);
  return [...ids].filter((id) => known.has(id));
}
const catById = (id) => cats().find((c) => c.id === id);

// Gefilterte Ansicht der Liste (S.cat: null = alle, "none" = ohne, sonst ID)
function viewList() {
  if (!S.cat) return S.list;
  if (S.cat === "none") return S.list.filter((m) => !catsOf(m).length);
  return S.list.filter((m) => catsOf(m).includes(S.cat));
}

function toggleRule(target, id) {
  const r = catRules();
  const list = new Set(r[target] || []);
  if (list.has(id)) list.delete(id); else list.add(id);
  if (list.size) r[target] = [...list]; else delete r[target];
  saveCatRules(r);
  const c = catById(id);
  const who = target.startsWith("@") ? `Alles von ${target}` : target;
  toast(list.has(id) ? `${who} gehört jetzt zu „${c?.name}“. Auch künftige Mails.` : `${who} gehört nicht mehr zu „${c?.name}“.`);
  render();
  if (S.msg) renderMsgCats(S.msg);
}

function newCategory(name) {
  name = String(name || "").trim();
  if (!name) return null;
  const list = cats();
  const found = list.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const c = { id: "c" + Date.now().toString(36), name, color: CAT_COLORS[list.length % CAT_COLORS.length] };
  list.push(c); saveCats(list);
  return c;
}

/* ---------- Leiste über der Liste ---------- */
function catDot(c) { const d = document.createElement("span"); d.className = "cat-dot"; d.style.background = c.color; return d; }
// Knopf „Filter“ neben „Abrufen“; die Kategorien stehen in einer
// aufklappbaren Liste, damit es über der Mailliste ruhig bleibt.
function renderCatBar() {
  const btn = $("btn-filter");
  if (!btn) return;
  const cur = S.cat === "none" ? { name: "Ohne Kategorie" } : S.cat ? catById(S.cat) : null;
  if (S.cat && !cur) S.cat = null;
  btn.innerHTML = "";
  if (cur?.color) btn.appendChild(catDot(cur));
  const t = document.createElement("span"); t.textContent = cur ? cur.name : "Kategorien"; btn.appendChild(t);
  const arrow = document.createElement("span"); arrow.className = "caret"; arrow.textContent = "▾"; btn.appendChild(arrow);
  btn.classList.toggle("active", !!cur);
  $("btn-filter-clear").hidden = !cur;
  if (!$("catpanel").hidden) renderCatPanel();
}
function closeCatPanel() { $("catpanel").hidden = true; $("btn-filter").setAttribute("aria-expanded", "false"); }
function renderCatPanel() {
  const panel = $("catpanel");
  panel.innerHTML = "";
  const list = cats();
  const mk = (id, label, count, color) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "catf"; b.setAttribute("aria-pressed", String((S.cat || null) === id));
    const dot = catDot({ color: color || "transparent" }); if (!color) dot.classList.add("nodot"); b.appendChild(dot);
    const t = document.createElement("span"); t.className = "catl"; t.textContent = label; b.appendChild(t);
    if (count != null) { const n = document.createElement("span"); n.className = "catn"; n.textContent = count; b.appendChild(n); }
    b.onclick = () => { S.cat = id; closeCatPanel(); render(); $("mails").focus(); };
    if (id && id !== "none") {
      b.title = `Nur „${label}“ zeigen. Du kannst auch Mails hierher ziehen, um ihren Absender zuzuordnen.`;
      b.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-nemeton-mail")) { e.preventDefault(); b.classList.add("drop"); } });
      b.addEventListener("dragleave", () => b.classList.remove("drop"));
      b.addEventListener("drop", (e) => {
        e.preventDefault(); b.classList.remove("drop");
        const ms = e.dataTransfer.getData("text/x-nemeton-mail").split("\n").map(find).filter(Boolean);
        assignMany(ms, id);
      });
    }
    panel.appendChild(b);
  };
  mk(null, "Alle Mails", S.list.length);
  const sep = () => { const d = document.createElement("div"); d.className = "sep"; panel.appendChild(d); };
  sep();
  for (const c of list) mk(c.id, c.name, S.list.filter((m) => catsOf(m).includes(c.id)).length, c.color);
  mk("none", "Ohne Kategorie", S.list.filter((m) => !catsOf(m).length).length);
  sep();
  const add = document.createElement("div"); add.className = "catnew";
  const inp = document.createElement("input"); inp.placeholder = "+ Neue Kategorie, z.B. Verein"; inp.maxLength = 30;
  const ok = () => {
    const c = newCategory(inp.value);
    if (c) toast(`Kategorie „${c.name}“ angelegt. Ordne Absender per Rechtsklick → „Kategorie“ zu.`);
    renderCatPanel(); renderCatBar();
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") closeCatPanel(); e.stopPropagation(); };
  add.appendChild(inp); panel.appendChild(add);
  const manage = document.createElement("button"); manage.type = "button"; manage.className = "catf manage"; manage.textContent = "Kategorien verwalten (Name, Farbe, löschen) …";
  manage.onclick = () => { closeCatPanel(); $("btn-settings").click(); $("cat-settings")?.scrollIntoView({ block: "center" }); };
  panel.appendChild(manage);
}
$("btn-filter").onclick = (e) => {
  e.stopPropagation();
  const p = $("catpanel");
  if (!p.hidden) return closeCatPanel();
  p.hidden = false; $("btn-filter").setAttribute("aria-expanded", "true");
  renderCatPanel();
  const r = $("btn-filter").getBoundingClientRect();
  p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 8) + "px";
  p.style.top = (r.bottom + 4) + "px";
};
$("btn-filter-clear").onclick = () => { S.cat = null; render(); };
document.addEventListener("pointerdown", (e) => { if (!$("catpanel").hidden && !e.target.closest("#catpanel, #btn-filter")) closeCatPanel(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("catpanel").hidden) { e.stopPropagation(); closeCatPanel(); } }, true);

// Absender mehrerer Mails einer Kategorie zuordnen (oder, wenn alle schon
// drin sind, wieder herausnehmen).
function assignMany(ms, id) {
  const addrs = [...new Set(ms.map(addrOf).filter(Boolean))];
  if (!addrs.length) return;
  const r = catRules();
  const allIn = addrs.every((a) => (r[a] || []).includes(id));
  for (const a of addrs) {
    const set = new Set(r[a] || []);
    if (allIn) set.delete(id); else set.add(id);
    if (set.size) r[a] = [...set]; else delete r[a];
  }
  saveCatRules(r);
  const c = catById(id);
  toast(allIn ? `${addrs.length === 1 ? addrs[0] : addrs.length + " Absender"} nicht mehr in „${c?.name}“.`
              : `${addrs.length === 1 ? addrs[0] : addrs.length + " Absender"} jetzt in „${c?.name}“. Auch künftige Mails.`);
  render();
  if (S.msg) renderMsgCats(S.msg);
}
function addCatSubmenuMany(ms) {
  const it = menuItem(menu, "Kategorie", null, { sub: true });
  const sub = document.createElement("div");
  sub.className = "menu sub"; sub.setAttribute("role", "menu");
  const h = document.createElement("div"); h.className = "menu-h"; h.textContent = "Absender dieser Mails zuordnen"; sub.appendChild(h);
  for (const c of cats()) {
    const all = ms.every((m) => catsOf(m).includes(c.id));
    const b = menuItem(sub, (all ? "✓ " : "") + c.name, () => assignMany(ms, c.id));
    b.prepend(catDot(c));
  }
  it.appendChild(sub);
  const open = () => {
    sub.classList.add("show");
    const r = it.getBoundingClientRect(), sr = sub.getBoundingClientRect();
    sub.style.left = (r.right + sr.width > innerWidth ? -sr.width + 4 : r.width - 4) + "px";
    sub.style.top = Math.min(0, innerHeight - r.top - sr.height - 8) + "px";
  };
  it.addEventListener("mouseenter", open);
  it.addEventListener("click", (e) => { e.stopPropagation(); open(); });
  it.addEventListener("mouseleave", () => sub.classList.remove("show"));
}

/* ---------- Schilder ---------- */
function catTags(m) {
  const ids = catsOf(m);
  if (!ids.length) return null;
  const wrap = document.createElement("span");
  wrap.className = "cattags";
  for (const id of ids) {
    const c = catById(id); if (!c) continue;
    const t = document.createElement("span"); t.className = "cattag";
    t.style.setProperty("--c", c.color); t.textContent = c.name;
    wrap.appendChild(t);
  }
  return wrap;
}
// In der geöffneten Mail: Schilder plus „Kategorie zuordnen“.
function renderMsgCats(msg) {
  const host = document.querySelector("#read .msgcats");
  if (!host || !S.msg || key(S.msg) !== key(msg)) return;
  host.innerHTML = "";
  const m = { folder: msg.folder, from_addr: msg.from_addr };
  const tags = catTags(m);
  if (tags) host.appendChild(tags);
  if (!addrOf(m)) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "catadd"; b.textContent = catsOf(m).length ? "Kategorien ändern" : "+ Kategorie zuordnen";
  b.onclick = (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); showCatMenu(r.left, r.bottom + 4, m); };
  host.appendChild(b);
}

/* ---------- Menü ---------- */
function catMenuItems(parent, m) {
  const a = addrOf(m);
  const dom = a.split("@")[1];
  const mine = new Set(catRules()[a] || []), domCats = new Set(catRules()["@" + dom] || []);
  const head = (t) => { const h = document.createElement("div"); h.className = "menu-h"; h.textContent = t; parent.appendChild(h); };
  head(`Absender ${a}`);
  for (const c of cats()) {
    const b = menuItem(parent, (mine.has(c.id) ? "✓ " : "") + c.name, () => toggleRule(a, c.id));
    b.prepend(catDot(c));
  }
  if (dom) {
    head(`Alles von @${dom}`);
    for (const c of cats()) {
      const b = menuItem(parent, (domCats.has(c.id) ? "✓ " : "") + c.name, () => toggleRule("@" + dom, c.id));
      b.prepend(catDot(c));
    }
  }
}
function showCatMenu(x, y, m) {
  menu.innerHTML = "";
  catMenuItems(menu, m);
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}
// Untermenü „Kategorie“ im Rechtsklick-Menü der Liste
function addCatSubmenu(m) {
  if (!addrOf(m)) return;
  const it = menuItem(menu, "Kategorie", null, { sub: true });
  const sub = document.createElement("div");
  sub.className = "menu sub"; sub.setAttribute("role", "menu");
  catMenuItems(sub, m);
  it.appendChild(sub);
  const open = () => {
    sub.classList.add("show");
    const r = it.getBoundingClientRect(), sr = sub.getBoundingClientRect();
    sub.style.left = (r.right + sr.width > innerWidth ? -sr.width + 4 : r.width - 4) + "px";
    sub.style.top = Math.min(0, innerHeight - r.top - sr.height - 8) + "px";
  };
  it.addEventListener("mouseenter", open);
  it.addEventListener("click", (e) => { e.stopPropagation(); open(); });
  it.addEventListener("mouseleave", () => sub.classList.remove("show"));
}

/* ---------- Einstellungen: Kategorien verwalten ---------- */
function renderCatSettings() {
  const box = $("cat-settings");
  if (!box) return;
  box.innerHTML = "";
  const list = cats();
  const r = catRules();
  for (const c of list) {
    const row = document.createElement("div"); row.className = "catrow";
    const col = document.createElement("input"); col.type = "color"; col.value = c.color; col.title = "Farbe";
    col.onchange = () => { c.color = col.value; saveCats(list); render(); };
    const name = document.createElement("input"); name.value = c.name; name.maxLength = 30;
    name.onchange = () => { if (name.value.trim()) { c.name = name.value.trim(); saveCats(list); render(); } };
    const n = Object.values(r).filter((ids) => ids.includes(c.id)).length;
    const info = document.createElement("span"); info.className = "set-small"; info.textContent = n === 1 ? "1 Absender" : `${n} Absender`;
    const del = document.createElement("button"); del.type = "button"; del.textContent = "Löschen";
    del.onclick = () => {
      if (!del.dataset.confirm) { del.dataset.confirm = "1"; del.textContent = "Wirklich?"; return; }
      saveCats(list.filter((x) => x.id !== c.id));
      const rr = catRules();
      for (const k of Object.keys(rr)) { rr[k] = rr[k].filter((id) => id !== c.id); if (!rr[k].length) delete rr[k]; }
      saveCatRules(rr);
      if (S.cat === c.id) S.cat = null;
      renderCatSettings(); render();
    };
    row.append(col, name, info, del);
    box.appendChild(row);
  }
}
$("btn-settings").addEventListener("click", renderCatSettings);

start().catch((err) => showSetup(String(err)));
