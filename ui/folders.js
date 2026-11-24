// Nemeton Mail – Rechtsklick-Menü für Ordner und ein kleines Abfragefenster.
"use strict";

// Kleines Fenster für Fragen und Namen. Ergebnis: eingegebener Text,
// true (bestätigt ohne Eingabe) oder null (abgebrochen).
function askDialog({ title, text = "", input = null, ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "dlg-back";
    back.innerHTML = `<form class="dlg" role="dialog" aria-modal="true"><h4></h4><p></p><input hidden><div class="dlg-btns"><button type="button" class="dlg-cancel">Abbrechen</button><button type="submit" class="dlg-ok"></button></div></form>`;
    back.querySelector("h4").textContent = title;
    const p = back.querySelector("p"); p.textContent = text; p.hidden = !text;
    const inp = back.querySelector("input");
    if (input !== null) { inp.hidden = false; inp.value = input; inp.maxLength = 80; }
    const okb = back.querySelector(".dlg-ok"); okb.textContent = ok; if (danger) okb.classList.add("danger");
    const done = (v) => { back.remove(); document.removeEventListener("keydown", esc, true); resolve(v); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(null); } };
    document.addEventListener("keydown", esc, true);
    back.querySelector(".dlg-cancel").onclick = () => done(null);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) done(null); });
    back.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      if (input !== null) { const v = inp.value.trim(); if (v) done(v); else inp.focus(); }
      else done(true);
    };
    document.body.appendChild(back);
    (input !== null ? inp : okb).focus();
    if (input !== null) inp.select();
  });
}

const TEST_HINT = "Im Testmodus wird auf dem Server nichts geändert. Schalte den Testmodus oben aus, um Ordner zu ändern.";

async function folderAction(fn, okMsg) {
  try {
    const res = await fn();
    if (okMsg) toast(typeof okMsg === "function" ? okMsg(res) : okMsg);
    await loadFolders();
    return res;
  } catch (err) {
    toast(String(err), true);
    return null;
  }
}

async function newFolder(parent) {
  if (S.testMode) return toast(TEST_HINT, true);
  const pf = parent ? S.folders.find((f) => f.id === parent) : null;
  const name = await askDialog({ title: pf ? `Neuer Unterordner in „${pf.name}“` : "Neuer Ordner", input: "", ok: "Anlegen" });
  if (!name) return;
  await folderAction(() => invoke("create_folder", { parent: parent || "", name }), `Ordner „${name}“ angelegt.`);
}

async function renameFolder(f) {
  if (S.testMode) return toast(TEST_HINT, true);
  const name = await askDialog({ title: "Ordner umbenennen", input: f.name, ok: "Umbenennen" });
  if (!name || name === f.name) return;
  const newId = await folderAction(() => invoke("rename_folder", { folder: f.id, name }), `Umbenannt in „${name}“.`);
  if (newId && S.folder === f.id) { S.folder = newId; renderFolders(); reloadList(); }
}

async function deleteFolder(f) {
  if (S.testMode) return toast(TEST_HINT, true);
  const n = f.total;
  const ok = await askDialog({
    title: `Ordner „${f.name}“ löschen?`,
    text: n ? `Die ${n === 1 ? "eine Mail" : n + " Mails"} darin kommen vorher in den Papierkorb.` : "Der Ordner ist leer.",
    ok: "Löschen", danger: true,
  });
  if (!ok) return;
  const res = await folderAction(() => invoke("delete_folder", { folder: f.id }), `Ordner „${f.name}“ gelöscht.`);
  if (res !== null && S.folder === f.id) openFolder(S.folders.find((x) => x.role === "inbox")?.id || "INBOX");
}

async function markFolderRead(f) {
  if (S.testMode) {
    // Im Testmodus nur in der App
    if (S.folder === f.id) for (const m of S.list) if (!m.seen) { m.seen = true; S.localSeen.set(key(m), true); }
    f.unseen = 0; renderFolders(); render();
    return toast("Testmodus: nur in der App als gelesen markiert.");
  }
  await folderAction(() => invoke("mark_all_read", { folder: f.id }), `Alle Mails in „${f.name}“ als gelesen markiert.`);
  if (S.folder === f.id) reloadList();
}

function showFolderMenu(x, y, f) {
  menu.innerHTML = "";
  const h = document.createElement("div"); h.className = "menu-h"; h.textContent = f ? f.name : "Ordner"; menu.appendChild(h);
  if (f) {
    menuItem(menu, "Öffnen", () => openFolder(f.id));
    menuItem(menu, "Alle als gelesen markieren", () => markFolderRead(f));
    const sep = document.createElement("div"); sep.className = "sep"; menu.appendChild(sep);
    menuItem(menu, "Neuer Unterordner …", () => newFolder(f.id));
  }
  menuItem(menu, "Neuer Ordner …", () => newFolder(""));
  if (f && !f.role) {
    menuItem(menu, "Umbenennen …", () => renameFolder(f));
    const sep2 = document.createElement("div"); sep2.className = "sep"; menu.appendChild(sep2);
    menuItem(menu, "Ordner löschen …", () => deleteFolder(f), { danger: true });
  }
  placeMenu(x, y);
}

$("folders").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const b = e.target.closest(".folder");
  const f = b ? S.folders.find((x) => x.id === b.dataset.id) : null;
  showFolderMenu(e.clientX, e.clientY, f);
});
