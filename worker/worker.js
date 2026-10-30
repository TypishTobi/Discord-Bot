// Cloudflare Worker: Discord-Interaktionen für die Minecraft-Namens-Abfrage.
//
// Ablauf: Klick auf den Button "mc_register" -> Eingabefenster -> Name wird bei
// Mojang geprüft und als Nachricht "mc:<discordId>:<name>:<uuid>" in den
// versteckten Kanal MC_CHANNEL_ID geschrieben (mit Ping des Nutzers davor).
// "mcdel:<discordId>" entfernt einen Eintrag. Das Abrufskript auf GitHub liest
// diesen Kanal; die neueste Nachricht pro Nutzer gilt. Jeder Minecraft-Account
// darf nur einem Discord-Nutzer zugeordnet sein.
//
// Team ab MIN_ROLE_ID kann per /mcname setzen|entfernen die Namen anderer ändern.
//
// Benötigte Einstellungen im Worker (Settings -> Variables and Secrets):
//   DISCORD_PUBLIC_KEY  Public Key der App (Developer Portal -> General Information)
//   DISCORD_TOKEN       Bot-Token (als Secret!)
//   MC_CHANNEL_ID       ID des versteckten Kanals für die Namen
//   CODEWORD            Codewort aus dem Regelwerk (als Secret, damit es nicht
//                       im öffentlichen Repo steht; leer = keine Abfrage)
//   MIN_ROLE_ID         Niedrigste Rolle, die /mcname benutzen darf (z. B. Mod);
//                       alle Rollen darüber dürfen es auch

const API = "https://discord.com/api/v10";
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const ENTRY_RE = /^(?:-# )?(?:mc:(\d+):(\w{3,16}):([0-9a-f]{32})|mcdel:(\d+))$/m;
const ADMINISTRATOR = 1n << 3n;
const EPHEMERAL = 64;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Discord-Minecraft-Worker läuft.");

    const body = await request.text();
    const valid = await verifySignature(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      body
    );
    if (!valid) return new Response("Ungültige Signatur", { status: 401 });

    const interaction = JSON.parse(body);

    // PING von Discord beim Speichern der Interactions Endpoint URL
    if (interaction.type === 1) return json({ type: 1 });

    // Button geklickt -> Eingabefenster öffnen
    if (interaction.type === 3 && interaction.data.custom_id === "mc_register") {
      const fields = [{
        type: 4,
        custom_id: "mc_name",
        label: "Dein Minecraft-Name (Java Edition)",
        style: 1,
        min_length: 3,
        max_length: 16,
        required: true,
        placeholder: "z. B. Notch",
      }];
      if (env.CODEWORD) {
        fields.push({
          type: 4,
          custom_id: "codeword",
          label: "Codewort aus dem Regelwerk",
          style: 1,
          max_length: 100,
          required: true,
          placeholder: "Steht irgendwo in den Regeln",
        });
      }
      return json({
        type: 9,
        data: {
          custom_id: "mc_modal",
          title: "Regeln akzeptieren",
          components: fields.map(field => ({ type: 1, components: [field] })),
        },
      });
    }

    // Fenster abgeschickt oder /mcname benutzt -> sofort "denkt nach" antworten,
    // Rest im Hintergrund (Discord verlangt eine Antwort innerhalb von 3 Sekunden)
    if (interaction.type === 5 && interaction.data.custom_id === "mc_modal") {
      ctx.waitUntil(respond(interaction, () => handleSubmit(interaction, env)));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }
    if (interaction.type === 2 && interaction.data.name === "mcname") {
      ctx.waitUntil(respond(interaction, () => handleCommand(interaction, env)));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }

    return json({ type: 4, data: { content: "Unbekannte Aktion.", flags: EPHEMERAL } });
  },
};

// Führt die Aktion aus und ersetzt die "denkt nach"-Antwort durch das Ergebnis
async function respond(interaction, action) {
  let reply;
  try {
    reply = await action();
  } catch (err) {
    console.error(err);
    reply = "⚠️ Das hat gerade nicht geklappt. Bitte versuche es in ein paar Minuten erneut.\n" +
      `-# Fehler: ${String(err.message).slice(0, 150)}`;
  }
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: reply, allowed_mentions: { parse: [] } }),
  });
}

async function handleSubmit(interaction, env) {
  const userId = (interaction.member?.user ?? interaction.user).id;
  const values = Object.fromEntries(
    interaction.data.components.flatMap(row => row.components).map(c => [c.custom_id, c.value.trim()])
  );

  if (env.CODEWORD && normalize(values.codeword) !== normalize(env.CODEWORD)) {
    return "❌ Das Codewort ist falsch. Lies dir das Regelwerk noch einmal genau durch.";
  }
  const result = await assignName(env, interaction, userId, values.mc_name, null);
  if (result.error) return result.error;
  return `✅ Gespeichert! Dein Minecraft-Name ist **${result.name}**. ` +
    "Auf der Website erscheint er beim nächsten Update (bis zu 15 Minuten). " +
    "Zum Ändern einfach erneut auf den Button klicken.";
}

