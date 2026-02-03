
const US_HOLIDAYS = new Set([
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
]);

function isBusinessDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Weekend
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const str = `${yyyy}-${mm}-${dd}`;
    return !US_HOLIDAYS.has(str);
}

function getNextBusinessDay(dateInput, days = 1) {
    let d = new Date(dateInput);
    if (isNaN(d.getTime())) d = new Date();

    console.log(`Input: ${dateInput}`);
    console.log(`Start Date: ${d.toISOString()} (Local: ${d.toString()})`);

    let added = 0;
    while (added < days) {
        d.setDate(d.getDate() + 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const checkStr = `${yyyy}-${mm}-${dd}`;

        const isBiz = isBusinessDay(d);
        console.log(`Checking ${d.toISOString()} (${checkStr}): Day=${d.getDay()}, Holiday=${US_HOLIDAYS.has(checkStr)} -> isBiz=${isBiz}`);

        if (isBiz) {
            added++;
        }
    }
    return d.toISOString().split('T')[0];
}

console.log("--- TEST 1: Jan 30 ---");
const result = getNextBusinessDay("2026-01-30", 1);
console.log(`Result: ${result}`);

console.log("\n--- TEST 2: Jan 30 (Manual Date Object) ---");
const d2 = new Date("2026-01-30");
// console.log(`Result 2: ${getNextBusinessDay(d2, 1)}`);
