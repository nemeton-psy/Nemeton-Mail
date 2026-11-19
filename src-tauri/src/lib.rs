//! Nemeton Mail – Backend.
//!
//! Spricht per IMAP mit dem Mailserver (z.B. Posteo) und stellt der
//! Oberfläche einfache Befehle bereit: Konto einrichten, Ordner und Mails
//! laden, Mail öffnen, als gelesen/ungelesen markieren, löschen, suchen.
//! Das Passwort liegt im Schlüsselbund des Systems (macOS-Schlüsselbund bzw.
//! Windows-Anmeldeinformationsverwaltung), nie in einer Datei.

pub mod imap_client;

use imap_client::{Account, Folder, FullMessage, MailClient, Summary};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

const KEYRING_SERVICE: &str = "nemeton-mail";

#[derive(Default)]
struct AppState {
    client: Mutex<Option<MailClient>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AccountFile {
    email: String,
    host: String,
    port: u16,
    /// Testmodus: nichts auf dem Server ändern. Standard: an.
    #[serde(default = "default_true")]
    test_mode: bool,
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
/// abgerissen, wird einmal neu verbunden und erneut versucht.
fn with_client<T>(
    app: &tauri::AppHandle,
    state: &AppState,
    f: impl Fn(&mut MailClient) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.client.lock().map_err(|_| "Interner Fehler".to_string())?;
    let read_only = test_mode(app);
    if guard.is_none() {
        *guard = Some(connect_saved(app)?);
    }
    guard.as_mut().unwrap().read_only = read_only;
    match f(guard.as_mut().unwrap()) {
        Ok(v) => Ok(v),
        Err(e) if e.starts_with("Testmodus") => Err(e),
        Err(_) => {
            let mut c = connect_saved(app)?;
            c.read_only = read_only;
            *guard = Some(c);
            f(guard.as_mut().unwrap())
        }
    }
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
    let file = AccountFile { email, host, port, test_mode: true };
    std::fs::write(account_path(&app)?, serde_json::to_string_pretty(&file).unwrap())
        .map_err(|e| e.to_string())?;
    *state.client.lock().unwrap() = Some(client);
    Ok(())
}

#[tauri::command]
fn set_test_mode(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let mut acc = load_account(&app).ok_or("Noch kein Konto eingerichtet.")?;
    acc.test_mode = on;
    std::fs::write(account_path(&app)?, serde_json::to_string_pretty(&acc).unwrap()).map_err(|e| e.to_string())
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
async fn search(app: tauri::AppHandle, query: String, folder: Option<String>) -> Result<Vec<Summary>, String> {
    blocking(app, move |c| c.search(&query, folder.as_deref())).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_account,
            save_account,
            logout,
            set_test_mode,
            list_folders,
            list_messages,
            get_message,
            set_seen,
            delete_message,
            search
        ])
        .run(tauri::generate_context!())
        .expect("Nemeton Mail konnte nicht starten");
}
