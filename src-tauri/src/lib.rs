//! Nemeton Mail – Backend.
//!
//! Spricht per IMAP mit dem Mailserver (z.B. Posteo) und stellt der
//! Oberfläche einfache Befehle bereit: Konto einrichten, Ordner und Mails
//! laden, Mail öffnen, als gelesen/ungelesen markieren, löschen, suchen.
//! Das Passwort liegt im Schlüsselbund des Systems (macOS-Schlüsselbund bzw.
//! Windows-Anmeldeinformationsverwaltung), nie in einer Datei.

pub mod imap_client;
pub mod smtp;

use imap_client::{Account, Folder, FullMessage, MailClient, Summary};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

const KEYRING_SERVICE: &str = "nemeton-mail";

#[derive(Default)]
struct AppState {
    client: Mutex<Option<MailClient>>,
    /// Zuletzt gewählter Ordner beim Sichern von Anhängen.
    save_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AccountFile {
    email: String,
    host: String,
    port: u16,
    /// Testmodus: nichts auf dem Server ändern. Standard: an.
    #[serde(default = "default_true")]
    test_mode: bool,
    /// Dein Name, wie ihn Empfänger sehen.
    #[serde(default)]
    name: String,
    /// Weitere Absenderadressen (Aliasse bei Posteo).
    #[serde(default)]
    aliases: Vec<String>,
    /// Postausgangsserver; leer = wie IMAP-Server.
    #[serde(default)]
    smtp_host: String,
    #[serde(default = "default_smtp_port")]
    smtp_port: u16,
}

fn default_smtp_port() -> u16 {
    465
}

fn default_true() -> bool {
    true
}

fn test_mode(app: &tauri::AppHandle) -> bool {
    load_account(app).map(|a| a.test_mode).unwrap_or(true)
}

fn account_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("konto.json"))
}

fn load_account(app: &tauri::AppHandle) -> Option<AccountFile> {
    let p = account_path(app).ok()?;
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

fn password_for(email: &str) -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, email)
        .and_then(|e| e.get_password())
        .map_err(|_| "Kein gespeichertes Passwort gefunden.".to_string())
}

/// Führt `f` mit einer bestehenden Verbindung aus. Ist die Verbindung
/// abgerissen, wird vorher neu verbunden.
fn with_client<T>(
    app: &tauri::AppHandle,
    state: &AppState,
    f: impl Fn(&mut MailClient) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.client.lock().map_err(|_| "Interner Fehler".to_string())?;
    let read_only = test_mode(app);
    // Erst prüfen, ob die Verbindung noch steht, und sonst neu verbinden.
    // Der eigentliche Befehl läuft dann genau einmal. (Früher wurde er bei
    // einem Fehler wiederholt – beim Verschieben konnte das Mails doppelt
    // bewegen oder einen Fehler melden, obwohl es geklappt hatte.)
    let alive = guard.as_mut().map(|c| c.ping()).unwrap_or(false);
    if !alive {
        *guard = Some(connect_saved(app)?);
    }
    let c = guard.as_mut().unwrap();
    c.read_only = read_only;
    let res = f(c);
    if res.is_err() && !c.ping() {
        *guard = None; // beim nächsten Mal neu verbinden
    }
    res
}

fn connect_saved(app: &tauri::AppHandle) -> Result<MailClient, String> {
    let acc = load_account(app).ok_or("Noch kein Konto eingerichtet.")?;
    let pw = password_for(&acc.email)?;
    MailClient::connect(&Account { email: acc.email, password: pw, host: acc.host, port: acc.port })
}

#[tauri::command]
fn get_account(app: tauri::AppHandle) -> Option<AccountFile> {
    load_account(&app)
}

