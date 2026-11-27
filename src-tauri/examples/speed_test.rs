use nemeton_mail_lib::imap_client::{Account, MailClient};
use std::time::Instant;
fn main() {
    let mut c = MailClient::connect(&Account { email: "test@example.org".into(), password: "geheim123".into(), host: "localhost".into(), port: 9993 }).unwrap();
    c.read_only = false;
    let t = Instant::now(); let n = c.list_folders().unwrap().len(); println!("Ordner mit Zahlen ({n}): {:?}", t.elapsed());
    let t = Instant::now(); c.folder_names().unwrap(); println!("nur Ordnernamen: {:?}", t.elapsed());
    let l = c.list_messages("INBOX", 300).unwrap();
    let t = Instant::now(); c.delete_many("INBOX", &[l[0].uid]).unwrap(); println!("löschen: {:?}", t.elapsed());
    let trash = c.list_messages("Trash", 300).unwrap();
    println!("im Papierkorb: {}", trash.iter().any(|m| m.subject == l[0].subject));
    println!("noch im Posteingang: {}", c.list_messages("INBOX", 300).unwrap().iter().any(|m| m.uid == l[0].uid));
}
