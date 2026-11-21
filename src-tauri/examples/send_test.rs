//! Prüft das Verschicken gegen einen Testserver und legt die Kopie in „Gesendet“ ab.
use nemeton_mail_lib::imap_client::{Account, MailClient};
use nemeton_mail_lib::smtp::{mailbox, send, OutAttachment, Outgoing, Server};

fn main() {
    let env = |k: &str| std::env::var(k).unwrap();
    let server = Server { host: env("NM_HOST"), port: env("NM_SMTP_PORT").parse().unwrap(), user: env("NM_USER"), password: env("NM_PASS") };
    let m = Outgoing {
        from: "\"Patrick Test\" <test@example.org>".parse().unwrap(),
        to: vec![mailbox("\"Müller, Jürgen\" <j@example.org>").unwrap()],
        cc: vec![mailbox("b@example.org").unwrap()],
        bcc: vec![mailbox("geheim@example.org").unwrap()],
        subject: "Re: Änderung für Samstag".into(),
        html: "<div style=\"font-family:Verdana\">Grüße</div>".into(),
        text: "Grüße".into(),
        in_reply_to: Some("<abc@example.org>".into()),
        references: Some("<x1@e> <abc@example.org>".into()),
        attachments: vec![OutAttachment { name: "plan ü.pdf".into(), mime: "application/pdf".into(), data: b"%PDF-1.4 test".to_vec() }],
    };
    let raw = send(&server, &m).expect("senden");
    let sent = String::from_utf8_lossy(&std::fs::read("/tmp/smtpd/last.eml").unwrap()).to_string();
    println!("Umschlag:\n{}", std::fs::read_to_string("/tmp/smtpd/last.env").unwrap());
    println!("Bcc in verschickter Mail: {}", sent.contains("geheim@"));
    println!("Bcc in Kopie für Gesendet: {}", String::from_utf8_lossy(&raw).contains("geheim@"));
    for h in ["From:", "To:", "Cc:", "Subject:", "In-Reply-To:", "References:", "Message-ID:"] {
        println!("{}", sent.lines().find(|l| l.starts_with(h)).unwrap_or("FEHLT"));
    }
    let mut c = MailClient::connect(&Account { email: env("NM_USER"), password: env("NM_PASS"), host: env("NM_HOST"), port: 9993 }).unwrap();
    println!("Ablegen im Testmodus: {:?}", c.append("Sent", &raw).err());
    c.read_only = false;
    let before = c.list_messages("Sent", 500).unwrap().len();
    c.append("Sent", &raw).unwrap();
    let list = c.list_messages("Sent", 500).unwrap();
    let top = list.iter().max_by_key(|m| m.uid).unwrap();
    println!("Gesendet: {} -> {}, oben: {} / gelesen={}", before, list.len(), top.subject, top.seen);
    let full = c.get_message("Sent", top.uid).unwrap();
    println!("Anhänge: {:?}, to_list={:?}", full.attachments, full.to_list);
    let atts = c.attachments("Sent", top.uid).unwrap();
    println!("Anhang-Inhalt: {} {} {:?}", atts[0].name, atts[0].mime, String::from_utf8_lossy(&atts[0].data));
}
