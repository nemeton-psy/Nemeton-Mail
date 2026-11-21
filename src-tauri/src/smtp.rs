//! Mails verschicken per SMTP (bei Posteo: posteo.de, Port 465).

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct OutAttachment {
    pub name: String,
    pub mime: String,
    pub data: Vec<u8>,
}

pub struct Outgoing {
    pub from: Mailbox,
    pub to: Vec<Mailbox>,
    pub cc: Vec<Mailbox>,
    pub bcc: Vec<Mailbox>,
    pub subject: String,
    pub html: String,
    pub text: String,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub attachments: Vec<OutAttachment>,
}

pub struct Server {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

/// Liest eine Adresse wie „Max Muster <max@example.org>“ oder „max@example.org“.
pub fn mailbox(s: &str) -> Result<Mailbox, String> {
    let s = s.trim();
    s.parse::<Mailbox>().map_err(|_| format!("„{s}“ ist keine gültige E-Mail-Adresse."))
}

fn new_message_id(from: &Mailbox) -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let domain = from.email.domain().to_string();
    format!("<{:x}.{:x}@{}>", nanos, std::process::id(), domain)
}

/// Baut die Mail. `keep_bcc`: für die Kopie in „Gesendet“, damit du später
/// siehst, wer in Blindkopie war. Verschickt wird sie ohne diese Zeile.
fn build(m: &Outgoing, id: &str, date: SystemTime, keep_bcc: bool) -> Result<Message, String> {
    let mut b = Message::builder()
        .from(m.from.clone())
        .subject(m.subject.clone())
        .date(date)
        .message_id(Some(id.to_string()))
        .user_agent("Nemeton Mail".into());
    for a in &m.to {
        b = b.to(a.clone());
    }
    for a in &m.cc {
        b = b.cc(a.clone());
    }
    for a in &m.bcc {
        b = b.bcc(a.clone());
    }
    if let Some(r) = m.in_reply_to.as_ref().filter(|r| !r.is_empty()) {
        b = b.in_reply_to(r.clone());
    }
    if let Some(r) = m.references.as_ref().filter(|r| !r.is_empty()) {
        b = b.references(r.clone());
    }
    if keep_bcc {
        b = b.keep_bcc();
    }
    let alt = MultiPart::alternative()
        .singlepart(SinglePart::plain(m.text.clone()))
        .singlepart(SinglePart::html(m.html.clone()));
    let body = if m.attachments.is_empty() {
        alt
    } else {
        let mut mixed = MultiPart::mixed().multipart(alt);
        for a in &m.attachments {
            let ct = ContentType::parse(&a.mime).unwrap_or(ContentType::parse("application/octet-stream").unwrap());
            mixed = mixed.singlepart(Attachment::new(a.name.clone()).body(a.data.clone(), ct));
        }
        mixed
    };
    b.multipart(body).map_err(|e| format!("Mail konnte nicht erstellt werden: {e}"))
}

/// Verschickt die Mail und gibt die fertige Fassung (mit Blindkopie-Zeile)
/// für den Ordner „Gesendet“ zurück.
pub fn send(server: &Server, m: &Outgoing) -> Result<Vec<u8>, String> {
    if m.to.is_empty() && m.cc.is_empty() && m.bcc.is_empty() {
        return Err("Bitte mindestens einen Empfänger eintragen.".into());
    }
    let id = new_message_id(&m.from);
    let date = SystemTime::now();
    let outgoing = build(m, &id, date, false)?;
    let copy = build(m, &id, date, true)?;
    // Port 587/25: erst unverschlüsselt, dann sofort verschlüsselt (STARTTLS).
    // Sonst (z.B. 465 bei Posteo): von Anfang an verschlüsselt.
    let builder = if server.port == 587 || server.port == 25 {
        SmtpTransport::starttls_relay(&server.host)
    } else {
        SmtpTransport::relay(&server.host)
    }
    .map_err(|e| format!("Postausgangsserver nicht erreichbar: {e}"))?;
    let transport = builder
        .port(server.port)
        .credentials(Credentials::new(server.user.clone(), server.password.clone()))
        .timeout(Some(std::time::Duration::from_secs(60)))
        .build();
    transport.send(&outgoing).map_err(|e| format!("Senden fehlgeschlagen: {e}"))?;
    Ok(copy.formatted())
}
