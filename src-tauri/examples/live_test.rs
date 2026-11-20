//! Testet die IMAP-Funktionen gegen einen echten Server.
//! Aufruf: NM_HOST=localhost NM_PORT=9993 NM_USER=... NM_PASS=... cargo run --example live_test
use nemeton_mail_lib::imap_client::{Account, MailClient};

fn main() {
    let env = |k: &str| std::env::var(k).expect(k);
    let acc = Account { email: env("NM_USER"), password: env("NM_PASS"), host: env("NM_HOST"), port: env("NM_PORT").parse().unwrap() };
    let mut c = MailClient::connect(&acc).expect("connect");
    // Testmodus (Standard): nichts darf sich ändern.
    assert!(c.read_only);
    let before = c.list_messages("INBOX", 300).unwrap();
    let u = before.iter().find(|m| !m.seen).expect("ungelesene Mail").uid;
    c.get_message("INBOX", u).unwrap();
    let still = c.list_messages("INBOX", 300).unwrap().iter().find(|m| m.uid == u).unwrap().seen;
    println!("TESTMODUS nach Öffnen gelesen={still}");
    assert!(!still);
    println!("TESTMODUS löschen: {:?}", c.delete("INBOX", u).err());
    println!("TESTMODUS markieren: {:?}", c.set_seen("INBOX", u, true).err());
    println!("TESTMODUS verschieben: {:?}", c.move_to("INBOX", u, "Rechnungen").err());
    assert_eq!(c.list_messages("INBOX", 300).unwrap().len(), before.len());
    c.read_only = false;
    c.move_to("INBOX", u, "Rechnungen").expect("move");
    println!("VERSCHOBEN: INBOX={} Rechnungen={:?}", c.list_messages("INBOX", 300).unwrap().len(), c.list_messages("Rechnungen", 300).unwrap().iter().map(|m| &m.subject).collect::<Vec<_>>());
    let back = c.list_messages("Rechnungen", 300).unwrap().into_iter().max_by_key(|m| m.uid).unwrap().uid;
    c.move_to("Rechnungen", back, "INBOX").expect("move back");
    let folders = c.list_folders().expect("folders");
    for f in &folders { println!("ORDNER {:<12} {:<12} rolle={:<7} ungelesen={} gesamt={}", f.id, f.name, f.role, f.unseen, f.total); }
    let list = c.list_messages("INBOX", 300).expect("list");
    for m in &list { println!("MAIL uid={} gelesen={} von={:?} betreff={:?}", m.uid, m.seen, m.from, m.subject); }
    let first = list.iter().find(|m| !m.seen).unwrap();
    let full = c.get_message("INBOX", first.uid).expect("get");
    println!("GEÖFFNET {:?} text={:?} html={}", full.subject, full.text.as_deref().map(|t| t.trim()), full.html.is_some());
    let after = c.list_messages("INBOX", 300).unwrap();
    println!("NACH ÖFFNEN gelesen={}", after.iter().find(|m| m.uid == first.uid).unwrap().seen);
    c.set_seen("INBOX", first.uid, false).unwrap();
    println!("WIEDER UNGELESEN gelesen={}", c.list_messages("INBOX", 300).unwrap().iter().find(|m| m.uid == first.uid).unwrap().seen);
    for q in ["Rechnung", "Änderung", "Heizung"] {
        let r = c.search(q, None).expect("search all");
        println!("SUCHE ALLE {q:?}: {:?}", r.iter().map(|m| (&m.folder, &m.subject)).collect::<Vec<_>>());
    }
    println!("SUCHE INBOX 'Rechnung': {}", c.search("Rechnung", Some("INBOX")).unwrap().len());
    let victim = list.last().unwrap().uid;
    c.delete("INBOX", victim).expect("delete");
    println!("NACH LÖSCHEN INBOX: {}", c.list_messages("INBOX", 300).unwrap().len());
    println!("PAPIERKORB: {:?}", c.list_messages("Trash", 300).unwrap().iter().map(|m| &m.subject).collect::<Vec<_>>());
}
