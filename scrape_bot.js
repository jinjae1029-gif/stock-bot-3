import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';

// --- CONFIGURATION ---
const TARGET_URL = 'https://jinjae1029-gif.github.io/stock-bot-3/'; // Bot 3 URL
const BOT_ID = 'stock-bot-3';
const TG_TOKEN = process.env.TG_TOKEN;
// We need to fetch the Chat ID. 
// Since we can't easily access Firestore from here without credentials (which we have),
// we can also just fetch it from the same Firestore logic or hardcode it if it's single user.
// But we should stick to the pattern: Fetch User from Firestore -> Get Chat ID -> Send.
// HOWEVER, we are scraping for specific BOT_ID.
// So we can use the FIREBASE_CREDENTIALS to get the Chat ID, OR just scrape the Chat ID from the website if it was visible? No.

// Let's reuse the Firestore logic just to get the Chat ID.
import admin from 'firebase-admin';

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

async function getChatId(userId) {
    if (!db) return null;
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
            const data = doc.data();
            return data.telegramChatId || data.tgChatId;
        }
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
        // We send as HTML or Markdown? The scraped text is plain text.
        // Let's send as plain text to preserve formatting, or wrap in <pre>.
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        console.log(`Sent to ${chatId}`);
    } catch (e) {
        console.error("TG Error:", e.message);
    }
}

(async () => {
    console.log("🚀 Starting Scraper Bot...");

    // 1. Get Chat ID
    const chatId = await getChatId(BOT_ID);
    if (!chatId) {
        console.error("❌ Could not find Chat ID for", BOT_ID);
        process.exit(1);
    }
    console.log(`Target: ${BOT_ID} (Chat: ${chatId})`);

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
        await page.evaluate((uid) => {
            localStorage.setItem('firebaseUserId', uid);
        }, BOT_ID);

        // 5. Reload to apply ID and Load Data
        console.log("Reloading with User ID...");
        await page.reload({ waitUntil: 'networkidle0' });

        // 6. Wait for "Total Asset" to confirm logic ran
        console.log("Waiting for simulation...");
        await page.waitForFunction(() => {
            const el = document.getElementById('totalAsset');
            // Check if it has a value (e.g. "$12,345" or similar, just not empty/zero default if applicable)
            return el && el.innerText.includes('$');
        }, { timeout: 30000 });

        // 7. Ensure "Trading Sheet" Mode (Toggle ON)
        const toggle = await page.$('#toggleMode');
        if (toggle) {
            const isChecked = await (await toggle.getProperty('checked')).jsonValue();
            if (!isChecked) {
                console.log("Switching to Trading Sheet Mode...");
                await toggle.click();
                await new Promise(r => setTimeout(r, 2000)); // Wait for UI update
            }
        }

        // 8. Open Order Sheet Modal
        console.log("Opening Order Sheet...");
        await page.click('#btnOrderSheet');

        // Wait for modal visibility
        await page.waitForSelector('#orderSheetModal', { visible: true, timeout: 5000 });

        // 9. Scrape Content
        // We want the clean text. 
        // The modal might contain buttons "Close", "Copy". We should exclude them if possible.
        // Or just grab the text and clean it up.

        const rawText = await page.$eval('#orderSheetModal .modal-content', el => el.innerText);

        // Clean up text
        // Remove "닫기", "복사", "Order Sheet" title if redundant
        // The modal usually has: "Title" then "Content" then "Buttons"
        // Let's assume raw text is fine for now, looking at index.html structure might help refine.

        // Format for Telegram
        // Wrap in <pre> for monospaced look? Or just send as is.
        // User likes the formatted look.
        // The raw text will be lines.

        const cleanText = rawText
            .replace('주문표 (Order Sheet)', '📅 <b>주문표 (Web Scraped)</b>') // Replace Title
            .replace('닫기', '')
            .replace('텍스트 복사', '')
            .trim();

        console.log("--- SCRAPED TEXT ---");
        console.log(cleanText);
        console.log("--------------------");

        // 10. Send
        await sendTelegram(chatId, cleanText);

    } catch (e) {
        console.error("Scraping Error:", e);
        // Fallback: Send error notification?
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
