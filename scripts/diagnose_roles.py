"""Diagnose: Welche Rollen hat das Team, wo steht die Mod-Rolle, gibt es Befehls-Einschränkungen?

Aufruf:  python3 scripts/diagnose_roles.py <min-role-id>
Umgebungsvariablen: DISCORD_TOKEN, GUILD_ID
Gibt nur Rollennamen, Positionen und Nicknames mit Rang ("Dev | …") aus – keine IDs von Personen.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"
ADMINISTRATOR = 1 << 3


def get(path, token):
    req = urllib.request.Request(API + path, headers={
        "Authorization": f"Bot {token}",
        "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        return {"_error": err.code, "_body": err.read().decode(errors="replace")[:200]}


def main():
    token, guild_id = os.environ["DISCORD_TOKEN"], os.environ["GUILD_ID"]
    min_role = sys.argv[1] if len(sys.argv) > 1 else ""
    roles = {r["id"]: r for r in get(f"/guilds/{guild_id}/roles", token)}
    min_pos = roles[min_role]["position"] if min_role in roles else None
    print(f"Mod-Rolle (MIN_ROLE_ID): {roles[min_role]['name'] if min_role in roles else 'NICHT GEFUNDEN'} · Position {min_pos}")

    print("\nRollen ab Mod aufwärts (diese dürfen /login):")
    for r in sorted(roles.values(), key=lambda r: -r["position"]):
        if min_pos is not None and r["position"] >= min_pos:
            admin = " · Administrator" if int(r["permissions"]) & ADMINISTRATOR else ""
            print(f"  {r['position']:>3}  {r['name']}{admin}")

    print("\nTeam-Mitglieder (Nickname mit '|') und ob sie /login dürfen:")
    members = get(f"/guilds/{guild_id}/members?limit=1000", token)
    for m in members:
        nick = m.get("nick") or m["user"].get("global_name") or m["user"]["username"]
        if "|" not in nick:
            continue
        mine = sorted((roles[i] for i in m["roles"] if i in roles), key=lambda r: -r["position"])
        top = mine[0]["position"] if mine else 0
        admin = any(int(r["permissions"]) & ADMINISTRATOR for r in mine)
        ok = admin or (min_pos is not None and top >= min_pos)
        print(f"  {'JA  ' if ok else 'NEIN'} {nick}: " + ", ".join(f"{r['name']} ({r['position']})" for r in mine[:4]))

    app = get("/applications/@me", token)
    print("\nBefehle und Einschränkungen in Servereinstellungen → Integrationen:")
    cmds = get(f"/applications/{app['id']}/guilds/{guild_id}/commands", token)
    perms = get(f"/applications/{app['id']}/guilds/{guild_id}/commands/permissions", token)
    if isinstance(perms, dict):
        print(f"  (Einschränkungen nicht lesbar: {perms.get('_error')})")
        perms = []
    by_cmd = {p["id"]: p["permissions"] for p in perms}
    for c in cmds:
        print(f"  /{c['name']}: sichtbar für {'alle' if c.get('default_member_permissions') is None else 'Berechtigung ' + str(c.get('default_member_permissions'))}")
        for p in by_cmd.get(c["id"], []) + by_cmd.get(app["id"], []):
            target = roles.get(p["id"], {}).get("name") or ("@everyone" if p["id"] == guild_id else "Person/Kanal")
            print(f"     Einschränkung: {target} → {'erlaubt' if p['permission'] else 'VERBOTEN'}")


if __name__ == "__main__":
    main()
