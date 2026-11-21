//! Verbindung zum Mailserver per IMAP.

use imap::types::{Flag, NameAttribute, StatusAttribute, UnsolicitedResponse};
use mailparse::{MailHeaderMap, ParsedMail};
use native_tls::{TlsConnector, TlsStream};
use serde::Serialize;
use std::net::TcpStream;

type Session = imap::Session<TlsStream<TcpStream>>;

pub struct Account {
    pub email: String,
    pub password: String,
    pub host: String,
    pub port: u16,
}

#[derive(Serialize, Clone)]
pub struct Folder {
    /// Name, wie ihn der Server kennt (für alle Befehle).
    pub id: String,
    /// Lesbarer Name für die Anzeige (z.B. „Posteingang“).
    pub name: String,
    /// Rolle: inbox, drafts, sent, trash, junk, archive oder leer.
    pub role: String,
    /// Verschachtelungstiefe für Unterordner.
    pub depth: usize,
    /// Lesbarer Pfad (Oberordner …, Ordner) zum Sortieren.
    pub path: Vec<String>,
    pub unseen: u32,
    pub total: u32,
}

#[derive(Serialize, Clone)]
pub struct Summary {
    pub uid: u32,
    pub folder: String,
    pub from: String,
    pub from_addr: String,
    /// Empfänger (für Gesendet/Entwürfe), z.B. „Max Muster +2“.
    pub to: String,
    pub subject: String,
    /// Sekunden seit 1970 (für die Anzeige in der Oberfläche).
    pub date: i64,
    pub seen: bool,
    pub flagged: bool,
}

