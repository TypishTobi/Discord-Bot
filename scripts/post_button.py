"""Postet die Nachricht mit dem "Minecraft-Name eintragen"-Button in einen Kanal.

Aufruf:  python3 scripts/post_button.py <kanal-id>
Umgebungsvariable: DISCORD_TOKEN
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"

MESSAGE = {
    "embeds": [{
        "title": "🎮 Minecraft-Name eintragen",
        "description": (
            "Hast du die Regeln gelesen und akzeptiert? Dann trag hier deinen "
            "**Minecraft-Namen (Java Edition)** ein. Er wird auf der Teilnehmerliste "
            "auf unserer Website angezeigt.\n\n"
            "Du kannst ihn jederzeit ändern, indem du erneut auf den Button klickst."
        ),
        "color": 0x9B59B6,
    }],
    "components": [{
        "type": 1,
        "components": [{
            "type": 2,
            "style": 3,  # grün
            "label": "Regeln akzeptieren & Namen eintragen",
            "emoji": {"name": "✅"},
            "custom_id": "mc_register",
        }],
    }],
}


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip().isdigit():
        sys.exit(__doc__)
    channel_id = sys.argv[1].strip()
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        sys.exit("DISCORD_TOKEN fehlt.")

    req = urllib.request.Request(
        f"{API}/channels/{channel_id}/messages",
        data=json.dumps(MESSAGE).encode(),
        method="POST",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            print("Button gepostet, Nachricht-ID:", json.load(res)["id"])
    except urllib.error.HTTPError as err:
        hint = {403: "Der Bot braucht in diesem Kanal 'Kanal ansehen' und 'Nachrichten senden'.",
                404: "Kanal nicht gefunden: ID prüfen."}.get(err.code, err.read().decode(errors="replace"))
        sys.exit(f"Discord-API {err.code}: {hint}")


if __name__ == "__main__":
    main()
