import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import admin from 'firebase-admin';

// --- CONFIGURATION ---
const TARGET_URL = 'https://jinjae1029-gif.github.io/stock-bot-3/';
const TARGET_BOT_ID = 'stock-bot-3';
const TG_TOKEN = process.env.TG_TOKEN;
const FIREBASE_CREDENTIALS = process.env.FIREBASE_CREDENTIALS;

let db = null;

if (FIREBASE_CREDENTIALS) {
    try {
        const serviceAccount = JSON.parse(FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
    } catch (e) {
        console.error("Firebase Init Error:", e.message);
    }
}

async function getChatIdAndUid() {
    if (!db) return null;
    try {
        // 1. Try finding by ID directly
        let doc = await db.collection('users').doc(TARGET_BOT_ID).get();
        if (doc.exists && doc.data().telegramChatId) {
            return { uid: TARGET_BOT_ID, chatId: doc.data().telegramChatId };
        }

        // 2. Iterate all users to find one with a Chat ID
        const snapshot = await db.collection('users').get();
        let found = null;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.telegramChatId) {
                if (!found) found = { uid: doc.id, chatId: data.telegramChatId };
            }
        });
        return found;

    } catch (e) {
        console.error("Error fetching user:", e);
    }
    return null;
}

async function sendTelegram(chatId, text) {
    if (!TG_TOKEN || !chatId) {
        console.log("⚠️ Missing Token or Chat ID");
        return;
    }
    const bot = new TelegramBot(TG_TOKEN);
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        console.log(`Sent to ${chatId}`);
    } catch (e) {
        console.error("TG Error:", e.message);
    }
}

(async () => {
    console.log("🚀 Starting Scraper Bot (Bot 3)...");

    // 1. Get Chat ID & UID
    const userInfo = await getChatIdAndUid();
    if (!userInfo) {
        console.error("❌ Could not find ANY User with Chat ID.");
        process.exit(1);
    }
    const { chatId, uid } = userInfo;
    console.log(`Target User: ${uid} (Chat: ${chatId})`);

    // 2. Launch Browser
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // 3. Go to Page
        console.log(`Navigating to ${TARGET_URL}...`);
        await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // 4. Set LocalStorage (Simulate User)
        await page.evaluate((u) => {
            localStorage.setItem('firebaseUserId', u);
        }, uid);

        // 5. Reload to apply ID and Load Data
        console.log("Reloading with User ID...");
        await page.reload({ waitUntil: 'networkidle0' });

        // 6. Wait for simulation
        console.log("Waiting for simulation...");
        // CHANGED: totalAsset -> kpiFinal (Correct ID), added timeout 60s
        await page.waitForFunction(() => window.lastFinalState && document.getElementById('kpiFinal'), { timeout: 60000 });

        // 7. Ensure "Trading Sheet" Mode (Toggle ON)
        const toggle = await page.$('#toggleMode');
        if (toggle) {
            const isChecked = await (await toggle.getProperty('checked')).jsonValue();
            if (!isChecked) {
                console.log("Switching to Trading Sheet Mode...");
                await toggle.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // 8. Open Order Sheet Modal
        console.log("Opening Order Sheet...");
        await page.click('#btnOrderSheet');
        await page.waitForSelector('#orderSheetModal', { visible: true, timeout: 5000 });

        // 9. Scrape Content
        const rawText = await page.$eval('#orderSheetModal .modal-content', el => el.innerText);

        // 10. Get Extra Data from Global State (Window)
        const extraData = await page.evaluate(() => {
            if (!window.lastFinalState) return null;
            const s = window.lastFinalState;

            // Calc Total Holdings
            const totalQty = s.holdings.reduce((sum, h) => sum + h.quantity, 0);

            // Calc Seed (Current + Pending)
            const seed = s.currentSeed + (s.pendingRebalance || 0);

            // Total Asset
            const elAsset = document.getElementById('previewTotalAsset');
            const assetTxt = elAsset ? elAsset.innerText : "$0";

            return {
                qty: totalQty,
                seed: Math.floor(seed),
                asset: assetTxt
            };
        });

        let cleanText = rawText
            .replace('주문표 (Order Sheet)', '📅 <b>주문표 (Bot 3 Scraped)</b>')
            .replace('닫기', '')
            .replace('텍스트 복사', '')
            .trim();

        if (extraData) {
            cleanText += `\n\n📊 <b>Asset Info</b>\n`;
            cleanText += `주식 보유량: ${extraData.qty}주\n`;
            cleanText += `이번 사이클 시드: $${extraData.seed.toLocaleString()}\n`;
            cleanText += `총자산 (전일종가): ${extraData.asset}`;
        }

        console.log("--- SCRAPED TEXT ---");
        console.log(cleanText);
        console.log("--------------------");

        // 11. Send
        await sendTelegram(chatId, cleanText);

    } catch (e) {
        console.error("Scraping Error:", e);
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
