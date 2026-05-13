const axios    = require("axios");
const archiver = require("archiver");
const fs       = require("fs");
const path     = require("path");
const FormData = require("form-data");

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const SUPABASE_URL    = "https://iglzwveqavsctertbqzp.supabase.co";
const SUPABASE_KEY    = "sb_publishable_j05ISrybUexE6wnko6hUAg_EXuxLqZz";
const BACKUP_DIR      = "./backups";

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function fetchAllPlayers() {
    const allRows = [];
    let from = 0;
    const PAGE = 1000;

    while (true) {
        const res = await axios.get(`${SUPABASE_URL}/rest/v1/player_data?select=*&order=updated_at.desc`, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                Range: `${from}-${from + PAGE - 1}`,
            },
        });

        allRows.push(...res.data);
        if (res.data.length < PAGE) break;
        from += PAGE;
    }

    return allRows;
}

function buildStats(players) {
    if (!players.length) return { total_players: 0 };
    const totalCash  = players.reduce((s, p) => s + (p.cash || 0), 0);
    const avgLevel   = (players.reduce((s, p) => s + (p.level || 0), 0) / players.length).toFixed(1);
    const maxLevel   = Math.max(...players.map(p => p.level || 0));
    const richest    = players.reduce((a, b) => (a.cash > b.cash ? a : b));
    const totalJailed = players.filter(p => p.jail > 0).length;
    const totalCars  = players.reduce((s, p) => s + (p.purchased_cars?.length || 0), 0);

    return { total_players: players.length, total_cash: totalCash, avg_level: avgLevel, max_level: maxLevel, richest_player: { name: richest.username, cash: richest.cash }, total_jailed: totalJailed, total_cars: totalCars };
}

async function createZip(players, timestamp) {
    const stats   = buildStats(players);
    const zipName = `backup_${timestamp}.zip`;
    const zipPath = path.join(BACKUP_DIR, zipName);

    return new Promise((resolve, reject) => {
        const output  = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", () => resolve({ zipPath, zipName, size: archive.pointer(), stats }));
        archive.on("error", reject);
        archive.pipe(output);

        archive.append(JSON.stringify(players, null, 2), { name: `players_full_${timestamp}.json` });
        archive.append(JSON.stringify(stats, null, 2),   { name: "stats_summary.json" });

        const top100 = [...players].sort((a, b) => (b.cash || 0) - (a.cash || 0)).slice(0, 100);
        archive.append(JSON.stringify(top100, null, 2),  { name: "top100_richest.json" });

        archive.finalize();
    });
}

async function sendToDiscord(zipPath, zipName, stats) {
    const embed = {
        title : "🗄️  Backup Tự Động — 3 Ngày/Lần",
        color : 0x57f287,
        fields: [
            { name: "👥 Tổng Players",   value: `**${stats.total_players}**`,                                           inline: true },
            { name: "💰 Tổng Cash",      value: `**${stats.total_cash?.toLocaleString()}**`,                            inline: true },
            { name: "⭐ Level TB / Max", value: `**${stats.avg_level}** / **${stats.max_level}**`,                      inline: true },
            { name: "🏆 Giàu nhất",      value: `**${stats.richest_player?.name}** — ${stats.richest_player?.cash?.toLocaleString()} cash`, inline: false },
            { name: "🚗 Tổng xe",        value: `**${stats.total_cars}**`,                                              inline: true },
            { name: "⛓️  Đang tù",       value: `**${stats.total_jailed}**`,                                            inline: true },
            { name: "📦 File",           value: `\`${zipName}\``,                                                       inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer   : { text: "Backup System v2.0 — GitHub Actions + Supabase" },
    };

    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: "📥 **Backup định kỳ** đã sẵn sàng!", embeds: [embed] }));
    form.append("file", fs.createReadStream(zipPath), { filename: zipName, contentType: "application/zip" });

    await axios.post(DISCORD_WEBHOOK, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
}

async function main() {
    console.log("Bắt đầu backup:", new Date().toISOString());

    const players   = await fetchAllPlayers();
    console.log(`Lấy được ${players.length} players`);

    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
    const { zipPath, zipName, stats } = await createZip(players, timestamp);
    console.log(`ZIP: ${zipName}`);

    await sendToDiscord(zipPath, zipName, stats);
    console.log("Gửi Discord xong!");
}

main().catch(err => {
    console.error("Lỗi:", err.message);
    process.exit(1);
});