#[tauri::command]
async fn save_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    email: String,
    password: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let acc = Account { email: email.clone(), password: password.clone(), host: host.clone(), port };
    let client = tauri::async_runtime::spawn_blocking(move || MailClient::connect(&acc))
        .await
        .map_err(|e| e.to_string())??;
    keyring::Entry::new(KEYRING_SERVICE, &email)
        .and_then(|e| e.set_password(&password))
        .map_err(|e| format!("Passwort konnte nicht im Schlüsselbund gespeichert werden: {e}"))?;
    let file = AccountFile { email, host, port, test_mode: true, name: String::new(), aliases: vec![], smtp_host: String::new(), smtp_port: 465 };
    std::fs::write(account_path(&app)?, serde_json::to_string_pretty(&file).unwrap())
        .map_err(|e| e.to_string())?;
    *state.client.lock().unwrap() = Some(client);
    Ok(())
}

fn write_account(app: &tauri::AppHandle, acc: &AccountFile) -> Result<(), String> {
    std::fs::write(account_path(app)?, serde_json::to_string_pretty(acc).unwrap()).map_err(|e| e.to_string())
}

/// Speichert deinen Namen und deine weiteren Absenderadressen.
#[tauri::command]
fn save_identity(app: tauri::AppHandle, name: String, aliases: Vec<String>) -> Result<(), String> {
    let mut acc = load_account(&app).ok_or("Noch kein Konto eingerichtet.")?;
    acc.name = name.trim().to_string();
    let mut list: Vec<String> = Vec::new();
    for a in aliases {
        let a = a.trim().to_lowercase();
        if !a.is_empty() && a != acc.email.to_lowercase() && !list.contains(&a) {
            smtp::mailbox(&a)?;
            list.push(a);
        }
    }
    acc.aliases = list;
    write_account(&app, &acc)
}

#[derive(Deserialize)]
struct MsgRef {
    folder: String,
    uid: u32,
}

#[derive(Deserialize)]
struct NewAttachment {
    name: String,
    mime: String,
    /// Inhalt, Base64-kodiert.
    data: String,
}

#[derive(Deserialize)]
struct Draft {
    from: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    html: String,
    text: String,
    in_reply_to: Option<String>,
    references: Option<String>,
    attachments: Vec<NewAttachment>,
    /// Beim Weiterleiten: Anhänge dieser Mail mitschicken.
    forward: Option<MsgRef>,
    forward_skip: Option<Vec<String>>,
    /// Beim Antworten: diese Mail als „beantwortet“ markieren.
    answered: Option<MsgRef>,
}

