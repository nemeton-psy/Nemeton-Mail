use nemeton_mail_lib::imap_client::{Account, MailClient};
fn main() {
    let mut c = MailClient::connect(&Account { email: "test@example.org".into(), password: "geheim123".into(), host: "localhost".into(), port: 9993 }).unwrap();
    c.read_only = false;
    let names = |c: &mut MailClient| c.list_folders().unwrap().iter().map(|f| format!("{}[{}]", f.name, f.id)).collect::<Vec<_>>().join(", ");
    println!("vorher: {}", names(&mut c));
    let id = c.create_folder("", "Bücher & Co").unwrap();
    let sub = c.create_folder(&id, "Unter").unwrap();
    println!("angelegt {id} / {sub}");
    println!("löschen mit Unterordner: {:?}", c.delete_folder(&id).err());
    let inbox = c.list_messages("INBOX", 100).unwrap();
    c.move_to("INBOX", inbox[0].uid, &sub).unwrap();
    let r = c.rename_folder(&sub, "Neu ü").unwrap();
    println!("umbenannt -> {r}: {} Mails", c.list_messages(&r, 10).unwrap().len());
    let trash0 = c.list_messages("Trash", 500).unwrap().len();
    println!("gelöscht ({} Mails in Papierkorb), Papierkorb {} -> {}", c.delete_folder(&r).unwrap(), trash0, c.list_messages("Trash", 500).unwrap().len());
    c.delete_folder(&id).unwrap();
    c.mark_all_read("INBOX").unwrap();
    println!("ungelesen INBOX: {}", c.list_messages("INBOX", 100).unwrap().iter().filter(|m| !m.seen).count());
    // Verschieben in ungültigen Ordner → Fehler, Mail bleibt
    let n0 = c.list_messages("INBOX", 100).unwrap().len();
    let u = c.list_messages("INBOX", 100).unwrap()[0].uid;
    println!("falsches Ziel: {:?}, INBOX {} -> {}", c.move_to("INBOX", u, "GibtsNicht").err(), n0, c.list_messages("INBOX", 100).unwrap().len());
    println!("Drafts: {:?}", c.move_to("INBOX", u, "Drafts").err());
    println!("nachher: {}", names(&mut c));
    println!("Testmodus: {:?}", { c.read_only = true; c.create_folder("", "X").err() });
}
