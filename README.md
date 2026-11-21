# Nemeton Mail

Ein eigenes, schlankes E-Mail-Programm für macOS und Windows.

## Testmodus (Standard: an)

Solange der **Testmodus** an ist (gelb hinterlegt oben links), ändert die App auf dem Mailserver nichts:
Ordner werden nur zum Lesen geöffnet, Mails bleiben dort ungelesen, und Löschen oder Markieren passiert nur in der App.
Auch Mails schreiben lässt sich gefahrlos ausprobieren: Im Testmodus geht jede Mail **nur an dich selbst**
(mit „[Test]“ im Betreff und dem Hinweis, an wen sie eigentlich gegangen wäre).
Ein- und Ausschalten oben in der Programmleiste („Testmodus: Einschalten / Ausschalten“, Ausschalten mit Bestätigung).

## Was es schon kann (Version 0.2)

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
- Weitere Absenderadressen (Posteo-Aliasse) im Feld „Von“; beim Antworten wird automatisch die Adresse gewählt, an die die Mail ging
- Gesendete Mails landen im Ordner „Gesendet“, beantwortete werden als beantwortet markiert

## Geplant

Entwürfe speichern · Kalender mit dem Synology-NAS (CalDAV) · Filterregeln · überall dieselbe Schrift

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
