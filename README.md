# Nemeton Mail

Ein eigenes, schlankes E-Mail-Programm für macOS und Windows.

## Abgleich mit dem Server

Alles, was du in der App tust (löschen, verschieben, gelesen markieren, Ordner ändern), passiert sofort auf dem Server – genau wie auf dem Handy.
Die App gleicht sich jede Minute mit dem Server ab und sofort, wenn du ins Fenster zurückkommst. (Den früheren Testmodus gibt es seit Version 0.6 nicht mehr.)

## Was es schon kann (Version 0.7)

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
- Mails werden geschützt angezeigt: Skripte laufen nie; Bilder aus dem Netz sind gesperrt, bis man auf „Externe Inhalte anzeigen“ klickt
- Links öffnen im normalen Browser (nur Webseiten und E-Mail-Adressen); beim Drüberfahren steht unten, wohin der Link führt
- **Mails schreiben** rechts im Lesebereich: Neue Nachricht, Antworten, Allen antworten, Weiterleiten (auch per Rechtsklick in der Liste)
- Beim Antworten wird die Mail automatisch zitiert; beim Weiterleiten gehen die Anhänge mit (einzeln abwählbar)
- Adressen in **An**, **Kopie** und **Blindkopie** als Kästchen: mit der Maus zwischen den Feldern verschieben, Doppelklick zum Ändern, × zum Entfernen
- **Deine Schrift** (Verdana, Arial, Tahoma, Trebuchet MS, Georgia oder Times New Roman – alle auf Mac, Windows und iPhone vorhanden) wird fest in die Mail geschrieben. Eingefügter Text verliert fremde Schriften. Wenn dich jemand zitiert, wird dein Text beim Lesen wieder in deiner Schrift gezeigt
- Anhänge per Knopf oder per Ziehen auf den Schreibbereich
- Empfangene Anhänge stehen gut sichtbar über der Mail: Klick öffnet sie mit dem passenden Programm, „Sichern“ fragt, wohin die Datei gespeichert werden soll. Dateien, die Programme starten könnten (z.B. .exe), werden nicht geöffnet, sondern nur im Ordner gezeigt. Mails mit Anhang tragen in der Liste eine 📎
- Einstellungen (⚙ oben): Mails öffnen sich rechts neben der Liste, über die ganze Fläche oder unten unter der Liste – für jedes Gerät einzeln
- **Signatur** (⚙ Einstellungen): eine für alle Adressen oder je Absenderadresse eine eigene; steht automatisch unter neuen Mails und Antworten
- **Werbung aussortieren** (⚙ Einstellungen): Newsletter und Werbung wandern aus dem Posteingang in den Ordner „Werbung“. Per Rechtsklick: „Absender ist Werbung“, „Alles von @firma ist Werbung“, „Absender nie aussortieren“. Absender, denen man geschrieben hat, bleiben immer im Posteingang
- **Kategorien** (Testversion): Absender bekommen Kategorien wie Versand, Rechnungen, Job, Elternschaft (eigene anlegbar). Zuordnen per Rechtsklick → „Kategorie“ (Absender oder ganze Firma @domain) oder durch Ziehen einer Mail auf die Kategorie. Alle Mails dieser Absender, auch künftige, tragen dann das farbige Schild. Der Knopf „Kategorien ▾“ neben „Abrufen“ filtert nach Kategorie; dort lassen sich auch neue Kategorien anlegen. In der breiten Liste steht die Kategorie in einer eigenen Spalte hinter dem Datum. Nichts davon ändert etwas auf dem Server
- **Mehrere Mails markieren:** Shift + Pfeiltaste, Shift + Klick (Bereich), Cmd/Strg + Klick (einzeln dazu), Cmd/Strg + A (alle). Markierte Mails gemeinsam löschen, verschieben (auch per Ziehen), als gelesen markieren oder einer Kategorie zuordnen
- **Rechtsklick auf Ordner:** Alle als gelesen markieren, Neuer (Unter-)Ordner, Umbenennen, Ordner löschen (die Mails darin kommen vorher in den Papierkorb)
- Suche zeigt beim Tippen sofort Treffer aus Absender und Betreff, die Suche im Mailtext auf dem Server folgt
- **Nur ungelesene** (Knopf neben „Kategorien ▾“): zeigt nur ungelesene Mails, für jeden Ordner einzeln gemerkt. Was man gerade liest, bleibt sichtbar, bis man den Ordner wechselt
- Die Ordner-Spalte erscheint nur bei der Suche in allen Ordnern
- Fenstergröße, Position und Bildschirm werden gemerkt
- Nach einem Klick in die geöffnete Mail funktionieren Entf, Pfeiltasten und Rücktaste sofort; markierter Text lässt sich mit Cmd/Strg + C kopieren, Bild-auf/ab blättert in der Mail
- Weitere Absenderadressen (Posteo-Aliasse) im Feld „Von“; beim Antworten wird automatisch die Adresse gewählt, an die die Mail ging
- Gesendete Mails landen im Ordner „Gesendet“, beantwortete werden als beantwortet markiert

## Geplant

Entwürfe speichern · Kalender (evtl. als eigene App) mit dem Synology-NAS (CalDAV) · Filterregeln · überall dieselbe Schrift

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
