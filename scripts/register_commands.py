"""Registriert die Slash-Befehle /mcname, /login und /anmeldung auf dem Server (einmalig bzw. nach Änderungen).

Aufruf:  python3 scripts/register_commands.py
Umgebungsvariablen: DISCORD_TOKEN, GUILD_ID
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"

COMMANDS = [{
    "name": "mcname",
    "description": "Minecraft-Namen von Mitgliedern verwalten (Team)",
    # Für alle sichtbar (None): wer es nutzen darf, prüft allein der Worker (MIN_ROLE_ID und
    # höher). Discord-Berechtigungen wie "Mitglieder im Timeout" spielen so keine Rolle.
    "default_member_permissions": None,
    "contexts": [0],
    "options": [
        {
            "type": 1,
            "name": "setzen",
            "description": "Minecraft-Namen eines Mitglieds setzen oder ändern",
            "options": [
                {"type": 6, "name": "nutzer", "description": "Das Mitglied", "required": True},
                {"type": 3, "name": "name", "description": "Minecraft-Name (Java Edition)",
                 "required": True, "min_length": 3, "max_length": 16},
            ],
        },
        {
            "type": 1,
            "name": "entfernen",
            "description": "Minecraft-Namen eines Mitglieds entfernen",
            "options": [
                {"type": 6, "name": "nutzer", "description": "Das Mitglied", "required": True},
            ],
        },
    ],
}, {
    "name": "login",
    "description": "Einmal-Code für den Team-Login auf der Website (Tierlist)",
    "default_member_permissions": None,
    "contexts": [0],
}, {
    # Nur im Steuer-Kanal nutzbar (prüft der Worker, ANMELDUNG_CHANNEL_ID)
    "name": "anmeldung",
    "description": "Anmeldung mit Rolle in einen anderen Kanal schicken",
    "default_member_permissions": None,
    "contexts": [0],
    "options": [
        {"type": 7, "name": "kanal", "description": "Wohin die Anmeldung geschickt wird",
         "required": True, "channel_types": [0, 5]},
        {"type": 8, "name": "rolle", "description": "Rolle, die man beim Eintragen bekommt", "required": True},
        {"type": 3, "name": "titel", "description": "Überschrift der Anmeldung",
         "required": True, "max_length": 100},
        {"type": 4, "name": "limit", "description": "Höchstens so viele Personen (leer = ohne Limit)",
         "min_value": 1, "max_value": 200},
        {"type": 3, "name": "text", "description": "Beschreibung (\\n für neue Zeile)", "max_length": 1500},
    ],
}]


def request(method, path, token, payload=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        sys.exit(f"Discord-API {err.code} bei {path}: {err.read().decode(errors='replace')}")


def main():
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    guild_id = os.environ.get("GUILD_ID", "").strip()
    if not token or not guild_id:
        sys.exit("DISCORD_TOKEN und GUILD_ID müssen gesetzt sein.")
    app_id = request("GET", "/applications/@me", token)["id"]
    result = request("PUT", f"/applications/{app_id}/guilds/{guild_id}/commands", token, COMMANDS)
    print("Registriert:", ", ".join("/" + c["name"] for c in result))


if __name__ == "__main__":
    main()