async function handleCommand(interaction, env) {
  if (!(await isTeam(interaction, env))) {
    return "❌ Diesen Befehl darf nur das Team benutzen.";
  }
  const sub = interaction.data.options[0];
  const option = name => sub.options?.find(o => o.name === name)?.value;
  const targetId = option("nutzer");
  const modId = interaction.member.user.id;

  if (sub.name === "setzen") {
    const result = await assignName(env, interaction, targetId, String(option("name")).trim(), modId);
    if (result.error) return result.error;
    return `✅ Der Minecraft-Name von <@${targetId}> ist jetzt **${result.name}**.`;
  }

  if (sub.name === "entfernen") {
    const names = await loadNames(env, interaction.application_id);
    if (!names.has(targetId)) return `ℹ️ <@${targetId}> hat keinen Minecraft-Namen eingetragen.`;
    await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages`, "POST", {
      content: `<@${targetId}> → *entfernt* (von <@${modId}>)\n-# mcdel:${targetId}`,
      allowed_mentions: { users: [targetId] },
    });
    return `✅ Der Minecraft-Name von <@${targetId}> (**${names.get(targetId).name}**) wurde entfernt.`;
  }

  return "Unbekannter Unterbefehl.";
}

// Prüft den Namen, verhindert doppelte Accounts und speichert ihn.
// Gibt { name } mit korrekter Schreibweise oder { error } zurück.
async function assignName(env, interaction, userId, input, modId) {
  if (!NAME_RE.test(input ?? "")) {
    return { error: "❌ Ungültiger Name. Erlaubt sind 3–16 Zeichen: Buchstaben, Zahlen und `_`." };
  }
  const profile = await lookupProfile(input);
  if (!profile) {
    return { error: `❌ Den Minecraft-Account **${input}** gibt es nicht. Bitte prüfe die Schreibweise.` };
  }

  // Jeder Minecraft-Account nur einmal (verglichen über die UUID, nicht den Namen)
  const names = await loadNames(env, interaction.application_id);
  for (const [otherId, entry] of names) {
    if (otherId !== userId && entry.uuid === profile.id) {
      return {
        error: modId
          ? `❌ **${profile.name}** ist schon bei <@${otherId}> eingetragen. Entferne es dort zuerst mit \`/mcname entfernen\`.`
          : `❌ Der Minecraft-Name **${profile.name}** ist schon von jemand anderem eingetragen. ` +
            "Falls das deiner ist, wende dich ans Team.",
      };
    }
  }

  const byMod = modId ? ` (geändert von <@${modId}>)` : "";
  await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages`, "POST", {
    content: `<@${userId}> → **${profile.name}**${byMod}\n-# mc:${userId}:${profile.name}:${profile.id}`,
    allowed_mentions: { users: [userId] },
  });
  return { name: profile.name };
}

// Liest den Namens-Kanal: Map discordId -> { name, uuid }, neueste Nachricht pro Nutzer gilt.
// Nur Nachrichten des eigenen Bots zählen (Bot-ID = Application-ID).
async function loadNames(env, botId) {
  const latest = new Map();
  let before = null;
  while (true) {
    const query = before ? `?limit=100&before=${before}` : "?limit=100";
    const batch = await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages${query}`, "GET");
    for (const msg of batch) {
      if (msg.author.id !== botId) continue;
      const m = ENTRY_RE.exec(msg.content);
      if (!m) continue;
      const id = m[1] ?? m[4];
      if (!latest.has(id)) latest.set(id, m[1] ? { name: m[2], uuid: m[3] } : null);
    }
    if (batch.length < 100) break;
    before = batch[batch.length - 1].id;
  }
  for (const [id, entry] of latest) if (!entry) latest.delete(id);
  return latest;
}

// Team = Administrator oder mindestens eine Rolle auf Höhe von MIN_ROLE_ID oder darüber
async function isTeam(interaction, env) {
  const member = interaction.member;
  if (!member) return false;
  if ((BigInt(member.permissions ?? 0) & ADMINISTRATOR) === ADMINISTRATOR) return true;
  if (!env.MIN_ROLE_ID) return false;
  const roles = await discord(env, `/guilds/${interaction.guild_id}/roles`, "GET");
  const position = new Map(roles.map(r => [r.id, r.position]));
  const min = position.get(env.MIN_ROLE_ID);
  if (min === undefined) throw new Error("MIN_ROLE_ID ist keine Rolle dieses Servers");
  return member.roles.some(id => (position.get(id) ?? -1) >= min);
}

// Liefert { id, name } mit korrekter Schreibweise oder null, wenn es den Account nicht gibt
async function lookupProfile(name) {
  const urls = [
    `https://api.minecraftservices.com/minecraft/profile/lookup/name/${name}`,
    `https://api.mojang.com/users/profiles/minecraft/${name}`,
  ];
  const errors = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (res.status === 200) {
      const data = await res.json();
      return { id: data.id, name: data.name };
    }
    if (res.status === 404 || res.status === 204) return null;
    errors.push(`Mojang ${res.status}`); // z. B. Rate-Limit oder Cloudflare blockiert -> nächste API
  }

  // Mojang blockiert Cloudflare-Server häufig; playerdb.co fragt Mojang stellvertretend ab
  const res = await fetch(`https://playerdb.co/api/player/minecraft/${name}`, {
    headers: { "User-Agent": "discord-role-site (github.com/TypishTobi/Discord-Bot)" },
  });
  const data = await res.json().catch(() => ({}));
  if (data.success) return { id: data.data.player.raw_id, name: data.data.player.username };
  if (data.code === "minecraft.invalid_username") return null;
  errors.push(`playerdb ${res.status}`);
  throw new Error(`Namensprüfung fehlgeschlagen (${errors.join(", ")})`);
}

async function discord(env, path, method, payload) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord-API ${res.status} bei ${path}: ${await res.text()}`);
  return res.json();
}

async function verifySignature(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

// Groß-/Kleinschreibung, Leerzeichen und Anführungszeichen beim Codewort ignorieren
function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[\s"'„“”‚‘’»«]/g, "");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function json(data) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
