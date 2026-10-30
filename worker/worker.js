// Cloudflare Worker: Discord-Interaktionen für die Minecraft-Namens-Abfrage.
//
// Ablauf: Klick auf den Button "mc_register" -> Eingabefenster -> Name wird bei
// Mojang geprüft und als Nachricht "mc:<discordId>:<name>:<uuid>" in den
// versteckten Kanal MC_CHANNEL_ID geschrieben. Das Abrufskript auf GitHub liest
// diesen Kanal; die neueste Nachricht pro Nutzer gilt.
//
// Benötigte Einstellungen im Worker (Settings -> Variables and Secrets):
//   DISCORD_PUBLIC_KEY  Public Key der App (Developer Portal -> General Information)
//   DISCORD_TOKEN       Bot-Token (als Secret!)
//   MC_CHANNEL_ID       ID des versteckten Kanals für die Namen

const API = "https://discord.com/api/v10";
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

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
      return json({
        type: 9,
        data: {
          custom_id: "mc_modal",
          title: "Minecraft-Name",
          components: [{
            type: 1,
            components: [{
              type: 4,
              custom_id: "mc_name",
              label: "Dein Minecraft-Name (Java Edition)",
              style: 1,
              min_length: 3,
              max_length: 16,
              required: true,
              placeholder: "z. B. Notch",
            }],
          }],
        },
      });
    }

    // Fenster abgeschickt -> sofort "denkt nach" antworten, Rest im Hintergrund
    // (Discord verlangt eine Antwort innerhalb von 3 Sekunden)
    if (interaction.type === 5 && interaction.data.custom_id === "mc_modal") {
      ctx.waitUntil(handleSubmit(interaction, env));
      return json({ type: 5, data: { flags: 64 } }); // 64 = nur für den Nutzer sichtbar
    }

    return json({ type: 4, data: { content: "Unbekannte Aktion.", flags: 64 } });
  },
};

async function handleSubmit(interaction, env) {
  const userId = (interaction.member?.user ?? interaction.user).id;
  const input = interaction.data.components[0].components[0].value.trim();

  let reply;
  try {
    if (!NAME_RE.test(input)) {
      reply = "❌ Ungültiger Name. Erlaubt sind 3–16 Zeichen: Buchstaben, Zahlen und `_`.";
    } else {
      const profile = await lookupProfile(input);
      if (!profile) {
        reply = `❌ Den Minecraft-Account **${input}** gibt es nicht. Bitte prüfe die Schreibweise.`;
      } else {
        await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages`, "POST", {
          content: `mc:${userId}:${profile.name}:${profile.id}`,
          allowed_mentions: { parse: [] },
        });
        reply = `✅ Gespeichert! Dein Minecraft-Name ist **${profile.name}**. ` +
          "Auf der Website erscheint er beim nächsten Update (bis zu 15 Minuten). " +
          "Zum Ändern einfach erneut auf den Button klicken.";
      }
    }
  } catch (err) {
    console.error(err);
    reply = "⚠️ Das hat gerade nicht geklappt. Bitte versuche es in ein paar Minuten erneut.\n" +
      `-# Fehler: ${String(err.message).slice(0, 150)}`;
  }

  // Die "denkt nach"-Antwort durch das Ergebnis ersetzen
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: reply }),
  });
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
    body: JSON.stringify(payload),
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

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function json(data) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