#[derive(Serialize)]
pub struct FullMessage {
    pub uid: u32,
    pub folder: String,
    pub from: String,
    pub from_addr: String,
    pub to: String,
    pub cc: String,
    pub subject: String,
    pub date: i64,
    pub html: Option<String>,
    pub text: Option<String>,
    pub attachments: Vec<String>,
    /// Für Antworten: Kennung der Mail und bisheriger Gesprächsverlauf.
    pub message_id: String,
    pub references: String,
    /// Einzelne Adressen (für Antworten / Allen antworten).
    pub from_list: Vec<Addr>,
    pub reply_to: Vec<Addr>,
    pub to_list: Vec<Addr>,
    pub cc_list: Vec<Addr>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Addr {
    pub name: String,
    pub addr: String,
}

/// Ein Anhang mit Inhalt (zum Weiterleiten).
pub struct AttachmentData {
    pub name: String,
    pub mime: String,
    pub data: Vec<u8>,
}

pub struct MailClient {
    session: Session,
    selected: Option<String>,
    /// Testmodus: Nur lesen. Ordner werden mit EXAMINE geöffnet, Mails mit
    /// BODY.PEEK geladen, und Löschen oder Markieren wird abgelehnt.
    /// So ändert sich auf dem Server garantiert nichts.
    pub read_only: bool,
}

const READ_ONLY_MSG: &str = "Testmodus ist an: Auf dem Server wird nichts geändert.";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl MailClient {
    pub fn connect(acc: &Account) -> Result<Self, String> {
        let tls = TlsConnector::builder().build().map_err(err)?;
        let client = imap::connect((acc.host.as_str(), acc.port), acc.host.as_str(), &tls)
            .map_err(|e| format!("Server nicht erreichbar: {e}"))?;
        let session = client
            .login(&acc.email, &acc.password)
            .map_err(|_| "Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.".to_string())?;
        Ok(Self { session, selected: None, read_only: true })
    }

    fn select(&mut self, folder: &str) -> Result<(), String> {
        let tag = format!("{}|{}", self.read_only, folder);
        if self.selected.as_deref() != Some(tag.as_str()) {
            if self.read_only {
                self.session.examine(folder).map_err(err)?;
            } else {
                self.session.select(folder).map_err(err)?;
            }
            self.selected = Some(tag);
        }
        Ok(())
    }

    pub fn list_folders(&mut self) -> Result<Vec<Folder>, String> {
        let names = self.session.list(Some(""), Some("*")).map_err(err)?;
        let mut out = Vec::new();
        for n in names.iter() {
            if n.attributes().iter().any(|a| matches!(a, NameAttribute::NoSelect)) {
                continue;
            }
            let id = n.name().to_string();
            let delim = n.delimiter().unwrap_or(".");
            let role = role_of(&id, n.attributes());
            let leaf = id.rsplit(delim).next().unwrap_or(&id);
            let depth = if role.is_empty() { id.matches(delim).count() } else { 0 };
            let name = match role.as_str() {
                "inbox" => "Posteingang".to_string(),
                "drafts" => "Entwürfe".to_string(),
                "sent" => "Gesendet".to_string(),
                "trash" => "Papierkorb".to_string(),
                "junk" => "Spam".to_string(),
                "archive" => "Archiv".to_string(),
                _ => decode_utf7(leaf),
            };
            let path = id.split(delim).map(decode_utf7).collect();
            out.push(Folder { id, name, role, depth, path, unseen: 0, total: 0 });
        }
        drop(names);
        // Anzahl ungelesener Mails je Ordner abfragen.
        for f in out.iter_mut() {
            if self.session.status(&f.id, "(MESSAGES UNSEEN)").is_ok() {
                while let Ok(resp) = self.session.unsolicited_responses.try_recv() {
                    if let UnsolicitedResponse::Status { attributes, .. } = resp {
                        for a in attributes {
                            match a {
                                StatusAttribute::Messages(m) => f.total = m,
                                StatusAttribute::Unseen(u) => f.unseen = u,
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        // Feste Reihenfolge: Systemordner zuerst, dann der Rest wie vom Server.
        let order = ["inbox", "drafts", "sent", "archive", "junk", "trash"];
        out.sort_by_key(|f| order.iter().position(|r| *r == f.role).unwrap_or(order.len()));
        Ok(out)
    }

    pub fn list_messages(&mut self, folder: &str, limit: usize) -> Result<Vec<Summary>, String> {
        // Ordner jedes Mal neu öffnen, damit neue Mails sicher erscheinen.
        self.selected = None;
        self.select(folder)?;
        let mut uids: Vec<u32> = self.session.uid_search("ALL").map_err(err)?.into_iter().collect();
        uids.sort_unstable();
        let start = uids.len().saturating_sub(limit);
        self.fetch_summaries(folder, &uids[start..])
    }

    fn fetch_summaries(&mut self, folder: &str, uids: &[u32]) -> Result<Vec<Summary>, String> {
        if uids.is_empty() {
            return Ok(vec![]);
        }
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let fetches = self
            .session
            .uid_fetch(&set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
            .map_err(err)?;
        let mut out = Vec::new();
        for f in fetches.iter() {
            let Some(uid) = f.uid else { continue };
            let raw = header_bytes(f).unwrap_or_default();
            let (headers, _) = mailparse::parse_headers(&raw).map_err(err)?;
            let (from, from_addr) = from_of(&headers);
            let date = headers
                .get_first_value("Date")
                .and_then(|d| mailparse::dateparse(&d).ok())
                .or_else(|| f.internal_date().map(|d| d.timestamp()))
                .unwrap_or(0);
            out.push(Summary {
                uid,
                folder: folder.to_string(),
                from,
                from_addr,
                to: to_of(&headers),
                subject: headers.get_first_value("Subject").unwrap_or_default(),
                date,
                seen: f.flags().iter().any(|x| matches!(x, Flag::Seen)),
                flagged: f.flags().iter().any(|x| matches!(x, Flag::Flagged)),
            });
        }
        out.sort_by(|a, b| b.date.cmp(&a.date));
        Ok(out)
    }

    /// Lädt eine Mail vollständig. Außerhalb des Testmodus markiert das sie auf
    /// dem Server als gelesen.
    pub fn get_message(&mut self, folder: &str, uid: u32) -> Result<FullMessage, String> {
        self.select(folder)?;
        let query = if self.read_only { "(UID BODY.PEEK[])" } else { "(UID BODY[])" };
        let fetches = self.session.uid_fetch(uid.to_string(), query).map_err(err)?;
        let f = fetches.iter().next().ok_or("Mail nicht gefunden.")?;
        let body = f.body().ok_or("Mail ist leer.")?;
        let parsed = mailparse::parse_mail(body).map_err(err)?;
        let h = &parsed.headers;
        let (from, from_addr) = from_of(h);
        let mut msg = FullMessage {
            uid,
            folder: folder.to_string(),
            from,
            from_addr,
            to: h.get_first_value("To").unwrap_or_default(),
            cc: h.get_first_value("Cc").unwrap_or_default(),
            subject: h.get_first_value("Subject").unwrap_or_default(),
            date: h.get_first_value("Date").and_then(|d| mailparse::dateparse(&d).ok()).unwrap_or(0),
            html: None,
            text: None,
            attachments: vec![],
            message_id: h.get_first_value("Message-ID").unwrap_or_default().trim().to_string(),
            references: h.get_first_value("References").unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" "),
            from_list: header_addrs(h, "From"),
            reply_to: header_addrs(h, "Reply-To"),
            to_list: header_addrs(h, "To"),
            cc_list: header_addrs(h, "Cc"),
        };
        collect_parts(&parsed, &mut msg);
        Ok(msg)
    }

    /// Holt die Anhänge einer Mail mit Inhalt (zum Weiterleiten).
    /// Ändert nichts auf dem Server (BODY.PEEK).
    pub fn attachments(&mut self, folder: &str, uid: u32) -> Result<Vec<AttachmentData>, String> {
        self.select(folder)?;
        let fetches = self.session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").map_err(err)?;
        let f = fetches.iter().next().ok_or("Mail nicht gefunden.")?;
        let body = f.body().ok_or("Mail ist leer.")?;
        let parsed = mailparse::parse_mail(body).map_err(err)?;
        let mut out = Vec::new();
        collect_attachments(&parsed, &mut out);
        Ok(out)
    }

    /// Legt eine fertige Mail in einem Ordner ab (z.B. Kopie in „Gesendet“).
    pub fn append(&mut self, folder: &str, raw: &[u8]) -> Result<(), String> {
        if self.read_only {
            return Err(READ_ONLY_MSG.into());
        }
        self.session.append_with_flags(folder, raw, &[Flag::Seen]).map_err(err)?;
        self.selected = None;
        Ok(())
    }

    /// Markiert die Mail als „beantwortet“.
    pub fn set_answered(&mut self, folder: &str, uid: u32) -> Result<(), String> {
        if self.read_only {
            return Err(READ_ONLY_MSG.into());
        }
        self.select(folder)?;
        self.session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Answered)").map_err(err)?;
        Ok(())
    }

    pub fn set_seen(&mut self, folder: &str, uid: u32, seen: bool) -> Result<(), String> {
        if self.read_only {
            return Err(READ_ONLY_MSG.into());
        }
        self.select(folder)?;
        let op = if seen { "+FLAGS.SILENT (\\Seen)" } else { "-FLAGS.SILENT (\\Seen)" };
        self.session.uid_store(uid.to_string(), op).map_err(err)?;
        Ok(())
    }

    /// Verschiebt die Mail in den Papierkorb. Liegt sie schon dort, wird sie
    /// endgültig gelöscht.
    pub fn delete(&mut self, folder: &str, uid: u32) -> Result<(), String> {
        if self.read_only {
            return Err(READ_ONLY_MSG.into());
        }
        let trash = self
            .list_folders()?
            .into_iter()
            .find(|f| f.role == "trash")
            .map(|f| f.id);
        self.select(folder)?;
        let id = uid.to_string();
        match trash {
            Some(t) if t != folder => {
                if self.session.uid_mv(&id, &t).is_err() {
                    self.session.uid_copy(&id, &t).map_err(err)?;
                    self.session.uid_store(&id, "+FLAGS.SILENT (\\Deleted)").map_err(err)?;
                    self.session.uid_expunge(&id).map_err(err)?;
                }
            }
            _ => {
                self.session.uid_store(&id, "+FLAGS.SILENT (\\Deleted)").map_err(err)?;
                self.session.uid_expunge(&id).map_err(err)?;
            }
        }
        Ok(())
    }

    /// Verschiebt eine Mail in einen anderen Ordner.
    pub fn move_to(&mut self, folder: &str, uid: u32, target: &str) -> Result<(), String> {
        if self.read_only {
            return Err(READ_ONLY_MSG.into());
        }
        if folder == target {
            return Ok(());
        }
        self.select(folder)?;
        let id = uid.to_string();
        if self.session.uid_mv(&id, target).is_err() {
            self.session.uid_copy(&id, target).map_err(err)?;
            self.session.uid_store(&id, "+FLAGS.SILENT (\\Deleted)").map_err(err)?;
            self.session.uid_expunge(&id).map_err(err)?;
        }
        Ok(())
    }

    /// Sucht in Absender, Betreff und Text. Ohne Ordner: in allen Ordnern
    /// außer Papierkorb und Spam.
    pub fn search(&mut self, query: &str, folder: Option<&str>) -> Result<Vec<Summary>, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }
        let quoted = format!("\"{}\"", q.replace('\\', "\\\\").replace('"', "\\\""));
        let folders: Vec<String> = match folder {
            Some(f) => vec![f.to_string()],
            None => self
                .list_folders()?
                .into_iter()
                .filter(|f| f.role != "trash" && f.role != "junk")
                .map(|f| f.id)
                .collect(),
        };
        let mut out = Vec::new();
        for f in folders {
            if self.select(&f).is_err() {
                continue;
            }
            let criteria = format!("CHARSET UTF-8 OR OR FROM {quoted} SUBJECT {quoted} BODY {quoted}");
            let Ok(found) = self.session.uid_search(&criteria) else { continue };
            let mut uids: Vec<u32> = found.into_iter().collect();
            uids.sort_unstable();
            let start = uids.len().saturating_sub(100);
            out.extend(self.fetch_summaries(&f, &uids[start..])?);
        }
        out.sort_by(|a, b| b.date.cmp(&a.date));
        Ok(out)
    }
}

fn header_bytes(f: &imap::types::Fetch) -> Option<Vec<u8>> {
    f.header().map(|h| h.to_vec())
}

fn role_of(id: &str, attrs: &[NameAttribute]) -> String {
    for a in attrs {
        if let NameAttribute::Custom(c) = a {
            let r = match c.to_ascii_lowercase().as_str() {
                "\\trash" => "trash",
                "\\sent" => "sent",
                "\\drafts" => "drafts",
                "\\junk" => "junk",
                "\\archive" => "archive",
                _ => "",
            };
            if !r.is_empty() {
                return r.into();
            }
        }
    }
    match id.to_ascii_lowercase().as_str() {
        "inbox" => "inbox",
        "trash" | "papierkorb" | "deleted items" => "trash",
        "sent" | "gesendet" | "sent items" => "sent",
        "drafts" | "entwürfe" | "entw&apw-rfe" => "drafts",
        "junk" | "spam" => "junk",
        "archive" | "archiv" => "archive",
        _ => "",
    }
    .into()
}

fn from_of(h: &[mailparse::MailHeader]) -> (String, String) {
    match header_addrs(h, "From").into_iter().next() {
        Some(a) => (if a.name.is_empty() { a.addr.clone() } else { a.name }, a.addr),
        None => parse_from(h.get_first_value("From").as_deref().unwrap_or("")),
    }
}

fn to_of(h: &[mailparse::MailHeader]) -> String {
    let list = header_addrs(h, "To");
    let name = |a: &Addr| if a.name.is_empty() { a.addr.clone() } else { a.name.clone() };
    match list.len() {
        0 => parse_to(h.get_first_value("To").as_deref().unwrap_or("")),
        1 => name(&list[0]),
        n => format!("{} +{}", name(&list[0]), n - 1),
    }
}

fn parse_from(raw: &str) -> (String, String) {
    if let Ok(list) = mailparse::addrparse(raw) {
        if let Some(mailparse::MailAddr::Single(s)) = list.iter().next() {
            let name = s.display_name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| s.addr.clone());
            return (name, s.addr.clone());
        }
    }
    (raw.to_string(), String::new())
}

fn parse_to(raw: &str) -> String {
    let Ok(list) = mailparse::addrparse(raw) else { return raw.to_string() };
    let mut names = Vec::new();
    for a in list.iter() {
        match a {
            mailparse::MailAddr::Single(s) => names.push(
                s.display_name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| s.addr.clone()),
            ),
            mailparse::MailAddr::Group(g) => names.push(g.group_name.clone()),
        }
    }
    match names.len() {
        0 => String::new(),
        1 => names.remove(0),
        n => format!("{} +{}", names[0], n - 1),
    }
}

/// Liest Adressen direkt aus der Kopfzeile. So bleiben Namen wie
/// „Müller, Jürgen“ (mit Komma und Umlauten) richtig zusammen.
fn header_addrs(h: &[mailparse::MailHeader], name: &str) -> Vec<Addr> {
    let Some(hd) = h.get_first_header(name) else { return vec![] };
    match mailparse::addrparse_header(hd) {
        Ok(list) => addr_items(&list),
        Err(_) => addr_list(&hd.get_value()),
    }
}

fn addr_items(list: &mailparse::MailAddrList) -> Vec<Addr> {
    let mut out = Vec::new();
    let mut push = |s: &mailparse::SingleInfo| {
        out.push(Addr { name: s.display_name.clone().unwrap_or_default().trim().to_string(), addr: s.addr.trim().to_string() })
    };
    for a in list.iter() {
        match a {
            mailparse::MailAddr::Single(s) => push(s),
            mailparse::MailAddr::Group(g) => g.addrs.iter().for_each(&mut push),
        }
    }
    out
}

pub fn addr_list(raw: &str) -> Vec<Addr> {
    let mut out = Vec::new();
    let Ok(list) = mailparse::addrparse(raw) else { return out };
    let mut push = |s: &mailparse::SingleInfo| {
        out.push(Addr { name: s.display_name.clone().unwrap_or_default().trim().to_string(), addr: s.addr.trim().to_string() })
    };
    for a in list.iter() {
        match a {
            mailparse::MailAddr::Single(s) => push(s),
            mailparse::MailAddr::Group(g) => g.addrs.iter().for_each(&mut push),
        }
    }
    out
}

fn collect_attachments(p: &ParsedMail, out: &mut Vec<AttachmentData>) {
    if !p.subparts.is_empty() {
        for s in &p.subparts {
            collect_attachments(s, out);
        }
        return;
    }
    let disp = p.get_content_disposition();
    let filename = disp.params.get("filename").cloned().or_else(|| p.ctype.params.get("name").cloned());
    let is_attachment = matches!(disp.disposition, mailparse::DispositionType::Attachment) || filename.is_some();
    if is_attachment {
        if let Ok(data) = p.get_body_raw() {
            out.push(AttachmentData {
                name: filename.unwrap_or_else(|| "Anhang".into()),
                mime: p.ctype.mimetype.clone(),
                data,
            });
        }
    }
}

fn collect_parts(p: &ParsedMail, msg: &mut FullMessage) {
    if !p.subparts.is_empty() {
        for s in &p.subparts {
            collect_parts(s, msg);
        }
        return;
    }
    let disp = p.get_content_disposition();
    let filename = disp.params.get("filename").cloned().or_else(|| p.ctype.params.get("name").cloned());
    let is_attachment = matches!(disp.disposition, mailparse::DispositionType::Attachment) || filename.is_some();
    let mime = p.ctype.mimetype.to_ascii_lowercase();
    if is_attachment {
        msg.attachments.push(filename.unwrap_or_else(|| "Anhang".into()));
    } else if mime == "text/html" && msg.html.is_none() {
        msg.html = p.get_body().ok();
    } else if mime == "text/plain" && msg.text.is_none() {
        msg.text = p.get_body().ok();
    }
}

/// IMAP-Ordnernamen sind in „modifiziertem UTF-7“ kodiert (z.B. „Entw&APw-rfe“).
fn decode_utf7(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let Some(j) = after.find('-') else {
            out.push_str(&rest[i..]);
            return out;
        };
        let chunk = &after[..j];
        if chunk.is_empty() {
            out.push('&');
        } else {
            let b64 = chunk.replace(',', "/");
            let bytes = b64_decode(&b64);
            let units: Vec<u16> = bytes.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            out.push_str(&String::from_utf16_lossy(&units));
        }
        rest = &after[j + 1..];
    }
    out.push_str(rest);
    out
}

fn b64_decode(s: &str) -> Vec<u8> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf = 0u32;
    let mut bits = 0;
    let mut out = Vec::new();
    for c in s.bytes() {
        let Some(v) = T.iter().position(|&x| x == c) else { continue };
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf7_umlaut() {
        assert_eq!(decode_utf7("Entw&APw-rfe"), "Entwürfe");
        assert_eq!(decode_utf7("A&-B"), "A&B");
        assert_eq!(decode_utf7("Plain"), "Plain");
    }

    #[test]
    fn to_parsing() {
        assert_eq!(parse_to("a@example.org"), "a@example.org");
        assert_eq!(parse_to("\"Anna\" <a@x.org>, b@x.org, c@x.org"), "Anna +2");
    }

    #[test]
    fn from_parsing() {
        let (n, a) = parse_from("\"Max Muster\" <max@example.org>");
        assert_eq!(n, "Max Muster");
        assert_eq!(a, "max@example.org");
    }
}