/// Verschickt eine Mail. Im Testmodus geht sie nur an dich selbst
/// (mit dem Hinweis, an wen sie eigentlich gegangen wäre), und auf dem
/// Server wird sonst nichts geändert.
#[tauri::command]
async fn send_mail(app: tauri::AppHandle, draft: Draft) -> Result<String, String> {
    use base64::Engine;
    let acc = load_account(&app).ok_or("Noch kein Konto eingerichtet.")?;
    let pw = password_for(&acc.email)?;
    let test = acc.test_mode;
    // Absender muss eine deiner Adressen sein.
    let from_addr = draft.from.trim().to_lowercase();
    if from_addr != acc.email.to_lowercase() && !acc.aliases.iter().any(|a| *a == from_addr) {
        return Err("Diese Absenderadresse ist nicht eingerichtet.".into());
    }
    let from = if acc.name.is_empty() { smtp::mailbox(&from_addr)? } else {
        lettre::message::Mailbox::new(Some(acc.name.clone()), from_addr.parse().map_err(|_| "Ungültige Absenderadresse.")?)
    };
    let parse = |l: &[String]| l.iter().filter(|s| !s.trim().is_empty()).map(|s| smtp::mailbox(s)).collect::<Result<Vec<_>, _>>();
    let (mut to, mut cc, mut bcc) = (parse(&draft.to)?, parse(&draft.cc)?, parse(&draft.bcc)?);
    let mut subject = draft.subject.clone();
    let (mut html, mut text) = (draft.html.clone(), draft.text.clone());
    if test {
        let list = |l: &[lettre::message::Mailbox]| l.iter().map(|m| m.to_string()).collect::<Vec<_>>().join(", ");
        let note = format!(
            "Testmodus: Diese Mail ging nur an dich. Eigentlich an: {}{}{}",
            list(&to),
            if cc.is_empty() { String::new() } else { format!(" · Kopie: {}", list(&cc)) },
            if bcc.is_empty() { String::new() } else { format!(" · Blindkopie: {}", list(&bcc)) }
        );
        if to.is_empty() && cc.is_empty() && bcc.is_empty() {
            return Err("Bitte mindestens einen Empfänger eintragen.".into());
        }
        let esc = note.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        html = format!("<div style=\"background:#fff3c4;border:1px solid #e0c060;padding:6px 10px;margin-bottom:12px;font-family:sans-serif;font-size:13px\">{esc}</div>{html}");
        text = format!("[{note}]\n\n{text}");
        subject = format!("[Test] {subject}");
        to = vec![smtp::mailbox(&acc.email)?];
        cc.clear();
        bcc.clear();
    }
    let mut attachments = Vec::new();
    for a in &draft.attachments {
        let data = base64::engine::general_purpose::STANDARD.decode(a.data.as_bytes()).map_err(|_| format!("Anhang „{}“ ist beschädigt.", a.name))?;
        attachments.push(smtp::OutAttachment { name: a.name.clone(), mime: a.mime.clone(), data });
    }
    if let Some(f) = draft.forward {
        let skip = draft.forward_skip.clone().unwrap_or_default();
        let list = blocking(app.clone(), move |c| c.attachments(&f.folder, f.uid)).await?;
        for a in list.into_iter().filter(|a| !skip.contains(&a.name)) {
            attachments.push(smtp::OutAttachment { name: a.name, mime: a.mime, data: a.data });
        }
    }
    let out = smtp::Outgoing {
        from, to, cc, bcc, subject, html, text,
        in_reply_to: draft.in_reply_to.clone(),
        references: draft.references.clone(),
        attachments,
    };
    let server = smtp::Server {
        host: if acc.smtp_host.is_empty() { acc.host.clone() } else { acc.smtp_host.clone() },
        port: acc.smtp_port,
        user: acc.email.clone(),
        password: pw,
    };
    let raw = tauri::async_runtime::spawn_blocking(move || smtp::send(&server, &out)).await.map_err(|e| e.to_string())??;
    if test {
        return Ok("Testmodus: Die Mail ging nur an dich selbst.".into());
    }
    // Kopie in „Gesendet“ ablegen und die beantwortete Mail markieren.
    let answered = draft.answered;
    let saved = blocking(app, move |c| {
        let sent = c.list_folders()?.into_iter().find(|f| f.role == "sent").map(|f| f.id);
        if let Some(r) = &answered {
            let _ = c.set_answered(&r.folder, r.uid);
        }
        match &sent {
            Some(s) => c.append(s, &raw).map(|_| true),
            None => Ok(false),
        }
    })
    .await;
    Ok(match saved {
        Ok(true) => "Gesendet.".into(),
        _ => "Gesendet. Die Kopie im Ordner „Gesendet“ konnte aber nicht abgelegt werden.".into(),
    })
}

#[tauri::command]
fn set_test_mode(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let mut acc = load_account(&app).ok_or("Noch kein Konto eingerichtet.")?;
    acc.test_mode = on;
    std::fs::write(account_path(&app)?, serde_json::to_string_pretty(&acc).unwrap()).map_err(|e| e.to_string())
}

/// Öffnet einen Link aus einer Mail im normalen Browser bzw. Mailprogramm.
/// Nur Webseiten (http/https) und E-Mail-Adressen (mailto) sind erlaubt,
/// damit eine Mail keine Programme oder Dateien auf dem Computer starten kann.
#[tauri::command]
fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_external(&app, &url)
}

fn open_external<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("Nur Webseiten und E-Mail-Adressen können geöffnet werden.".into());
    }
    if u.chars().any(|c| c.is_control()) {
        return Err("Ungültiger Link.".into());
    }
    app.opener().open_url(u, None::<&str>).map_err(|e| e.to_string())
}

/// Ist das eine Adresse der App selbst (statt einer Webseite aus dem Netz)?
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "ipc.localhost" | "127.0.0.1")),
        "mailto" => false,
        _ => true,
    }
}

