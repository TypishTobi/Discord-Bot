# Discord-Rollen auf GitHub Pages

Diese Website zeigt alle Mitglieder eines Discord-Servers, die bestimmte Rollen haben. Ein eigener Server ist nicht nötig. GitHub Actions fragt alle 15 Minuten die Discord-API ab und veröffentlicht die Liste als `members.json` zusammen mit der Seite auf GitHub Pages. Neu veröffentlicht wird nur, wenn sich etwas geändert hat. Die Namen landen dabei nie in der Git-Historie.

## Einrichtung

### 1. Discord-Bot

1. Öffne das [Developer Portal](https://discord.com/developers/applications) und klicke auf **New Application**.
2. Unter **Bot** auf **Reset Token** klicken und den Token kopieren.
3. Ebenfalls unter **Bot** den **Server Members Intent** einschalten.
4. Unter **OAuth2 → URL Generator** den Scope `bot` ankreuzen und mit dem erzeugten Link den Bot auf deinen Server einladen.

Der Bot muss nie online sein. Er wird nur gebraucht, damit die API Zugriff auf deinen Server bekommt.

### 2. IDs kopieren

Schalte in Discord unter **Einstellungen → Erweitert** den **Entwicklermodus** ein. Danach:
- Rechtsklick auf den Server → **Server-ID kopieren**
- Servereinstellungen → Rollen → Rechtsklick auf eine Rolle → **Rollen-ID kopieren**

### 3. GitHub-Repo

Im Repo unter **Settings → Secrets and variables → Actions** anlegen:

| Tab | Name | Wert |
|---|---|---|
| Secrets | `DISCORD_TOKEN` | Bot-Token |
| Variables | `GUILD_ID` | Server-ID |
| Variables | `ROLE_IDS` | Rollen-IDs, mehrere durch Komma getrennt |

Unter **Settings → Pages** bei **Source** die Option **GitHub Actions** wählen.

Zum Schluss unter **Actions → Mitgliederliste aktualisieren** auf **Run workflow** klicken. Nach etwa einer Minute ist die Seite unter `https://<dein-name>.github.io/<repo>/` erreichbar.

## Minecraft-Namen abfragen

Ein Button im Regel-Kanal öffnet ein Eingabefenster für den Minecraft-Namen. Hinter dem Button steckt ein Cloudflare Worker, siehe `worker/worker.js`. Er prüft den Namen über die Mojang-API und schreibt ihn in einen versteckten Kanal. Das Abrufskript liest diesen Kanal aus. Auf der Website erscheint dann `@Minecraftname` unter dem Discord-Namen. Wer noch keinen Namen eingetragen hat, bekommt dort keine Zeile.

Einrichtung:

1. **Versteckten Kanal anlegen**, z. B. `#mc-namen`. Nur der Bot darf ihn sehen. Er braucht dort die Rechte „Kanal ansehen“, „Nachrichten senden“ und „Nachrichtenverlauf lesen“. Die Kanal-ID als Repo-Variable `MC_CHANNEL_ID` eintragen.
2. **Cloudflare Worker erstellen:**
   1. Im Cloudflare-Dashboard unter Workers & Pages → Create → Worker einen Worker erstellen.
   2. Den Inhalt von `worker/worker.js` einfügen und auf Deploy klicken.
   3. Unter Settings → Variables and Secrets drei Einträge anlegen:
      - `DISCORD_PUBLIC_KEY` (Text): den Public Key aus dem Developer Portal, General Information
      - `DISCORD_TOKEN` (**Secret**): den Bot-Token
      - `MC_CHANNEL_ID` (Text): die ID des versteckten Kanals
3. **Developer Portal → General Information → Interactions Endpoint URL:** die Worker-Adresse eintragen, z. B. `https://mc-namen.<konto>.workers.dev`, und speichern. Discord prüft die Adresse dabei sofort.
4. **Button posten:** Unter Actions → „Minecraft-Button posten“ → Run workflow die ID des Regel-Kanals eingeben. Der Bot braucht dort „Nachrichten senden“.

Ändert jemand seinen Namen, gilt immer die neueste Eintragung. Nachrichten anderer Absender im Kanal werden ignoriert.

## Anpassen

- **Aussehen:** `site/index.html` bearbeiten. Das Format der Daten steht in `scripts/fetch_members.py`.
- **Intervall:** Die `cron`-Zeile in `.github/workflows/update-members.yml` ändern. Bei privaten Repos `*/30 * * * *` verwenden, sonst reichen die 2.000 kostenlosen Minuten im Monat nicht.
- **Eigene Website:** Liegt deine Website woanders, kann sie `https://<dein-name>.github.io/<repo>/members.json` direkt abrufen.

## Hinweise

- GitHub startet geplante Läufe oft 5 bis 30 Minuten zu spät.
- Nach 60 Tagen ohne Aktivität im Repo deaktiviert GitHub geplante Workflows. Der Workflow macht deshalb nach 50 ruhigen Tagen einen leeren Keepalive-Commit.
