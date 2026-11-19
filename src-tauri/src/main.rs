// Verhindert unter Windows ein zusätzliches Konsolenfenster.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nemeton_mail_lib::run()
}