/// Dateiarten, die Programme starten können. Solche Anhänge werden nie
/// direkt geöffnet, sondern nur im Ordner gezeigt.
const RISKY: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl", "msc",
    "jar", "lnk", "reg", "app", "command", "sh", "pkg", "mpkg", "workflow", "scpt", "applescript", "terminal", "url", "webloc", "inetloc", "iso", "img", "dmg", "html", "htm", "svg", "xhtml",
];

fn safe_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let n = n.trim().trim_start_matches('.').trim().to_string();
    if n.is_empty() { "Anhang".into() } else { n.chars().take(150).collect() }
}

fn is_risky(name: &str) -> bool {
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    lower.contains('.') && RISKY.contains(&ext)
}

/// Freier Dateiname im Ordner: „Datei.pdf“, sonst „Datei (2).pdf“ usw.
fn free_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

/// Öffnet einen Anhang mit dem passenden Programm (z.B. PDF-Anzeige).
/// Er wird dazu in einen Ordner für vorübergehende Dateien gelegt.
#[tauri::command]
async fn open_attachment(app: tauri::AppHandle, folder: String, uid: u32, index: usize) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let a = blocking(app.clone(), move |c| c.attachment(&folder, uid, index)).await?;
    let name = safe_name(&a.name);
    let dir = std::env::temp_dir().join("Nemeton Mail Anhänge");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_path(&dir, &name);
    std::fs::write(&path, &a.data).map_err(|e| format!("Anhang konnte nicht abgelegt werden: {e}"))?;
    if is_risky(&name) {
        app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
        return Ok(format!("„{name}“ könnte ein Programm sein und wird aus Sicherheitsgründen nicht geöffnet. Die Datei wird im Ordner gezeigt."));
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| format!("Kein Programm zum Öffnen gefunden: {e}"))?;
    Ok(String::new())
}

/// Speichert einen Anhang. Ein Fenster fragt, wo er hin soll (beim ersten
/// Mal ist „Downloads“ vorgeschlagen, danach der zuletzt gewählte Ordner).
#[tauri::command]
async fn save_attachment(app: tauri::AppHandle, folder: String, uid: u32, index: usize) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_opener::OpenerExt;
    let a = blocking(app.clone(), move |c| c.attachment(&folder, uid, index)).await?;
    let name = safe_name(&a.name);
    let start = app.state::<AppState>().save_dir.lock().ok().and_then(|d| d.clone()).or_else(|| app.path().download_dir().ok());
    let app2 = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app2.dialog().file().set_title("Anhang sichern").set_file_name(&name);
        if let Some(dir) = start {
            d = d.set_directory(dir);
        }
        d.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = chosen.and_then(|p| p.as_path().map(|p| p.to_path_buf())) else {
        return Ok(String::new()); // abgebrochen
    };
    std::fs::write(&path, &a.data).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))?;
    if let Some(dir) = path.parent() {
        *app.state::<AppState>().save_dir.lock().unwrap() = Some(dir.to_path_buf());
    }
    let _ = app.opener().reveal_item_in_dir(&path);
    Ok(format!("Gespeichert: {}", path.file_name().unwrap_or_default().to_string_lossy()))
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn logout(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(acc) = load_account(&app) {
        let _ = keyring::Entry::new(KEYRING_SERVICE, &acc.email).and_then(|e| e.delete_credential());
    }
    let _ = std::fs::remove_file(account_path(&app)?);
    *state.client.lock().unwrap() = None;
    Ok(())
}

// Die IMAP-Befehle blockieren. Damit die Oberfläche flüssig bleibt, laufen
// sie in einem eigenen Hintergrund-Thread.
async fn blocking<T: Send + 'static>(
    app: tauri::AppHandle,
    f: impl Fn(&mut MailClient) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_client(&app, &state, f)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_folders(app: tauri::AppHandle) -> Result<Vec<Folder>, String> {
    blocking(app, |c| c.list_folders()).await
}

#[tauri::command]
async fn list_messages(app: tauri::AppHandle, folder: String, limit: Option<usize>) -> Result<Vec<Summary>, String> {
    blocking(app, move |c| c.list_messages(&folder, limit.unwrap_or(300))).await
}

