use nemeton_mail_lib::imap_client::{Account, MailClient};
fn main() {
    let mut c = MailClient::connect(&Account { email: "test@example.org".into(), password: "geheim123".into(), host: "localhost".into(), port: 9993 }).unwrap();
    let l = c.list_messages("INBOX", 100).unwrap();
    println!("INBOX {} bulk={:?}", l.len(), l.iter().filter(|m| m.bulk).count());
    println!("Testmodus: {:?}", c.move_many("INBOX", &[l[0].uid], "Werbung").err());
    c.read_only = false;
    let n = c.move_many("INBOX", &[l[0].uid, l[1].uid], "Werbung").unwrap();
    let w = c.list_messages("Werbung", 100).unwrap();
    println!("verschoben {n}, Werbung hat {}, INBOX jetzt {}", w.len(), c.list_messages("INBOX", 100).unwrap().len());
    println!("Ordner da: {}", c.list_folders().unwrap().iter().any(|f| f.id == "Werbung"));
}
