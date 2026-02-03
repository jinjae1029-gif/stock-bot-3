import fs from 'fs';
import path from 'path';
import { SOXL_DATA, QQQ_DATA } from './js/data.js';
import { runSimulation, generateOrderSheetData, calculateNettingOrders } from './js/logic.js';
import admin from 'firebase-admin';

// --- CONFIGURATION ---
// Firebase Credentials from Env (GitHub Secret)
const FIREBASE_CREDENTIALS = process.env.FIREBASE_CREDENTIALS;
const TG_TOKEN = process.env.TG_TOKEN;

// Initialize Firebase Admin
let db = null;
if (FIREBASE_CREDENTIALS) {
    try {
        const serviceAccount = JSON.parse(FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("✅ Firebase Admin Initialized.");
    } catch (e) {
        console.error("❌ Firebase Init Error:", e.message);
    }
} else {
    console.warn("⚠️ No FIREBASE_CREDENTIALS found. Functionality limited to local files.");
}

// Telegram Helper
async function sendTelegram(chatId, text) {
    if (!TG_TOKEN) {
        console.log("⚠️ No TG_TOKEN. Msg:", text.substring(0, 50) + "...");
        return;
    }
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
        });
        if (!resp.ok) console.error("TG Error:", await resp.text());
    } catch (e) {
        console.error("TG Network Error:", e.message);
    }
}

// Helper: Start Date Fallback
function getStartDate(userConfig) {
    return userConfig.startDate || "2023-01-01";
}

async function main() {
    console.log("🚀 Daily Bot Starting...");

    let users = [];
    const usersDir = './users';

    // 1. Fetch from Firestore (Primary)
    if (db) {
        try {
            // Filter by BOT_USER_ID if present (Env Var from GitHub Actions)
            const targetBotId = process.env.BOT_USER_ID;

            const snapshot = await db.collection('users').get();
            if (snapshot.empty) {
                console.log("No users found in Firestore.");
            } else {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const userId = doc.id;

                    // If targetBotId is set, ONLY process that user.
                    if (targetBotId && userId !== targetBotId) {
                        return;
                    }

                    // MERGE LOGIC: Try to find local JSON file for this user to get telegramChatId
                    let fileData = {};
                    try {
                        const filePath = path.join(usersDir, userId + '.json');
                        if (fs.existsSync(filePath)) {
                            fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        }
                    } catch (err) { console.warn("Local file read warn:", err.message); }

                    // Merge: Cloud Data takes precedence for params, but File Data provides fallback for IDs
                    users.push({
                        id: userId,
                        source: 'firebase',
                        ...fileData,  // 1. Base from file (contains telegramChatId)
                        ...data       // 2. Override with Cloud (contains latest params/seed)
                    });
                });
                console.log(`✅ Loaded ${users.length} user(s) from Firestore. (Target: ${targetBotId || "ALL"})`);
            }
        } catch (e) {
            console.error("❌ Firestore Fetch Error:", e.message);
        }
    }

    // 2. Fetch from Files (Fallback / Local Dev)
    if (users.length === 0 && fs.existsSync(usersDir)) {
        try {
            const files = fs.readdirSync(usersDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(usersDir, file), 'utf8');
                const data = JSON.parse(content);
                // Exclude if no chat ID (unless testing)
                if (data.telegramChatId || data.tgChatId) {
                    users.push({
                        id: file.replace('.json', ''),
                        source: 'file',
                        ...data
                    });
                }
            }
            console.log(`📂 Loaded ${users.length} users from Files.`);
        } catch (e) {
            console.error("File Load Error:", e.message);
        }
    }

    if (users.length === 0) {
        console.log("No users to process. Exiting.");
        return;
    }

    // 3. Process Loops
    for (const user of users) {
        console.log(`Processing User: ${user.id} (${user.source})...`);

        // Map Data Schema (DB vs File)
        let params = {};

        if (user.source === 'firebase') {
            params = {
                initialCapital: parseFloat(user.userSeed || user.initialCapital || 10000),
                startDate: getStartDate(user),
                endDate: new Date().toISOString().split('T')[0],
                safe: user.safe || user.params?.safe || {},
                offensive: user.offensive || user.params?.offensive || {},
                rebalance: user.rebalance || user.params?.rebalance || {},
                feeRate: 0,
                useRealTier: user.useRealTier || false
            };
        } else {
            params = {
                initialCapital: parseFloat(user.initialCapital || 10000),
                startDate: user.startDate || "2023-01-01",
                endDate: new Date().toISOString().split('T')[0],
                safe: user.params?.safe || {},
                offensive: user.params?.offensive || {},
                rebalance: user.params?.rebalance || {},
                feeRate: user.params?.feeRate || 0,
                useRealTier: user.params?.useRealTier || false
            };
        }

        const chatId = user.tgChatId || user.telegramChatId;

        if (!chatId) {
            console.log(`Skipping ${user.id}: No Telegram Chat ID found.`);
            continue;
        }

        const injections = user.injections || user.history?.injections || [];

        try {
            const result = runSimulation(SOXL_DATA, QQQ_DATA, params, injections);

            if (!result || !result.finalState) {
                console.log("  -> No result (Holiday?)");
                continue;
            }

            // Generate Reports matches logic.js
            const orderData = generateOrderSheetData(result.finalState, params);
            const nettingOrders = calculateNettingOrders(orderData);

            // Construct Message
            const dateStr = orderData.lastDate; // Prediction Date
            const mode = orderData.mode;
            const modeIcon = mode === "Safe" ? "🛡️" : "⚔️";
            const modeKo = mode === "Safe" ? "안전 모드" : (mode === "Offensive" ? "공세 모드" : mode);

            let msg = `📅 <b>${dateStr} 주문표</b>\n`;
            msg += `${modeIcon} <b>${modeKo}</b>\n`;
            msg += `══════════════════\n\n`;

            if (nettingOrders.length === 0) {
                msg += "💤 <b>주문 없음 (No Orders)</b>\n";
                msg += "모니터링 중입니다.\n";
            } else {
                nettingOrders.forEach(o => {
                    const isBuy = o.type.includes('buy');
                    const icon = isBuy ? "🔴" : "🔵";
                    msg += `${icon} <b>${o.text}</b>\n`;
                    msg += `──────────────────\n`;
                });
            }

            // Asset Summary with User Requested Fields
            const finalBal = Math.floor(result.finalBalance).toLocaleString();
            const currentTier = result.finalState.holdings ? result.finalState.holdings.length : 0;
            const seedDisp = Math.floor(result.finalState.currentSeed).toLocaleString();

            // Calculate Total Qty
            let totalQty = 0;
            if (result.finalState.holdings) {
                totalQty = result.finalState.holdings.reduce((acc, h) => acc + h.qty, 0);
            }

            msg += `\n💰 <b>자산 요약</b>\n`;
            msg += `현재 주식 보유량: ${totalQty}주 (${currentTier}T)\n`;
            msg += `이번 사이클 시드: $${seedDisp}\n`;
            msg += `총자산 (전일종가): $${finalBal}\n`;

            await sendTelegram(chatId, msg);
            console.log(`  -> Sent to ${chatId}`);

        } catch (simError) {
            console.error("  -> Simulation Error:", simError);
        }
    }
}

main();