#[tauri::command]
async fn get_message(app: tauri::AppHandle, folder: String, uid: u32) -> Result<FullMessage, String> {
    blocking(app, move |c| c.get_message(&folder, uid)).await
}

#[tauri::command]
async fn set_seen(app: tauri::AppHandle, folder: String, uid: u32, seen: bool) -> Result<(), String> {
    blocking(app, move |c| c.set_seen(&folder, uid, seen)).await
}

#[tauri::command]
async fn delete_message(app: tauri::AppHandle, folder: String, uid: u32) -> Result<(), String> {
    blocking(app, move |c| c.delete(&folder, uid)).await
}

#[tauri::command]
async fn move_message(app: tauri::AppHandle, folder: String, uid: u32, target: String) -> Result<(), String> {
    blocking(app, move |c| c.move_to(&folder, uid, &target)).await
}

#[tauri::command]
async fn move_messages(app: tauri::AppHandle, folder: String, uids: Vec<u32>, target: String) -> Result<usize, String> {
    blocking(app, move |c| c.move_many(&folder, &uids, &target)).await
}

#[tauri::command]
async fn delete_messages(app: tauri::AppHandle, folder: String, uids: Vec<u32>) -> Result<usize, String> {
    blocking(app, move |c| c.delete_many(&folder, &uids)).await
}

#[tauri::command]
async fn mark_all_read(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    blocking(app, move |c| c.mark_all_read(&folder)).await
}

#[tauri::command]
async fn create_folder(app: tauri::AppHandle, parent: String, name: String) -> Result<String, String> {
    blocking(app, move |c| c.create_folder(&parent, &name)).await
}

#[tauri::command]
async fn rename_folder(app: tauri::AppHandle, folder: String, name: String) -> Result<String, String> {
    blocking(app, move |c| c.rename_folder(&folder, &name)).await
}

#[tauri::command]
async fn delete_folder(app: tauri::AppHandle, folder: String) -> Result<usize, String> {
    blocking(app, move |c| c.delete_folder(&folder)).await
}

/// Verschiebt erkannte Werbung aus dem Posteingang in den Ordner „Werbung“.
#[tauri::command]
async fn sort_ads(app: tauri::AppHandle, folder: String, uids: Vec<u32>) -> Result<usize, String> {
    blocking(app, move |c| c.move_many(&folder, &uids, "Werbung")).await
}

#[tauri::command]
async fn search(app: tauri::AppHandle, query: String, folder: Option<String>) -> Result<Vec<Summary>, String> {
    blocking(app, move |c| c.search(&query, folder.as_deref())).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Das Hauptfenster wird hier gebaut, damit Links aus Mails nie im
            // App-Fenster landen: Will ein Link ein neues Fenster öffnen (so
            // klappt das Anklicken auf dem Mac) oder das Fenster wegführen,
            // geht er stattdessen an den normalen Browser.
            let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("Fenster fehlt")?;
            let h1 = app.handle().clone();
            let h2 = app.handle().clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .on_new_window(move |url, _| {
                    let _ = open_external(&h1, url.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        return true;
                    }
                    let _ = open_external(&h2, url.as_str());
                    false
                })
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_account,
            save_account,
            logout,
            set_test_mode,
            open_link,
            app_version,
            open_attachment,
            save_attachment,
            save_identity,
            send_mail,
            list_folders,
            list_messages,
            get_message,
            set_seen,
            delete_message,
            move_message,
            search,
            sort_ads,
            mark_all_read,
            move_messages,
            delete_messages,
            create_folder,
            rename_folder,
            delete_folder
        ])
        .run(tauri::generate_context!())
        .expect("Nemeton Mail konnte nicht starten");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_names() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("Rechnung: Okt.pdf"), "Rechnung_ Okt.pdf");
        assert_eq!(safe_name(""), "Anhang");
        assert!(is_risky("Setup.EXE"));
        assert!(is_risky("x.pdf.app"));
        assert!(!is_risky("Rechnung.pdf"));
        assert!(!is_risky("exe"));
    }
}
