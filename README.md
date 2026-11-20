# Nemeton Mail

Ein eigenes, schlankes E-Mail-Programm für macOS und Windows.

## Testmodus (Standard: an)

Solange der **Testmodus** an ist (gelb hinterlegt oben links), ändert die App auf dem Mailserver nichts:
Ordner werden nur zum Lesen geöffnet, Mails bleiben dort ungelesen, und Löschen oder Markieren passiert nur in der App.
Ein- und Ausschalten oben in der Programmleiste („Testmodus: Einschalten / Ausschalten“, Ausschalten mit Bestätigung).

## Was es schon kann (Version 0.1)

- Mit dem eigenen Postfach verbinden (für Posteo voreingestellt). Das Passwort liegt im Schlüsselbund des Computers.
- Ordner mit Anzahl ungelesener Mails
- Übersicht: **ein Klick** wählt nur aus, die Mail bleibt ungelesen
- **Doppelklick** oder **Enter** öffnet die Mail rechts im selben Fenster
- **Entf** verschiebt die Mail in den Papierkorb, der Lesebereich bleibt offen und zeigt die nächste Mail
- **Rücktaste** oder **Esc** schließt den Lesebereich
- Rechtsklick auf eine Mail: Öffnen, Gelesen/Ungelesen, Verschieben in (alle Ordner), Löschen
- Mails mit der Maus auf einen Ordner ziehen, um sie zu verschieben
- Suche in **diesem Ordner** oder in **allen Ordnern**
- Hell, Dunkel oder wie das System; Schriftgröße per Regler (nur die Schrift wächst, die Aufteilung bleibt)
- Ordnerleiste und Lesebereich mit der Maus breiter oder schmaler ziehen (Doppelklick auf den Rand setzt zurück)
- Mails passen sich immer der Breite des Lesebereichs an, ohne seitliches Scrollen
- Passt sich an große Monitore und kleine Bildschirme an
- Mails werden geschützt angezeigt: keine Skripte, keine nachgeladenen Bilder aus dem Netz

## Geplant

Mails schreiben und beantworten · Kalender mit dem Synology-NAS (CalDAV) · Filterregeln · überall dieselbe Schrift

## Installieren

Bei jeder Änderung baut GitHub die App automatisch:
**Actions → „App bauen“ → neuester Lauf → unten bei „Artifacts“** die Datei für macOS (`.dmg`) oder Windows (`.exe`) herunterladen.

Die App ist (noch) nicht bei Apple bzw. Microsoft signiert:

- **macOS:** Beim ersten Öffnen mit Rechtsklick auf die App → „Öffnen“ → „Öffnen“ bestätigen.
- **Windows:** Bei der blauen SmartScreen-Meldung auf „Weitere Informationen“ → „Trotzdem ausführen“.

## Für Entwickler

```
npm install
npm run dev      # App im Entwicklungsmodus starten
npm run build    # Installationsdatei bauen
```

Aufbau: `ui/` ist die Oberfläche (HTML, CSS, JavaScript), `src-tauri/` das Programm im Hintergrund (Rust, IMAP).
