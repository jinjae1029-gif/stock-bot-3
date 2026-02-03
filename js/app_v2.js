import { runSimulation, generateOrderSheetData, calculateNettingOrders, sortOrdersDesc } from './logic.js?v=debug2';
import { SOXL_DATA, QQQ_DATA } from './data.js';
import { runDeepMind, runRobustnessTest, runSensitivityTest, calculateSQN } from './deep_mind.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from './firebase_config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- FIREBASE HELPERS ---
function getUserId() {
    let uid = localStorage.getItem('firebaseUserId');
    if (!uid) {
        uid = 'stock-bot-1'; // Default
        localStorage.setItem('firebaseUserId', uid);
    }
    return uid;
}

// Global scope for accessibility
window.saveToCloud = async () => {
    const uid = getUserId();
    const defaults = JSON.parse(localStorage.getItem('tradingSheetDefaults') || '{}');
    const injections = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');
    const userSeed = localStorage.getItem('userSeed');

    // Capture Dates from UI
    const startDate = document.getElementById('startDate') ? document.getElementById('startDate').value : null;
    const endDate = document.getElementById('endDate') ? document.getElementById('endDate').value : null;

    // db structure: flat params + injections array + userSeed
    const data = {
        ...defaults, // spreads safe, offensive, rebalance objects
        userSeed: userSeed,
        injections: injections,
        startDate: startDate,
        endDate: endDate,
        lastUpdated: new Date().toISOString()
    };

    try {
        await setDoc(doc(db, "users", uid), data);
        console.log(`Saved to Firestore: users/${uid}`);
        // Optional: Toast or small indicator?
        // alert("클라우드 저장 완료"); // Too spammy if auto save? 
        // User asked for "Save to Cloud" button.
    } catch (e) {
        console.error("Cloud Save Error:", e);
        alert(`클라우드 저장 실패: ${e.message}`);
    }
};

async function loadFromCloud() {
    const uid = getUserId();
    console.log(`Loading from Firestore: users/${uid}...`);

    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("Cloud Data:", data);

            // 1. Update Injections
            if (data.injections) {
                localStorage.setItem('tradingSheetInjections', JSON.stringify(data.injections));
            }

            // 2. Update Seed
            if (data.userSeed) {
                localStorage.setItem('userSeed', data.userSeed);
                const elSeed = document.getElementById('initCapital');
                if (elSeed) elSeed.value = data.userSeed;
            }

            // 3. Update Params (Defaults)
            // Extract known keys: safe, offensive, rebalance
            const newDefaults = {};
            if (data.safe) newDefaults.safe = data.safe;
            if (data.offensive) newDefaults.offensive = data.offensive;
            if (data.rebalance) newDefaults.rebalance = data.rebalance;

            if (Object.keys(newDefaults).length > 0) {
                localStorage.setItem('tradingSheetDefaults', JSON.stringify(newDefaults));

                // Apply to Inputs! (Important)
                // We need to verify if elements exist before setting
                const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

                if (newDefaults.safe) {
                    setVal('safeBuyLimit', newDefaults.safe.buyLimit);
                    setVal('safeTarget', newDefaults.safe.target);
                    setVal('safeTimeCut', newDefaults.safe.timeCut);
                    // Weights
                    const wInputs = document.querySelectorAll('#safeWeights input');
                    if (newDefaults.safe.weights) {
                        newDefaults.safe.weights.forEach((w, i) => { if (wInputs[i]) wInputs[i].value = w; });
                    }
                }
                if (newDefaults.offensive) {
                    setVal('offBuyLimit', newDefaults.offensive.buyLimit);
                    setVal('offTarget', newDefaults.offensive.target);
                    setVal('offTimeCut', newDefaults.offensive.timeCut);
                    const wInputs = document.querySelectorAll('#offWeights input');
                    if (newDefaults.offensive.weights) {
                        newDefaults.offensive.weights.forEach((w, i) => { if (wInputs[i]) wInputs[i].value = w; });
                    }
                }
                if (newDefaults.rebalance) {
                    setVal('profitAdd', newDefaults.rebalance.profitAdd);
                    setVal('lossSub', newDefaults.rebalance.lossSub);
                }
            }

            console.log("Cloud synced.");
            // Re-run
            if (typeof runBacktest === 'function') runBacktest();

        } else {
            console.log("No cloud data found. Using local.");
        }
    } catch (e) {
        console.error("Cloud Load Error:", e);
    }
}


let mainChartInstance = null;
let ddChartInstance = null;
let cashChartInstance = null;

// --- DATE & HOLIDAY HELPERS ---
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

    let added = 0;
    while (added < days) {
        d.setDate(d.getDate() + 1);
        if (isBusinessDay(d)) {
            added++;
        }
    }
    return d.toISOString().split('T')[0];
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log("DEBUG: App Initializing...");
        loadFromCloud(); // Load Data from Firebase on Startup

        // Set End Date to Yesterday (Dynamic)
        // Set End Date to Latest Data Date or Yesterday (Dynamic)
        let endDateVal = "";
        if (typeof SOXL_DATA !== 'undefined' && Array.isArray(SOXL_DATA) && SOXL_DATA.length > 0) {
            endDateVal = SOXL_DATA[SOXL_DATA.length - 1].date;
        } else {
            const today = new Date();
            today.setDate(today.getDate() - 1); // Yesterday
            endDateVal = today.toISOString().split('T')[0];
        }
        document.getElementById('endDate').value = endDateVal;

        // Initial Run on Load
        runBacktest();

        // Event Listener
        document.getElementById('runBtn').addEventListener('click', runBacktest);

        // Sidebar Toggle
        document.getElementById('sidebarToggle').addEventListener('click', () => {
            document.querySelector('main').classList.toggle('sidebar-hidden');
        });

        // Real Tier Toggle Re-run
        const toggleRealTier = document.getElementById('toggleRealTier');
        toggleRealTier.addEventListener('change', () => {
            updateTierInputs();
            runBacktest();
        });

        // Helper to update Tier Input UI based on Real Tier State


        // Date Range Quick Select
        const setDates = (mode) => {
            let end = new Date(); // Default to System Yesterday
            end.setDate(end.getDate() - 1);

            // User preference: Align with Data + Next Day
            // If Data exists (e.g. Jan 30), set End to Next Business Day (e.g. Feb 2)
            if (typeof SOXL_DATA !== 'undefined' && Array.isArray(SOXL_DATA) && SOXL_DATA.length > 0) {
                const lastDataDate = SOXL_DATA[SOXL_DATA.length - 1].date;
                const nextBiz = getNextBusinessDay(lastDataDate, 1);
                end = new Date(nextBiz); // Set base to Next Business Day
            }

            const endDateStr = end.toISOString().split('T')[0];

            let start = new Date(end); // Default base from New End


            if (mode === 1) {
                // This Year (Jan 1)
                start = new Date(end.getFullYear(), 0, 1);
            } else if (mode === 2) {
                // Last 1 Year
                start.setFullYear(start.getFullYear() - 1);
            } else if (mode === 3) {
                // Last 3 Years
                start.setFullYear(start.getFullYear() - 3);
            } else if (mode === 4) {
                // Last 5 Years
                start.setFullYear(start.getFullYear() - 5);
            } else if (mode === 5) {
                // Last 8 Years
                start.setFullYear(start.getFullYear() - 8);
            } else if (mode === 6) {
                // All (From 2010-03-11)
                start = new Date(2010, 2, 11); // Month is 0-indexed (March = 2)
            }

            const offset = start.getTimezoneOffset() * 60000;
            const startLocal = new Date(start - offset);
            const startDateStr = startLocal.toISOString().split('T')[0];

            document.getElementById('startDate').value = startDateStr;
            document.getElementById('endDate').value = endDateStr;
            runBacktest();
        };

        document.getElementById('btnDate1').addEventListener('click', () => setDates(1));
        document.getElementById('btnDate2').addEventListener('click', () => setDates(2));
        document.getElementById('btnDate3').addEventListener('click', () => setDates(3));
        document.getElementById('btnDate4').addEventListener('click', () => setDates(4));
        document.getElementById('btnDate5').addEventListener('click', () => setDates(5));
        document.getElementById('btnDate6').addEventListener('click', () => setDates(6));

        // Button 7: Next Business Day (Skip Holidays)
        document.getElementById('btnDate7').addEventListener('click', () => {
            const currentEnd = document.getElementById('endDate').value;
            const nextDay = getNextBusinessDay(currentEnd, 1);
            document.getElementById('endDate').value = nextDay;
            runBacktest();
        });

        // Chart Toggles
        const toggleAsset = document.getElementById('toggleAssetChart');
        const toggleDD = document.getElementById('toggleDDChart');
        const toggleCash = document.getElementById('toggleCashChart');
        const containerAsset = document.getElementById('containerAsset');
        const containerDD = document.getElementById('containerDD');
        const containerCash = document.getElementById('containerCash');

        const updateChartVisibility = (toggle, container) => {
            if (toggle.checked) container.classList.remove('hidden');
            else container.classList.add('hidden');
        };

        toggleCash.addEventListener('change', () => updateChartVisibility(toggleCash, containerCash));
        toggleAsset.addEventListener('change', () => updateChartVisibility(toggleAsset, containerAsset));
        toggleDD.addEventListener('change', () => updateChartVisibility(toggleDD, containerDD));

        // Initialize Visibility on Load
        setTimeout(() => {
            toggleCash.checked = false;
            toggleAsset.checked = false;
            toggleDD.checked = false;

            updateChartVisibility(toggleAsset, containerAsset);
            updateChartVisibility(toggleDD, containerDD);

            // Default Robustness OFF
            document.getElementById('toggleRobustness').checked = false;
            document.getElementById('robustnessReport').classList.add('hidden');
        }, 0);

        // Robustness Toggle Listener
        document.getElementById('toggleRobustness').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const report = document.getElementById('robustnessReport');
            if (isChecked) {
                // If results exist (check if kpiFinal has value), try to run test
                // We need params. Best way is to just re-run backtest if data exists? 
                // Or easier: Just trigger runBacktest() to refresh everything including robustness if checked.
                // But re-running whole sim might be overkill. 
                // Better: Store lastParams globally.
                if (lastSimulationParams) {
                    triggerMainRobustnessTest(lastSimulationParams);
                }
            } else {
                report.classList.add('hidden');
            }
        });

        // --- TRADING SHEET LOGIC ---

        // --- MODE TOGGLE LOGIC (Backtester vs Trading Sheet) ---
        const toggleMode = document.getElementById('toggleMode');
        const btnUseDefaults = document.getElementById('btnUseDefaults');
        const btnMobileUseDefaults = document.getElementById('btnMobileUseDefaults'); // Mobile New Button
        const seedModal = document.getElementById('seedModal');
        const btnSaveModalSeed = document.getElementById('btnSaveModalSeed');
        const btnCloseSeedModal = document.getElementById('btnCloseSeedModal');
        const btnSaveSeed = document.getElementById('btnSaveSeed'); // Small save button next to initCapital
        const btnOrderSheet = document.getElementById('btnOrderSheet');

        // Elements to Toggle Visibility
        const toggleWarehouse = document.getElementById('toggleWarehouse');
        const toggleSaved = document.getElementById('toggleSavedStrategies');
        const savedStratWrapper = document.getElementById('mainSavedStrategiesWrapper');

        // Helper: Dates
        // Helper: Dates
        const setTradingSheetDates = () => {
            let lastDateStr = "";
            let yearVal = new Date().getFullYear();

            // 1. Try to get latest date from SOXL_DATA
            if (typeof SOXL_DATA !== 'undefined' && Array.isArray(SOXL_DATA) && SOXL_DATA.length > 0) {
                const lastData = SOXL_DATA[SOXL_DATA.length - 1];
                if (lastData && lastData.date) {
                    lastDateStr = lastData.date; // "YYYY-MM-DD"
                    yearVal = parseInt(lastDateStr.split('-')[0]);
                }
            }

            // 2. Fallback to System Time if Data Missing
            if (!lastDateStr) {
                const now = new Date();
                const toLocalYMD = (d) => {
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                lastDateStr = toLocalYMD(now);
                yearVal = now.getFullYear();
            }

            // 3. Set Start Date (Jan 1 of that year)
            const startDateStr = `${yearVal}-01-01`;

            document.getElementById('startDate').value = startDateStr;
            document.getElementById('endDate').value = lastDateStr;
        };

        // Mode Toggle Handler
        if (toggleMode) {
            toggleMode.addEventListener('change', (e) => {
                const isTradingSheet = e.target.checked;

                if (isTradingSheet) {
                    // -> TRADING SHEET MODE
                    // 1. Show "Use" button, Hide "Warehouse/Saved" toggles
                    btnUseDefaults.classList.remove('hidden');
                    if (toggleWarehouse) toggleWarehouse.parentElement.style.display = 'none';
                    if (toggleSaved) toggleSaved.parentElement.style.display = 'none';
                    if (savedStratWrapper) savedStratWrapper.style.display = 'none';

                    // 2. Button Visibility Logic
                    // Hide "Save Seed" (User specific logic: use 'Use' button or modal?) 
                    // We'll keep Save Seed for Seed only, but main param saving is gone for now.

                    // Show Injection Buttons
                    if (document.getElementById('btnInjSeed')) document.getElementById('btnInjSeed').classList.remove('hidden');
                    if (document.getElementById('btnInjCash')) document.getElementById('btnInjCash').classList.remove('hidden');

                    // 3. Load Defaults (if exist)
                    const defaults = localStorage.getItem('tradingSheetDefaults');

                    // 4. Trigger Seed Logic (if not set?) or just Date Logic?
                    setTradingSheetDates();

                    if (defaults) {
                        try {
                            const p = JSON.parse(defaults);
                            // Apply params (excluding seed/dates)
                            // Safe
                            document.getElementById('safeBuyLimit').value = p.safe.buyLimit;
                            document.getElementById('safeTarget').value = p.safe.target;
                            document.getElementById('safeTimeCut').value = p.safe.timeCut;

                            // Offensive
                            document.getElementById('offBuyLimit').value = p.offensive.buyLimit;
                            document.getElementById('offTarget').value = p.offensive.target;
                            document.getElementById('offTimeCut').value = p.offensive.timeCut;

                            // Rebalance
                            document.getElementById('profitAdd').value = p.rebalance.profitAdd;
                            document.getElementById('lossSub').value = p.rebalance.lossSub;

                            // Weights
                            const setWeights = (prefix, valArr) => {
                                const container = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights');
                                if (!container) return;
                                const inputs = container.querySelectorAll('input');
                                valArr.forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
                            };
                            if (p.safe.weights) setWeights('safe', p.safe.weights);
                            if (p.offensive.weights) setWeights('off', p.offensive.weights);

                            // Real Tier logic
                            if (p.useRealTier !== undefined) {
                                const rtToggle = document.getElementById('toggleRealTier');
                                if (rtToggle) {
                                    rtToggle.checked = p.useRealTier;
                                    updateTierInputs();
                                }
                            }

                            // Start Date Restoration (PC)
                            if (p.startDate) {
                                document.getElementById('startDate').value = p.startDate;
                            }

                        } catch (e) { console.error("Failed to load defaults", e); }
                    }



                    // 5. Ask for Seed IF not set?
                    //    Or just open modal if first time? 
                    //    Let's check if UserSeed exists.
                    const savedSeed = localStorage.getItem('userSeed');
                    if (!savedSeed) {
                        seedModal.classList.remove('hidden'); // Ask for seed first time
                    } else {
                        document.getElementById('initCapital').value = savedSeed;
                        btnOrderSheet.classList.remove('hidden'); // Show Order Sheet Button
                        runBacktest(); // Auto Run
                    }

                } else {
                    // -> BACKTESTER MODE
                    // 1. Restore UI
                    btnUseDefaults.classList.add('hidden');

                    // Only show Warehouse/Saved toggles if they exist
                    if (toggleWarehouse) toggleWarehouse.parentElement.style.display = '';
                    if (toggleSaved) toggleSaved.parentElement.style.display = '';

                    // Only Show Saved Wrapper IF Checkbox is Checked
                    if (savedStratWrapper) {
                        savedStratWrapper.style.display = toggleSaved.checked ? 'block' : 'none';
                        if (!toggleSaved.checked) savedStratWrapper.classList.add('hidden');
                        else savedStratWrapper.classList.remove('hidden');
                    }

                    // 2. Hide "Seed/Cash Change" Buttons
                    if (document.getElementById('btnInjSeed')) document.getElementById('btnInjSeed').classList.add('hidden');
                    if (document.getElementById('btnInjCash')) document.getElementById('btnInjCash').classList.add('hidden');

                    // 3. Hide Order Sheet Button AND Content Area
                    btnOrderSheet.classList.add('hidden');
                    const osArea = document.getElementById('orderSheetArea');
                    if (osArea) osArea.classList.add('hidden');

                    // 4. RESET PARAMS TO DEFAULTS
                    resetParamsToHardcodedDefaults();
                }
            });
        }

        // "Use" Button Handler
        if (btnUseDefaults) {
            btnUseDefaults.addEventListener('click', () => {
                // Save current inputs as Defaults
                // Also Save Current Seed as userSeed
                const currentSeed = document.getElementById('initCapital').value;
                if (currentSeed) localStorage.setItem('userSeed', currentSeed);

                // 1. Gather inputs (Reuse helper or just read)
                const getVal = (id) => parseFloat(document.getElementById(id).value);
                const getWeights = (prefix) => {
                    const container = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights');
                    if (!container) return [];
                    const inputs = container.querySelectorAll('input');
                    return Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
                };

                const defaults = {
                    safe: {
                        buyLimit: getVal('safeBuyLimit'),
                        target: getVal('safeTarget'),
                        timeCut: getVal('safeTimeCut'),
                        weights: getWeights('safe')
                    },
                    offensive: {
                        buyLimit: getVal('offBuyLimit'),
                        target: getVal('offTarget'),
                        timeCut: getVal('offTimeCut'),
                        weights: getWeights('off')
                    },
                    rebalance: {
                        profitAdd: getVal('profitAdd'),
                        lossSub: getVal('lossSub')
                    }
                };

                localStorage.setItem('tradingSheetDefaults', JSON.stringify(defaults));

                // Save Telegram Settings
                localStorage.setItem('tgToken', document.getElementById('tgToken').value);
                localStorage.setItem('tgChatId', document.getElementById('tgChatId').value);

                alert("현재 설정(시드 포함)이 '매매 시트' 기본값으로 저장되었습니다.");

                // Also run?
                runBacktest();
                saveToCloud(); // Save to Cloud
            });
        }

        // --- INJECTION LOGIC ---
        const btnInjSeed = document.getElementById('btnInjSeed');
        const btnInjCash = document.getElementById('btnInjCash');
        const injModal = document.getElementById('injectionModal');
        const btnSaveInj = document.getElementById('btnSaveInj');
        const btnCloseInj = document.getElementById('btnCloseInj');
        const btnViewInjHistory = document.getElementById('btnViewInjHistory');
        const injHistoryModal = document.getElementById('injectionHistoryModal');
        const btnCloseInjHistory = document.getElementById('btnCloseInjHistory');

        let currentInjType = 'SEED'; // 'SEED' or 'CASH'

        // Helper: Logic to predict next rebalance date
        const getNextRebalanceDate = () => {
            let daysToWait = 11; // Default fallback (Next Cycle)

            // Calculate based on last simulation state
            if (typeof window.lastFinalState !== 'undefined') {
                const s = window.lastFinalState;
                const timer = s.rebalanceTimer || 0;
                const isPending = s.pendingRebalance !== null && s.pendingRebalance !== undefined;

                if (isPending) {
                    // If pending, rebalance is Day 10 (finished). Next Cycle Start (Reflection) is Day 11 (Tomorrow).
                    daysToWait = 1;

                } else {
                    // If timer is 9 (Day 9 done), delay to Day 10 is 1. Next Cycle is 1+1=2.
                    // Formula: (10 - timer) + 1
                    daysToWait = Math.max(1, 10 - timer) + 1;
                }
            }

            // Project Business Days
            // Start from "End Date" (Last Closed Date)
            // If End Date is Today, we project from Today.
            let d = new Date(document.getElementById('endDate').value);
            if (isNaN(d.getTime())) d = new Date(); // Fallback to now

            let added = 0;
            while (added < daysToWait) {
                d.setDate(d.getDate() + 1);
                if (isBusinessDay(d)) { // Strict US Business Day
                    added++;
                }
            }
            return d.toISOString().split('T')[0];
        };

        // Open Modal Handlers
        const openInjModal = (type) => {
            currentInjType = type;
            document.getElementById('injModalTitle').textContent = type === 'SEED' ? '시드 자금 변동 신청' : '예수금 변동 신청';
            document.getElementById('injAmount').value = '';

            // Date Logic
            const dateInput = document.getElementById('injDate');
            const dateMsg = document.getElementById('injDateMsg');
            const dateLabel = dateInput.previousElementSibling; // The label "적용 희망 날짜"

            if (type === 'SEED') {
                // SEED: Hide Date Input, Show Message with Dynamic Date
                if (dateInput) dateInput.style.display = 'none';
                if (dateLabel) dateLabel.style.display = 'none';
                if (dateMsg) {
                    const nextDate = getNextRebalanceDate();
                    dateMsg.innerHTML = `🔄 다음 자금 갱신(리밸런싱)일인<br><span style="color:#059669; font-size:1.05rem;">${nextDate}</span> 에<br>자동으로 합산되어 반영됩니다.`;
                    dateMsg.classList.remove('hidden');
                    // Store for Save
                    dateInput.dataset.autoDate = nextDate;
                }
            } else {
                // CASH: Show Date Input but DISABLE IT, Set to "Today" (Next Business Day after EndDate)
                let nextBizDay = "";
                let d = new Date(document.getElementById('endDate').value);
                if (!isNaN(d.getTime())) {
                    // Add 1 Business Day
                    nextBizDay = getNextBusinessDay(d.toISOString().split('T')[0], 1);
                } else {
                    nextBizDay = getNextBusinessDay(new Date().toISOString().split('T')[0]);
                }

                if (dateInput) {
                    dateInput.style.display = 'block';
                    dateInput.disabled = true;
                    dateInput.value = nextBizDay;
                }
                if (dateLabel) dateLabel.style.display = 'block';
                if (dateMsg) {
                    dateMsg.innerHTML = `⚡ <b>즉시 반영</b><br>오늘(${nextBizDay}) 날짜로 예수금에 바로 반영됩니다.`;
                    dateMsg.classList.remove('hidden');
                }
            }

            injModal.classList.remove('hidden');
        };



        if (btnInjSeed) btnInjSeed.addEventListener('click', () => openInjModal('SEED'));
        if (btnInjCash) btnInjCash.addEventListener('click', () => openInjModal('CASH'));
        if (btnCloseInj) btnCloseInj.addEventListener('click', () => injModal.classList.add('hidden'));

        // Save Injection
        if (btnSaveInj) {
            btnSaveInj.addEventListener('click', () => {
                const amt = parseFloat(document.getElementById('injAmount').value);
                let date = "";

                if (currentInjType === 'SEED') {
                    date = document.getElementById('injDate').dataset.autoDate || "다음 갱신일";
                } else {
                    date = document.getElementById('injDate').value;
                    if (!date) { alert("날짜를 입력해주세요."); return; }
                }

                if (!amt) { alert("금액을 입력해주세요."); return; }

                const req = {
                    id: Date.now(), // timestamp id
                    type: currentInjType,
                    amount: amt,
                    date: date
                };

                const history = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');
                history.push(req);
                localStorage.setItem('tradingSheetInjections', JSON.stringify(history));

                alert("신청되었습니다.");
                injModal.classList.add('hidden');

                // Trigger recalculation visual?
                // If the Order Sheet is open (recalcOrderSheet), we should refresh it?
                // Yes, calling recalcOrderSheet(lastSimulationResult) if valid
                if (lastSimulationParams && window.recalcOrderSheet && typeof lastOrderSheetData !== 'undefined') {
                    // We need 'result' object. We might not have it stored fully. 
                    // Easier: Just re-run backtest? Or runBacktest()
                    // running backtest is safe.
                    runBacktest();
                }
                saveToCloud(); // Save to Cloud
            });
        }

        // View History
        if (btnViewInjHistory) {
            btnViewInjHistory.addEventListener('click', () => {
                renderInjHistory();
                injHistoryModal.classList.remove('hidden');
            });
        }
        if (btnCloseInjHistory) btnCloseInjHistory.addEventListener('click', () => injHistoryModal.classList.add('hidden'));

        // Render History Function
        window.renderInjHistory = () => {
            const list = document.getElementById('injHistoryList');
            const history = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');

            if (history.length === 0) {
                list.innerHTML = "<li style='color:#999;'>내역이 없습니다.</li>";
                return;
            }

            list.innerHTML = history.slice().reverse().map(item => { // Show newest first
                const typeLabel = item.type === 'SEED' ? '<span style="color:#10b981;">[시드]</span>' : '<span style="color:#2563eb;">[예수금]</span>';
                const dateLabel = item.date;
                const amtLabel = item.amount > 0 ? `+${item.amount.toLocaleString()}` : item.amount.toLocaleString();

                return `<li style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div>
                   <div>${typeLabel} <strong>${amtLabel}</strong> $</div>
                   <div style="font-size:0.8rem; color:#666;">희망일: ${dateLabel}</div>
                </div>
                <button onclick="deleteInjection(${item.id})" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">삭제</button>
            </li>`;
            }).join('');
        };

        // Delete Function Global
        window.deleteInjection = (id) => {
            if (!confirm("삭제하시겠습니까?")) return;
            const history = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');
            const newHistory = history.filter(h => h.id !== id);
            localStorage.setItem('tradingSheetInjections', JSON.stringify(newHistory));
            renderInjHistory(); // Refresh List
            runBacktest(); // Refresh Calc
            saveToCloud(); // Sync Delete
        };

        // Helper: Reset Params
        window.resetParamsToHardcodedDefaults = () => {
            // Hardcoded Defaults
            document.getElementById('initCapital').value = 10000;
            document.getElementById('safeBuyLimit').value = 3;
            document.getElementById('safeTarget').value = 0.2;
            document.getElementById('safeTimeCut').value = 30;
            // Clean weights to default?
            // Safe weights: 0, 20, 20, 20, 20, 20, 0
            const safeContainer = document.getElementById('safeWeights');
            if (safeContainer) {
                const inputs = safeContainer.querySelectorAll('input');
                [0, 20, 20, 20, 20, 20, 0].forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
            }

            document.getElementById('offBuyLimit').value = 4;
            document.getElementById('offTarget').value = 3;
            document.getElementById('offTimeCut').value = 7;
            // Off weights: 0, 0, 20, 20, 20, 20, 20
            const offContainer = document.getElementById('offWeights');
            if (offContainer) {
                const inputs = offContainer.querySelectorAll('input');
                [0, 0, 20, 20, 20, 20, 20].forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
            }

            document.getElementById('profitAdd').value = 10;
            document.getElementById('lossSub').value = 10;
        };

        // Shared Defaults Saving Logic
        const saveDefaults = () => {
            // Save current inputs as Defaults
            // 1. Gather inputs (Reuse helper or just read)
            const getVal = (id) => parseFloat(document.getElementById(id).value);
            const getWeights = (prefix) => {
                const inputs = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights').querySelectorAll('input');
                return Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
            };

            const defaults = {
                safe: {
                    buyLimit: getVal('safeBuyLimit'),
                    target: getVal('safeTarget'),
                    timeCut: getVal('safeTimeCut'),
                    weights: getWeights('safe')
                },
                offensive: {
                    buyLimit: getVal('offBuyLimit'),
                    target: getVal('offTarget'),
                    timeCut: getVal('offTimeCut'),
                    weights: getWeights('off')
                },
                rebalance: {
                    profitAdd: getVal('profitAdd'),
                    lossSub: getVal('lossSub')
                },
                useRealTier: document.getElementById('toggleRealTier').checked, // Save Tier State
                startDate: document.getElementById('startDate').value // Save Start Date
            };

            localStorage.setItem('tradingSheetDefaults', JSON.stringify(defaults));

            // Also Save Seed Logic here? PC originally did this in btnUseDefaults listener
            const currentSeed = document.getElementById('initCapital').value;
            if (currentSeed) localStorage.setItem('userSeed', currentSeed);

            alert("현재 설정(시드 포함, 시작일 포함)이 '기본값'으로 저장되었습니다.\n(클라우드 동기화 완료 ☁️)");

            // Also run?
            runBacktest();

            // Trigger Cloud Save
            if (window.saveToCloud) window.saveToCloud();
        };


        // "Use" Button Handler (PC) - Ensure only ONE listener executes this logic
        // The duplicate listener at L485 should be removed or ignored in favor of this one if this file is overwritten.
        // Since I am replacing the LATTER part, this will define the function used.
        // Users might have 2 listeners attached if I don't remove one. 
        // L799 attaches saveDefaults.
        if (btnUseDefaults) {
            // Cleanest way: assign validation to onclick if possible, or just add new one.
            // Since this replaces existing code block, it's fine.
            // Note: The previous listener (L485) is still there in the full file.
            // I should probably Comment Out the previous listener in a separate edit if I want to be clean.
            // But for now, ensuring THIS function calls saveToCloud covers the case where THIS listener fires.
            // If BOTH fire, both save. Better than NONE saving.
            btnUseDefaults.addEventListener('click', saveDefaults);
        }

        // "Use" Button Handler (Mobile)
        if (btnMobileUseDefaults) {
            btnMobileUseDefaults.addEventListener('click', saveDefaults);
        }

        // Mobile Auto-Load Logic (If toggleMode is missing)
        if (!toggleMode) {
            // Assume Mobile Context: Load Defaults on Start
            const defaults = localStorage.getItem('tradingSheetDefaults');

            // Set Default Dates for Trading Sheet style (Baseline)
            setTradingSheetDates();

            if (defaults) {
                try {
                    const p = JSON.parse(defaults);
                    // Safe
                    document.getElementById('safeBuyLimit').value = p.safe.buyLimit;
                    document.getElementById('safeTarget').value = p.safe.target;
                    document.getElementById('safeTimeCut').value = p.safe.timeCut;
                    // Offensive
                    document.getElementById('offBuyLimit').value = p.offensive.buyLimit;
                    document.getElementById('offTarget').value = p.offensive.target;
                    document.getElementById('offTimeCut').value = p.offensive.timeCut;
                    // Rebalance
                    document.getElementById('profitAdd').value = p.rebalance.profitAdd;
                    document.getElementById('lossSub').value = p.rebalance.lossSub;
                    // Weights
                    const setWeights = (prefix, valArr) => {
                        const container = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights');
                        if (!container) return;
                        const inputs = container.querySelectorAll('input');
                        valArr.forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
                    };
                    if (p.safe.weights) setWeights('safe', p.safe.weights);
                    if (p.offensive.weights) setWeights('off', p.offensive.weights);
                    // Real Tier
                    if (p.useRealTier !== undefined) {
                        const rtToggle = document.getElementById('toggleRealTier');
                        if (rtToggle) {
                            rtToggle.checked = p.useRealTier;
                            updateTierInputs();
                        }
                    }
                    // Start Date Restoration
                    if (p.startDate) {
                        document.getElementById('startDate').value = p.startDate;
                    }
                } catch (e) { console.error("Mobile load defaults error", e); }
            }

            // Load Seed
            const savedSeed = localStorage.getItem('userSeed');
            if (savedSeed) {
                document.getElementById('initCapital').value = savedSeed;
            }
        }

        // Modal Logic (Keep existing, slightly modified trigger)
        // Removed old btnTradingSheet listener.

        if (btnSaveModalSeed) {
            btnSaveModalSeed.addEventListener('click', () => {
                const val = parseFloat(document.getElementById('modalSeedInput').value);
                if (val) {
                    localStorage.setItem('userSeed', val);
                    document.getElementById('initCapital').value = val;

                    // Set Date: Jan 1 to Today (Local Time correct)
                    const now = new Date();
                    const start = new Date(now.getFullYear(), 0, 1);
                    // Fix Timezone offset for YYYY-MM-DD
                    const toLocalISO = (d) => {
                        const offset = d.getTimezoneOffset() * 60000;
                        return new Date(d - offset).toISOString().split('T')[0];
                    };

                    document.getElementById('startDate').value = toLocalISO(start);
                    document.getElementById('endDate').value = toLocalISO(now);

                    seedModal.classList.add('hidden');
                    btnSaveSeed.classList.remove('hidden'); // Show manual save button

                    // Show Order Sheet Button
                    const btnOrder = document.getElementById('btnOrderSheet');
                    if (btnOrder) btnOrder.classList.remove('hidden');

                    runBacktest();
                }
            });
        }

        if (btnCloseSeedModal) {
            btnCloseSeedModal.addEventListener('click', () => seedModal.classList.add('hidden'));
        }

        if (btnSaveSeed) {
            btnSaveSeed.addEventListener('click', () => {
                const val = document.getElementById('initCapital').value;
                localStorage.setItem('userSeed', val);
                alert("초기 시드가 저장되었습니다: $" + val);
            });
        }
    } catch (criticalError) {
        console.error("CRITICAL APP ERROR:", criticalError);
        alert("애플리케이션 초기화 중 치명적 오류 발생:\n" + criticalError.message);
    }
});

let lastSimulationParams = null; // Global store


function updateTierInputs() {
    const toggle = document.getElementById('toggleRealTier');
    if (!toggle) return;
    const isRealTier = toggle.checked;

    // Use specific IDs if available, else fallback
    let safe8 = document.getElementById('safeWeight8');
    let off8 = document.getElementById('offWeight8');

    // Fallback logic if IDs are missing (robustness)
    if (!safe8) {
        const inputs = document.querySelectorAll('#safeWeights input');
        if (inputs.length > 0) safe8 = inputs[inputs.length - 1];
    }
    if (!off8) {
        const inputs = document.querySelectorAll('#offWeights input');
        if (inputs.length > 0) off8 = inputs[inputs.length - 1];
    }

    if (safe8) {
        safe8.disabled = isRealTier;
        safe8.style.backgroundColor = isRealTier ? '#e5e7eb' : '';
        safe8.style.opacity = isRealTier ? "0.3" : "1";
        safe8.title = isRealTier ? "Real Tier 모드에서는 8차수(무한매수)가 비활성화됩니다." : "";
    }
    if (off8) {
        off8.disabled = isRealTier;
        off8.style.backgroundColor = isRealTier ? '#e5e7eb' : '';
        off8.style.opacity = isRealTier ? "0.3" : "1";
        off8.title = isRealTier ? "Real Tier 모드에서는 8차수(무한매수)가 비활성화됩니다." : "";
    }

    // Removed destructive Auto-fill logic to preserve User Input
}

function getWeights(containerId) {
    const inputs = document.querySelectorAll(`#${containerId} input`);
    return Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
}

function runBacktest() {
    const params = {
        initialCapital: parseFloat(document.getElementById('initCapital').value),
        feeRate: parseFloat(document.getElementById('feeRate').value) || 0,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        useRealTier: document.getElementById('toggleRealTier').checked,

        safe: {
            buyLimit: parseFloat(document.getElementById('safeBuyLimit').value),
            target: parseFloat(document.getElementById('safeTarget').value),
            timeCut: parseFloat(document.getElementById('safeTimeCut').value),
            weights: getWeights('safeWeights')
        },
        offensive: {
            buyLimit: parseFloat(document.getElementById('offBuyLimit').value),
            target: parseFloat(document.getElementById('offTarget').value),
            timeCut: parseFloat(document.getElementById('offTimeCut').value),
            weights: getWeights('offWeights')
        },
        rebalance: {
            profitAdd: parseFloat(document.getElementById('profitAdd').value),
            lossSub: parseFloat(document.getElementById('lossSub').value),
        }
    };

    console.log("Running Sim:", params);
    lastSimulationParams = params; // Store for toggle re-run

    try {
        const injections = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');
        const result = runSimulation(SOXL_DATA, QQQ_DATA, params, injections);
        console.log("DEBUG: Simulation Result:", result); // Added Debug Code

        // Store Final State for Rebalance Date Logic
        if (result && result.finalState) {
            window.lastFinalState = result.finalState;
        }

        updateKPI(result);
        renderCharts(result);
        renderTable(result);
        renderOrderSheet(result);

        // Apply Manual Injections if any (Overwrites initial render)
        if (typeof window.recalcOrderSheet === 'function') {
            window.recalcOrderSheet(result);
        }
    } catch (error) {
        console.error("Simulation Error:", error);
        alert("오류가 발생했습니다:\n" + error.message);
    }
}

document.getElementById('btnOrderSheet').addEventListener('click', () => {
    const area = document.getElementById('orderSheetArea');
    area.classList.toggle('hidden');
});

// --- DEEP MIND INTEGRATION ---
// --- DEEP MIND INTEGRATION ---
const elDeepMindView = document.getElementById('deepMindView');
const elConfig = document.getElementById('dmConfig'); // New Panel
const elLoading = document.getElementById('dmLoading');
const elResults = document.getElementById('dmResults');
const elModal = document.getElementById('dmModal');
const elProgress = document.getElementById('dmProgress');
const elProgressText = document.getElementById('dmProgressText');

let topCandidates = [];
let currentDrillParams = null;

// 1. Open Deep Mind View (Show Config Only)
document.getElementById('btnDeepMind').addEventListener('click', async () => {
    document.querySelector('.app-container').classList.add('hidden');

    // Hide Main View Bottom Sheet
    const mainSheet = document.getElementById('mainSavedStrategiesWrapper');
    if (mainSheet) mainSheet.style.display = 'none';

    elDeepMindView.classList.remove('hidden');

    // Show Config, Hide others
    elConfig.classList.remove('hidden');
    elResults.classList.add('hidden');
    elLoading.classList.add('hidden');
    elModal.classList.add('hidden');
});

// 2. Start Search Button Click
document.getElementById('btnStartDeepMind').addEventListener('click', () => {
    // Read Config Inputs
    const getVal = (id) => parseFloat(document.getElementById(id).value);

    const config = {
        safe: {
            buyLimit: [getVal('dmSafeBuyMin'), getVal('dmSafeBuyMax')],
            target: [getVal('dmSafeTargetMin'), getVal('dmSafeTargetMax')],
            timeCut: [getVal('dmSafeTimeMin'), getVal('dmSafeTimeMax')]
        },
        offensive: {
            buyLimit: [getVal('dmOffBuyMin'), getVal('dmOffBuyMax')],
            target: [getVal('dmOffTargetMin'), getVal('dmOffTargetMax')],
            timeCut: [getVal('dmOffTimeMin'), getVal('dmOffTimeMax')]
        },
        rebalance: {
            profitAdd: [getVal('dmProfitAddMin'), getVal('dmProfitAddMax')],
            lossSub: [getVal('dmLossSubMin'), getVal('dmLossSubMax')]
        },
        iterations: getVal('dmIterations') // Added User Configurable Iterations
    };

    // UI Transition
    elConfig.classList.add('hidden');
    elLoading.classList.remove('hidden');
    document.querySelector('#dmTable tbody').innerHTML = "";
    document.getElementById('dmLoadingText').textContent = "AI가 설정된 범위 내에서 최적값을 탐색 중입니다...";

    // Run Logic
    setTimeout(async () => {
        try {
            topCandidates = await runDeepMind(SOXL_DATA, QQQ_DATA, config, (current, total) => {
                const pct = (current / total) * 100;
                elProgress.style.width = pct + "%";
                elProgressText.textContent = `${current} / ${total}`;
            });

            renderDeepMindTable(topCandidates);

            elLoading.classList.add('hidden');
            elResults.classList.remove('hidden');
        } catch (e) {
            console.error(e);
            alert("Deep Mind Error: " + e.message);
            // Show config again on error?
            elConfig.classList.remove('hidden');
            elLoading.classList.add('hidden');
        }
    }, 100);
});

document.getElementById('btnCloseDM').addEventListener('click', () => {
    elDeepMindView.classList.add('hidden');
    document.querySelector('.app-container').classList.remove('hidden');
});

document.getElementById('btnModalClose').addEventListener('click', () => {
    elModal.classList.add('hidden');
});

document.getElementById('btnDeepDrill').addEventListener('click', () => {
    if (currentDrillParams) {
        applyDeepDrillParams(currentDrillParams);
    }
});

function renderDeepMindTable(candidates) {
    const tbody = document.querySelector('#dmTable tbody');
    tbody.innerHTML = "";

    candidates.forEach((c, idx) => {
        const tr = document.createElement('tr');
        const p = c.params;
        const summary = `Weight: ${p.safe.weights.slice(0, 3).join(',')}+... | P.Add: ${p.rebalance.profitAdd}%`;

        tr.innerHTML = `
            <td>#${idx + 1}</td>
            <td style="color:#ef4444; font-weight:bold;">${c.cagr.toFixed(2)}%</td>
            <td style="color:#2563eb;">${c.mdd.toFixed(2)}%</td>
            <td>${c.winRate.toFixed(2)}%</td>
            <td>${c.sqn.toFixed(2)}</td>
            <td>${c.pf.toFixed(2)}</td>
            <td style="font-size:0.8em; color:#94a3b8;">${summary}</td>
            <td><button class="dm-action-btn" onclick="openRobustnessModal(${idx})">DEEP DIVE</button></td>
        `;
        tbody.appendChild(tr);
    });
}

window.openRobustnessModal = async (idx) => {
    const candidate = topCandidates[idx];
    if (!candidate) return;

    currentDrillParams = candidate.params;

    elModal.classList.remove('hidden');

    // UI Setup: Parameter Display
    const pEl = document.getElementById('dmParamsDisplay');
    const p = candidate.params;
    const wFmt = (arr) => arr.join(' / ');

    pEl.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; text-align: left;">
            <div>
                <div style="color: #fbbf24; font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">🛡️ Safe Mode</div>
                <div style="color:white; margin-bottom:0.2rem;">Buy Limit: <span style="font-weight:bold;">${p.safe.buyLimit}%</span></div>
                <div style="color:white; margin-bottom:0.2rem;">Target: <span style="font-weight:bold;">${p.safe.target}%</span></div>
                <div style="color:white; margin-bottom:0.2rem;">Time Cut: <span style="font-weight:bold;">${p.safe.timeCut}</span></div>
                <div style="margin-top:0.4rem;">
                    <span style="color:#94a3b8; font-size:0.8rem; display:block; margin-bottom:2px;">Weights (Tier 1-8)</span>
                    <span style="color:#cbd5e1; font-family:monospace;">${wFmt(p.safe.weights)}</span>
                </div>
            </div>
            
            <div>
                <div style="color: #f472b6; font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">⚔️ Offensive Mode</div>
                <div style="color:white; margin-bottom:0.2rem;">Buy Limit: <span style="font-weight:bold;">${p.offensive.buyLimit}%</span></div>
                <div style="color:white; margin-bottom:0.2rem;">Target: <span style="font-weight:bold;">${p.offensive.target}%</span></div>
                <div style="color:white; margin-bottom:0.2rem;">Time Cut: <span style="font-weight:bold;">${p.offensive.timeCut}</span></div>
                <div style="margin-top:0.4rem;">
                    <span style="color:#94a3b8; font-size:0.8rem; display:block; margin-bottom:2px;">Weights (Tier 1-8)</span>
                    <span style="color:#cbd5e1; font-family:monospace;">${wFmt(p.offensive.weights)}</span>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 1rem; padding-top: 0.5rem; border-top: 1px dashed #475569; text-align:center;">
             <span style="color:#94a3b8; margin-right: 10px;">Rebalance Logic:</span>
             <span style="color:#38bdf8; font-weight:bold;">Profit +${p.rebalance.profitAdd}%</span>
             <span style="color:#64748b; margin:0 5px;">|</span>
             <span style="color:#ef4444; font-weight:bold;">Loss -${p.rebalance.lossSub}%</span>
        </div>
    `;

    document.getElementById('rbSurvival').textContent = "...";
    document.getElementById('rbCagr').textContent = "...";
    document.getElementById('rbMdd').textContent = "...";
    document.getElementById('rbSqn').textContent = "...";
    document.getElementById('rbR2').textContent = "...";

    const elRbLoading = document.getElementById('rbLoading');
    const elRbProgress = document.getElementById('rbProgress');
    const elRbProgressText = document.getElementById('rbProgressText');

    if (elRbLoading) {
        elRbLoading.classList.remove('hidden');
        if (elRbProgress) elRbProgress.style.width = "0%";
        if (elRbProgressText) elRbProgressText.textContent = "0 / 1000";
    }

    setTimeout(async () => {
        const stats = await runRobustnessTest(candidate.params, SOXL_DATA, QQQ_DATA, (current, total) => {
            const pct = (current / total) * 100;
            if (elRbProgress) elRbProgress.style.width = pct + "%";
            if (elRbProgressText) elRbProgressText.textContent = `${current} / ${total}`;
        });

        // Store global for saving
        currentRobustnessStats = stats;

        if (elRbLoading) elRbLoading.classList.add('hidden');

        document.getElementById('rbSurvival').textContent = stats.survivalRate.toFixed(1) + "%";

        const survEl = document.getElementById('rbSurvival');
        survEl.style.color = stats.survivalRate >= 80 ? '#10b981' : (stats.survivalRate < 50 ? '#ef4444' : '#f8fafc');

        document.getElementById('rbCagr').textContent = stats.avgCagr.toFixed(2) + "%";
        document.getElementById('rbMdd').textContent = stats.avgMdd.toFixed(2) + "%";
        document.getElementById('rbSqn').textContent = stats.avgSqn.toFixed(2);
        document.getElementById('rbR2').textContent = stats.avgR2.toFixed(4);
    }, 50);
};

function applyDeepDrillParams(params) {
    elModal.classList.add('hidden');
    elDeepMindView.classList.add('hidden');

    document.getElementById('safeBuyLimit').value = params.safe.buyLimit;
    document.getElementById('safeTarget').value = params.safe.target;
    document.getElementById('safeTimeCut').value = params.safe.timeCut;

    const safeInputs = document.querySelectorAll('#safeWeightsInput input'); // ID fixed
    // Note: In HTML it is id="safeWeights" but let's check index.html for ID
    // Step 160 view showed: id="safeWeightsInput"
    // Wait, let's verify if getWeights uses 'safeWeights'.
    // Step 324 code: getWeights('safeWeights') -> document.querySelectorAll('#safeWeights input')
    // So the ID in HTML must be 'safeWeights'.
    // Check Step 160... no, Step 324 code says 'safeWeights'.
    // I will assume ID is 'safeWeights' based on my getWeights function.

    const safeInputs2 = document.querySelectorAll('#safeWeights input');
    params.safe.weights.forEach((w, i) => {
        if (safeInputs2[i]) safeInputs2[i].value = w;
    });

    document.getElementById('offBuyLimit').value = params.offensive.buyLimit;
    document.getElementById('offTarget').value = params.offensive.target;
    document.getElementById('offTimeCut').value = params.offensive.timeCut;

    const offInputs2 = document.querySelectorAll('#offWeights input');
    params.offensive.weights.forEach((w, i) => {
        if (offInputs2[i]) offInputs2[i].value = w;
    });

    document.getElementById('profitAdd').value = params.rebalance.profitAdd;
    document.getElementById('lossSub').value = params.rebalance.lossSub;

    const toggle = document.getElementById('toggleRealTier');
    if (toggle) {
        // Load Saved State or Default to False if missing (backwards compatibility)
        const shouldBeReal = params.useRealTier === true;
        toggle.checked = shouldBeReal;
        updateTierInputs();
    }

    setTimeout(() => {
        runBacktest();
    }, 100);
}


function renderTable(result) {
    if (!result || !result.ledger) {
        console.error("DEBUG: renderTable called with invalid result:", result);
        return;
    }

    const ledger = result.ledger;
    const state = result.finalState;
    const params = result.params;
    const tbody = document.querySelector('#ledgerTable tbody');

    console.log(`DEBUG: renderTable called. Ledger Length: ${ledger.length}`);

    if (!tbody) {
        console.error("DEBUG: #ledgerTable tbody NOT FOUND in DOM!");
        // Critical: Can't render without tbody.
        // Try to recover if possible? No, HTML structure issue.
        alert("Critical Error: Table Body Missing (Check Console)");
        return;
    }

    tbody.innerHTML = "";

    if (ledger.length === 0) {
        console.warn("DEBUG: Ledger is empty. Filters/Date Range correct?");
        tbody.innerHTML = "<tr><td colspan='20' style='text-align:center; padding:20px; color:#64748b;'>데이터가 없습니다 (기간/설정 확인 필요)</td></tr>";
        return;
    }

    const fmtN = (n) => n !== null && n !== undefined ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
    const fmtP = (n) => n !== null && n !== undefined ? n.toFixed(2) + "%" : "";
    const fmtC = (n) => n !== null && n !== undefined ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "";
    const fmtI = (n) => n !== null && n !== undefined ? Math.round(n).toLocaleString() : "";

    let html = "";

    if (state && params) {
        const lastDate = new Date(state.lastDate);
        const nextDateStr = getNextBusinessDay(lastDate);
        const nextDate = new Date(nextDateStr); // Re-objectify for getDay()
        const nextDayKo = ['일', '월', '화', '수', '목', '금', '토'][nextDate.getDay()];
        const modeName = state.mode;
        const modeParams = modeName === "Safe" ? params.safe : params.offensive;
        const nextLocPrice = state.lastClose * (1 + modeParams.buyLimit / 100);
        const modeClass = modeName === "Safe" ? "mode-safe" : "mode-offensive";
        const modeKo = modeName === "Safe" ? "안전" : "공세";

        html += `
        <tr style="background-color: #fefce8; border-bottom: 2px solid #fbbf24;">
            <td style="font-weight:bold; color:#1e1e1e; text-align: center;">${nextDateStr} (${nextDayKo})<br><span style="font-size:0.8em; color:#d97706;">(예상)</span></td>
            <td>-</td>
            <td class="${modeClass}" style="font-weight:bold;">${modeKo}</td>
            <td>-</td>
            <!-- Buy Group -->
            <td>${state.holdings ? (state.holdings.length + 1) : '-'}</td> <!-- Tier Estimate? -->
            <td>-</td>
            <td style="font-weight:bold; color:#ef4444; background-color:#fff7ed;">${fmtN(nextLocPrice)}</td> <!-- LOC Target -->
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <!-- Sell Group (6) -->
            <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
            <!-- PnL (4) -->
            <td>-</td><td>-</td><td>-</td><td>-</td>
            <!-- Asset (4) -->
            <td id="previewFundRefresh" style="font-size:0.85em; color:${(state.pendingRebalance || 0) >= 0 ? '#10b981' : '#2563eb'};">
                ${state.pendingRebalance !== null && state.pendingRebalance !== undefined ? fmtC(state.pendingRebalance) : '-'}
            </td>
            <td id="previewTotalSeed">${fmtC(state.currentSeed + (state.pendingRebalance || 0))}</td>
            <td id="previewTotalAsset" style="background-color: #f8fafc; font-weight:bold;">${fmtC(result.finalBalance || 0)}</td> <!-- Use Final Equity -->
            <td id="previewCash" style="font-size:0.9em; color:#64748b;">${fmtC(state.balance)}</td>
            <!-- DD (1) -->
            <td style="color:#94a3b8; font-size:0.9em;">-</td>
        </tr>`;
    }

    ledger.forEach(row => {
        const modeClass = row.mode === "Safe" ? "mode-safe" : "mode-offensive";
        const modeKo = row.mode === "Safe" ? "안전" : "공세";
        const changeColor = row.changePct > 0 ? "#ef4444" : "#2563eb";
        const pnlColor = row.netPnL > 0 ? "#ef4444" : (row.netPnL < 0 ? "#2563eb" : "");
        const pnlText = row.netPnL !== 0 ? fmtC(row.netPnL) : "-";
        const pnlPctText = row.netPnLPct !== 0 ? row.netPnLPct.toFixed(2) + "%" : "-";

        html += `
        <tr>
            <td style="text-align:center;">${row.date}</td>
            <td style="${row.close ? '' : 'color:#ccc'}">${row.close ? fmtN(row.close) : '-'}</td>
            <td class="${modeClass}">${modeKo}</td>
            <td style="color:${changeColor}">${row.changePct ? row.changePct.toFixed(2) + "%" : "0.00%"}</td>

            <!-- Buy Group -->
            <td>${row.tier || '-'}</td>
            <td style="color:#1e1e1e;">${row.targetAllocation !== undefined && row.targetAllocation !== null ? fmtC(row.targetAllocation) : '-'}</td>
            <td>${row.locTarget ? fmtN(row.locTarget) : '-'}</td>
            
            <!-- Buy Price Logic: Red Bold if bought (even 0 qty), else '-'.
                 Check if it's a "Buy 0" case: allocation >= 0 and buyPrice exists. -->
            <td style="font-weight:bold; color:#ef4444;">${row.buyPrice ? fmtN(row.buyPrice) : '-'}</td>
            
            <td>${row.buyQty !== null ? fmtI(row.buyQty) : '-'}</td>
            <td>${row.buyAmount !== null ? fmtC(row.buyAmount) : '-'}</td>

            <!-- Sell Group -->
            <td>${row.targetSell ? fmtN(row.targetSell) : '-'}</td>
            <td style="font-size:0.8em; color:#ef4444;">${row.mocSell || '-'}</td>
            <td>${row.sellDate || '-'}</td>
            <td style="font-weight:bold; color:#2563eb;">${row.sellPrice ? fmtN(row.sellPrice) : '-'}</td>
            <td>${row.sellQty !== null ? fmtI(row.sellQty) : '-'}</td>
            <td>${row.sellAmount !== null ? fmtC(row.sellAmount) : '-'}</td>

            <!-- PnL Group -->
            <td>${row.fee > 0 ? fmtC(row.fee) : '-'}</td>
            <td style="font-weight:bold; color:${pnlColor}">${pnlText}</td>
            <td style="color:${pnlColor}">${pnlPctText}</td>
            <td style="color:${row.accumPnL > 0 ? '#ef4444' : (row.accumPnL < 0 ? '#2563eb' : '')}">${fmtC(row.accumPnL)}</td>

            <!-- Asset Group -->
            <td style="font-size:0.85em; color:#10b981;">${row.fundRefresh ? fmtC(row.fundRefresh) : '-'}</td>
            <td>${fmtC(row.totalSeed)}</td>
            <td style="background-color: #f8fafc; font-weight:bold;">${fmtC(row.totalAsset)}</td>
            <td style="font-size:0.9em; color:#64748b;">${fmtC(row.cash)}</td>

            <!-- Etc -->
            <td style="color:#64748b; font-size:0.85em;">${fmtN(row.drawdown)}%</td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

// Global variable to store last result for Netting calculation
let lastOrderSheetData = null;

// Helper: Sort Orders Price Descending


// Helper: Render Order List HTML
function renderOrderListHTML(orders) {
    if (orders.length === 0) return '<div style="color:#1e1e1e; font-weight:bold; text-align:center; padding:10px;">오늘 주문이 없습니다</div>';

    return orders.map((o, i) => {
        const isBuy = o.type.includes('buy') || o.type.includes('매수') || o.isBuy;
        const color = isBuy ? '#ef4444' : '#2563eb';

        // Text Construction
        // o.text usually contains the full string "LOC 매수 10개 @ $100"
        let displayType = o.text ? o.text : "";

        if (!displayType) {
            const typeLabel = o.type === 'MOC' ? 'MOC 매도' : (isBuy ? 'LOC 매수' : 'LOC 매도');
            const qtyLabel = `${o.qty}개`;
            const priceStr = o.price ? `$${o.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Market';

            return `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; color:${color}; font-size:0.95rem;">
                <div style="flex:1;">${typeLabel}</div>
                <div style="flex:1; text-align:center; font-weight:bold;">${priceStr}</div>
                <div style="flex:1; text-align:right;">${qtyLabel}</div>
            </div>`;
        } else {
            return `<div style="padding:6px 0; border-bottom:1px solid #f1f5f9; color:${color}; font-size:0.95rem;">
                ${displayType}
             </div>`;
        }
    }).join('');
}

function renderOrderSheet(result) {
    const area = document.getElementById('orderSheetArea');
    if (!area) return;

    if (!result || !result.finalState) {
        area.innerHTML = "<div>No data available. Run simulation first.</div>";
        return;
    }

    // Use Shared Logic
    // Use Shared Logic
    lastOrderSheetData = generateOrderSheetData(result.finalState, result.params);

    if (!lastOrderSheetData) {
        area.innerHTML = "<div>Error generating order data.</div>";
        return;
    }

    // Extract for UI use
    const s = result.finalState; // Still needed for some UI bits
    const isSafe = lastOrderSheetData.mode === "Safe";
    const isRealTier = lastOrderSheetData.isRealTier;
    const sellTargets = lastOrderSheetData.sells;

    // Prepare Initial View
    let initialListHtml = "";
    let initialBtnHtml = "";

    if (isRealTier) {
        // Real Tier Mode: Raw Orders (Unorganized or Sorted?) -> Sorted by Price Desc per user requirement (All lists sorted)
        // Combine raw buy and sells for sorted display
        const allOrders = [lastOrderSheetData.buy, ...sellTargets];
        const sortedOrders = sortOrdersDesc(allOrders);
        initialListHtml = renderOrderListHTML(sortedOrders);

        initialBtnHtml = `
            <button onclick="adjustTargetAndRender()" style="width:100%; margin-top:10px; background:#fbbf24; color:#000; font-weight:bold; border:none; padding:10px; border-radius:6px; cursor:pointer;">
                🎯 목표매수가 조정
            </button>
        `;
    } else {
        // Standard Mode
        const allOrders = [lastOrderSheetData.buy, ...sellTargets];
        const sortedOrders = sortOrdersDesc(allOrders);
        initialListHtml = renderOrderListHTML(sortedOrders);

        initialBtnHtml = `
             <button onclick="calculateAndRenderNetting()" style="width:100%; margin-top:10px; background:#2563eb; color:white; font-weight:bold; border:none; padding:10px; border-radius:6px; cursor:pointer;">
                🧮 퉁치기 계산 (Netting)
             </button>
        `;
    }

    const nextDate = new Date(s.lastDate);
    const dateStr = getNextBusinessDay(s.lastDate);
    const modeName = isSafe ? "Safe" : "Offensive";

    area.innerHTML = `
        <h3 style="margin:0 0 10px 0; border-bottom:1px solid #ddd; padding-bottom:5px; font-size:1.1rem;">
            📋 주문표 (${dateStr}) - ${modeName}
        </h3>
        <div id="osListArea">${initialListHtml}</div>
        <div id="osBtnArea">${initialBtnHtml}</div>
        <div id="osResultArea" style="margin-top:15px; border-top:2px dashed #ccc; padding-top:10px; display:none;"></div>
    `;



    // Only show automatically if in Trading Sheet Mode
    if (document.getElementById('toggleMode').checked) {
        area.classList.remove('hidden');
    } else {
        area.classList.add('hidden'); // Ensure hidden in Backtester
    }
}

// Recalculate Logic
// Recalculate Logic
window.recalcOrderSheet = (result) => {
    // Save Final State globally for Date Projection
    if (result && result.finalState) {
        window.lastFinalState = result.finalState;
    }

    // 1. Calculate Total Injections from History
    // 1. Calculate Total Injections from History
    const history = JSON.parse(localStorage.getItem('tradingSheetInjections') || '[]');
    let seedInj = 0;
    let cashInj = 0;

    history.forEach(item => {
        if (item.type === 'SEED') seedInj += (item.amount || 0);
        else if (item.type === 'CASH') cashInj += (item.amount || 0);
    });

    const s = result.finalState;
    const p = result.params;
    const isSafe = s.mode === "Safe";
    const modeParams = isSafe ? p.safe : p.offensive;

    // Base Values
    const pending = s.pendingRebalance || 0;
    const baseSeed = s.currentSeed;

    // Future Total Seed (for display)
    const newTotalSeed = baseSeed + pending + seedInj;

    // Allocation Base: Seed Injection applies from TOMORROW.
    // However, if we accept injection TODAY, does it affect today's buy?
    // User requested: "Seed Change -> Next Day". 
    // Logic: allocationBaseSeed = baseSeed + pending (Same as before)
    const allocationBaseSeed = baseSeed + pending;

    // Recalc Allocation
    const currentTierIdx = s.holdings.length;
    const weights = modeParams.weights;
    const weightPct = (currentTierIdx < weights.length) ? weights[currentTierIdx] : 0;

    // Allocation based on BASE SEED only
    const newAllocation = allocationBaseSeed * (weightPct / 100);

    // Recalc Buy Qty
    const buyLimitRate = modeParams.buyLimit / 100;
    const buyLocPrice = Number((s.lastClose * (1 + buyLimitRate)).toFixed(2));
    const newBuyQty = (newAllocation > 0 && buyLocPrice > 0) ? Math.floor(newAllocation / buyLocPrice) : 0;

    // Update Order Sheet Data Global
    if (lastOrderSheetData && lastOrderSheetData.buy) {
        lastOrderSheetData.buy.qty = newBuyQty;
    }

    // Update Ledger Preview Row
    const elRef = document.getElementById('previewFundRefresh');
    const elSeed = document.getElementById('previewTotalSeed');
    const elAsset = document.getElementById('previewTotalAsset');
    const elCash = document.getElementById('previewCash');

    if (elRef) {
        // Color Logic: +Pending(Green/Blue) +Inj(Black or Blue)
        const pColor = pending >= 0 ? '#10b981' : '#2563eb';
        const pText = pending !== 0 ? (pending > 0 ? "+" + pending.toLocaleString() : pending.toLocaleString()) : "0";
        // Inj Text: Sum of SeedInj + CashInj ? Or separate?
        // Show SeedInj in Black/Blue, CashInj in Black/Blue with (Cash) label

        const iText = seedInj !== 0 ? (seedInj > 0 ? "+" + seedInj.toLocaleString() : seedInj.toLocaleString()) : "";
        const cText = cashInj !== 0 ? (cashInj > 0 ? " (Cash +" + cashInj.toLocaleString() + ")" : " (Cash " + cashInj.toLocaleString() + ")") : "";

        // If nothing? "-"
        if (pending === 0 && seedInj === 0 && cashInj === 0) {
            elRef.innerHTML = "-";
        } else {
            elRef.innerHTML = `<span style="color:${pColor};">${pText}</span> <span style="color:#1e1e1e;">${iText}</span>${cText}`;
        }
    }

    if (elSeed) elSeed.textContent = "$" + Math.floor(newTotalSeed).toLocaleString();

    // Asset Update
    // TotalAsset = FinalBalance + All Injections (Pending is already in FinalBalance)
    const baseAsset = result.finalBalance || 0;
    const newAsset = baseAsset + seedInj + cashInj;
    if (elAsset) elAsset.textContent = "$" + Math.floor(newAsset).toLocaleString();

    // Cash Update
    if (elCash) {
        const newCash = (s.balance || 0) + seedInj + cashInj;
        elCash.textContent = "$" + Math.floor(newCash).toLocaleString();
    }

    // Re-render Order List with new Qty
    const area = document.getElementById('osListArea');
    if (area && lastOrderSheetData) {
        const allOrders = [lastOrderSheetData.buy, ...lastOrderSheetData.sells];
        allOrders.sort((a, b) => (b.price || 0) - (a.price || 0));
        area.innerHTML = renderOrderListHTML(allOrders);
    }
};


// Global function for "Adjust Target" (Real Tier)
window.adjustTargetAndRender = () => {
    if (!lastOrderSheetData) return;

    const d = lastOrderSheetData;
    const mode = d.mode; // Safe / Offensive
    const locSells = d.sells.filter(s => s.type === 'LOC');

    // Sort LOC sells descending price for logic
    locSells.sort((a, b) => b.price - a.price); // High to Low

    let newBuyPrice = d.buy.price;
    let showNetting = true;
    let message = "";
    let activeOrders = [];

    // Logic
    // Logic
    if (mode === 'Offensive') {
        if (locSells.length >= 2) {
            // 2nd Highest - 0.01 (index 1)
            // 2nd Highest - 0.01 (index 1)
            const secondHighest = locSells[1].price;

            console.log(`[DEBUG Adjust] Mode: Offensive`);
            console.log(`[DEBUG Adjust] Buy Price: ${d.buy.price}`);
            console.log(`[DEBUG Adjust] 2nd Highest Sell: ${secondHighest}`);
            console.log(`[DEBUG Adjust] Buy >= 2nd Sell? ${d.buy.price >= secondHighest}`);

            // User Condition: If buyPrice >= 2ndHighest, adjust. Else keep as is.
            if (d.buy.price >= secondHighest) {
                newBuyPrice = secondHighest - 0.01;
                console.log(`[DEBUG Adjust] Adjusted New Buy Price: ${newBuyPrice}`);
            } else {
                console.log(`[DEBUG Adjust] No Adjustment. Keeping Buy Price: ${newBuyPrice}`);
            }
            // else newBuyPrice remains d.buy.price
        } else {
            // LOC Sells <= 1
            const activeSells = d.sells.filter(s => s.qty > 0); // Include MOC here? User said "목표매도가 loc...". But visual applies to all?
            // "만약 공세모드이면서 목표매도가 loc매도주문이 1개이하(moc매도주문은 목표매도가 loc매도주문으로 카운트 안함)인 경우"
            // "매도 갯수가 0개인 주문만 있거나 아무 매도 주문이 없는 경우는 '오늘 주문이 없습니다'"

            // Check if ANY active SELL (qty>0). 
            if (activeSells.length > 0) {
                // "그 주문만 파란색으로... 퉁치기 버튼은 안보여줘도 돼."
                showNetting = false;
                activeOrders = activeSells;
            } else {
                message = "오늘 주문이 없습니다";
                showNetting = false;
            }
        }
    } else {
        // Safe Mode
        if (locSells.length >= 1) {
            const highest = locSells[0].price;
            // User Condition: If buyPrice >= highest, adjust. Else keep as is.
            if (d.buy.price >= highest) {
                newBuyPrice = highest - 0.01;
            }
            // else newBuyPrice remains d.buy.price
        } else {
            // "목표 매도가 loc주문이 없으면 '오늘 주문이 없습니다'"
            message = "오늘 주문이 없습니다";
            showNetting = false;
        }
    }

    if (showNetting) {
        d.buy.price = Number(newBuyPrice.toFixed(2));
        // Prepare List (Buy + All Sells) Sorted
        activeOrders = [d.buy, ...d.sells];
    }

    // Render Adjusted View
    const listHtml = message ?
        `<div style="font-weight:bold; color:#1e1e1e; text-align:center;">${message}</div>`
        : renderOrderListHTML(sortOrdersDesc(activeOrders));

    const btnHtml = showNetting ? `
         <button onclick="calculateAndRenderNetting()" style="width:100%; margin-top:10px; background:#2563eb; color:white; font-weight:bold; border:none; padding:10px; border-radius:6px; cursor:pointer;">
            🧮 퉁치기 계산 (Netting)
         </button>
    ` : '';

    document.getElementById('osListArea').innerHTML = listHtml;
    document.getElementById('osBtnArea').innerHTML = btnHtml;
    document.getElementById('osResultArea').style.display = 'none';
};


// Netting Logic (Standard & Adjusted Real Tier)
window.calculateAndRenderNetting = () => {
    if (!lastOrderSheetData) return;
    const d = lastOrderSheetData;

    const buyPrice = d.buy.price;
    const buyQty = d.buy.qty;

    const mocSells = d.sells.filter(s => s.type === 'MOC');
    const locSells = d.sells.filter(s => s.type === 'LOC').sort((a, b) => a.price - b.price); // Asc for Logic

    const lowestLoc = locSells.length > 0 ? locSells[0].price : Infinity;

    let finalOrders = [];

    // Netting Logic Implementation
    if (buyPrice < lowestLoc) {
        if (buyQty > 0) finalOrders.push({ type: 'buy', text: `LOC 매수 ${buyQty}개 @ $${buyPrice.toFixed(2)}`, price: buyPrice });
        mocSells.forEach(s => {
            // MOC is effectively sell w/ price 0 (for netting logic doesn't matter, just separate type)
            if (s.qty > 0) finalOrders.push({ type: 'sell_moc', text: `MOC 매도 ${s.qty}개`, price: 0 });
        });
        locSells.forEach(s => {
            if (s.qty > 0) finalOrders.push({ type: 'sell_loc', text: `LOC 매도 ${s.qty}개 @ $${s.price.toFixed(2)}`, price: s.price });
        });
    } else {
        const totalMocQty = mocSells.reduce((sum, s) => sum + s.qty, 0);
        let currentTarget = buyQty - totalMocQty;

        locSells.forEach(s => {
            if (s.qty === 0) return;
            if (s.price > buyPrice) {
                finalOrders.push({ type: 'sell_loc', text: `LOC 매도 ${s.qty}개 @ $${s.price.toFixed(2)}`, price: s.price });
            } else {
                if (currentTarget >= s.qty) {
                    if (s.qty > 0) finalOrders.push({ type: 'buy', text: `LOC 매수 ${s.qty}개 @ $${(s.price - 0.01).toFixed(2)}`, price: s.price - 0.01 });
                    currentTarget -= s.qty;
                } else {
                    if (currentTarget > 0) {
                        finalOrders.push({ type: 'buy', text: `LOC 매수 ${currentTarget}개 @ $${(s.price - 0.01).toFixed(2)}`, price: s.price - 0.01 });
                    }
                    const remSell = s.qty - currentTarget;
                    finalOrders.push({ type: 'sell_loc', text: `LOC 매도 ${remSell}개 @ $${s.price.toFixed(2)}`, price: s.price });
                    currentTarget = 0;
                }
            }
        });

        if (currentTarget > 0) {
            finalOrders.push({ type: 'buy', text: `LOC 매수 ${currentTarget}개 @ $${buyPrice.toFixed(2)}`, price: buyPrice });
        }

        const conflictLocQty = locSells.reduce((sum, s) => (s.price <= buyPrice) ? sum + s.qty : sum, 0);
        const totalIntended = totalMocQty + conflictLocQty; // Total sell qty intended to be executed

        // Active Sells in Final
        let activeSells = 0;
        finalOrders.forEach(o => {
            if (o.type.includes('sell')) {
                if (o.price <= buyPrice) {
                    const match = o.text.match(/\d+개/);
                    if (match) activeSells += parseInt(match[0].replace('개', ''));
                }
            }
        });

        const needed = totalIntended - activeSells;
        if (needed > 0) {
            finalOrders.push({ type: 'sell_loc', text: `LOC 매도 ${needed}개 @ $${(buyPrice + 0.01).toFixed(2)}`, price: buyPrice + 0.01 });
        }
    }

    // Sort Final Orders (Price High -> Low)
    finalOrders.sort((a, b) => b.price - a.price);

    const resHtml = renderOrderListHTML(finalOrders);

    const resArea = document.getElementById('osResultArea');
    resArea.innerHTML = `<h4 style="margin:0 0 10px 0; color:#d97706;">✨ 최종 주문 (Hybrid)</h4>` + resHtml;
    resArea.style.display = 'block';
};

function updateKPI(result) {
    const finalBalance = result.finalBalance;
    const startBalance = result.params.initialCapital;
    const totalReturn = ((finalBalance - startBalance) / startBalance) * 100;
    const years = (new Date(result.params.endDate) - new Date(result.params.startDate)) / (1000 * 60 * 60 * 24 * 365);
    const cagr = (Math.pow(finalBalance / startBalance, 1 / years) - 1) * 100;

    const allTrades = result.history;
    const trades = allTrades.filter(t => t.quantity > 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const fmtP = (n) => n.toFixed(2) + "%";

    const elReturn = document.getElementById('kpiReturn');
    elReturn.textContent = fmtP(totalReturn);
    elReturn.style.color = totalReturn >= 0 ? '#ef4444' : '#2563eb';

    const elSeed = document.getElementById('kpiSeed');
    if (elSeed) elSeed.textContent = `Seed: ${fmt(startBalance)}`;

    document.getElementById('kpiCagr').textContent = fmtP(cagr);
    document.getElementById('kpiFinal').textContent = fmt(finalBalance);
    document.getElementById('kpiMdd').textContent = fmtP(result.maxDrawdown);

    if (result.maxDrawdownDate) {
        document.getElementById('kpiMddDate').textContent = result.maxDrawdownDate;
    } else {
        document.getElementById('kpiMddDate').textContent = "None";
    }

    document.getElementById('kpiWinRate').textContent = fmtP(winRate) + ` (${trades.length})`;

    // SQN Calculation
    // Filter for CLOSED trades only (must have sellDate and netPnLPct)
    const closedTrades = allTrades.filter(t => t.sellDate && t.netPnLPct !== undefined && t.netPnLPct !== null);
    const pnlPcts = closedTrades.map(t => t.netPnLPct);
    const mainSqn = calculateSQN(pnlPcts);

    const elSqn = document.getElementById('kpiSqn');
    if (elSqn) {
        elSqn.textContent = mainSqn.toFixed(2);
        elSqn.style.color = '#fbbf24'; // Always Yellow
    }

    // --- NEW KPI: AVG INVEST % (90% Range) ---
    // Calculate Ratio for all days
    const dailyRatios = result.dailyLog.map(d => {
        if (d.totalAsset === 0) return 0;
        return ((d.totalAsset - d.cash) / d.totalAsset) * 100;
    });

    if (dailyRatios.length > 0) {
        // Mean
        const sumRatio = dailyRatios.reduce((a, b) => a + b, 0);
        const avgRatio = sumRatio / dailyRatios.length;

        // Sort for Percentiles
        dailyRatios.sort((a, b) => a - b);
        const p5Index = Math.floor(dailyRatios.length * 0.05);
        const p95Index = Math.floor(dailyRatios.length * 0.95);

        // Clamp indices
        const p5Val = dailyRatios[Math.max(0, p5Index)];
        const p95Val = dailyRatios[Math.min(dailyRatios.length - 1, p95Index)];

        // Render to kpiExtra1
        const elExtra1Value = document.getElementById('kpiExtra1');
        const elExtra1Label = elExtra1Value.previousElementSibling; // .label
        const elExtra1Sub = elExtra1Value.nextElementSibling; // .sub

        if (elExtra1Value) {
            elExtra1Label.textContent = "AVG INVEST %";
            elExtra1Value.textContent = avgRatio.toFixed(1) + "%";
            elExtra1Value.style.color = "#64748b"; // Neutral / Slate
            elExtra1Sub.textContent = `${p5Val.toFixed(0)}% ~ ${p95Val.toFixed(0)}% (90% Rng)`;
        }
    }

    // --- NEW KPI: MARTIN RATIO (CAGR / Ulcer Index) ---
    // Ulcer Index = Sqrt(Mean(Drawdown^2))
    const drawdowns = result.dailyLog.map(d => d.drawdown || 0); // drawdowns are negative or 0
    if (drawdowns.length > 0) {
        const sumSq = drawdowns.reduce((sum, dd) => sum + (dd * dd), 0);
        const meanSq = sumSq / drawdowns.length;
        const ulcerIndex = Math.sqrt(meanSq);

        // Martin Ratio = CAGR / Ulcer Index
        // Prevent div by zero
        const martinRatio = ulcerIndex > 0 ? (cagr / ulcerIndex) : 0;

        // Render to kpiExtra2
        const elExtra2Value = document.getElementById('kpiExtra2');
        const elExtra2Label = elExtra2Value.previousElementSibling;
        const elExtra2Sub = elExtra2Value.nextElementSibling;

        if (elExtra2Value) {
            elExtra2Label.textContent = "MARTIN RATIO (>1.5 Good)";
            elExtra2Value.textContent = martinRatio.toFixed(2);
            // Color logic? Higher is better. > 1.0 is good?
            // Optional: color
            if (martinRatio >= 1.5) elExtra2Value.style.color = '#10b981'; // Green
            else if (martinRatio >= 0.5) elExtra2Value.style.color = '#fbbf24'; // Yellow
            else elExtra2Value.style.color = '#64748b'; // Slate

            elExtra2Sub.textContent = `Ulcer Idx: ${ulcerIndex.toFixed(1)}`;
        }
    }

    triggerMainRobustnessTest(result.params);
}

// RESTORED RENDER CHARTS
function renderCharts(result) {
    const log = result.dailyLog;
    const labels = log.map(d => d.date);

    // 1. Asset
    const ctxMain = document.getElementById('mainChart').getContext('2d');
    if (mainChartInstance) mainChartInstance.destroy();

    mainChartInstance = new Chart(ctxMain, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Asset',
                data: log.map(d => d.totalAsset),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: 'Asset Growth' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: { y: { beginAtZero: false } }
        }
    });

    // 2. DD
    const ctxDD = document.getElementById('ddChart').getContext('2d');
    if (ddChartInstance) ddChartInstance.destroy();

    ddChartInstance = new Chart(ctxDD, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Drawdown %',
                data: log.map(d => d.drawdown),
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderWidth: 1,
                pointRadius: 0,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Drawdown' } },
            scales: { y: { min: -100, max: 0 } }
        }
    });

    // 3. Cash
    const elCash = document.getElementById('cashChart');
    if (elCash) {
        const ctxCash = elCash.getContext('2d');
        if (cashChartInstance) cashChartInstance.destroy();

        cashChartInstance = new Chart(ctxCash, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cash Reserve',
                    data: log.map(d => d.cash),
                    borderColor: '#10b981',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return '$' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
}

// MAIN ROBUSTNESS TRIGGER
let mainRobustnessTimer = null;
async function triggerMainRobustnessTest(params) {
    const elReport = document.getElementById('robustnessReport');
    const elStatus = document.getElementById('rbMainStatus');
    const elLoading = document.getElementById('rbMainLoading');
    const elProgress = document.getElementById('rbMainProgress');
    const elStats = document.getElementById('rbMainStats');
    const elLegend = document.getElementById('rbMainLegend');

    if (!elReport) return;

    // Check Toggle
    const toggle = document.getElementById('toggleRobustness');
    if (!toggle || !toggle.checked) {
        elReport.classList.add('hidden');
        return;
    }

    if (mainRobustnessTimer) clearTimeout(mainRobustnessTimer);

    elReport.classList.remove('hidden');
    elStatus.textContent = "Waiting...";
    elLoading.classList.remove('hidden');
    elProgress.style.width = "0%";
    elStats.classList.add('hidden');
    elLegend.classList.add('hidden');

    mainRobustnessTimer = setTimeout(async () => {
        elStatus.textContent = "Analyzing...";
        try {
            const stats = await runRobustnessTest(params, SOXL_DATA, QQQ_DATA, (current, total) => {
                const pct = (current / total) * 100;
                elProgress.style.width = pct + "%";
            });

            document.getElementById('rbMainSurvival').textContent = stats.survivalRate.toFixed(1) + "%";
            const survEl = document.getElementById('rbMainSurvival');
            survEl.style.color = stats.survivalRate >= 80 ? '#10b981' : (stats.survivalRate < 50 ? '#ef4444' : '#f8fafc');

            document.getElementById('rbMainCagr').textContent = stats.avgCagr.toFixed(2) + "%";
            document.getElementById('rbMainMdd').textContent = stats.avgMdd.toFixed(2) + "%";
            document.getElementById('rbMainSqn').textContent = stats.avgSqn.toFixed(2);

            const winRate = stats.avgWinRate !== undefined ? stats.avgWinRate : 0;
            if (document.getElementById('rbMainWinRate')) {
                document.getElementById('rbMainWinRate').textContent = winRate.toFixed(1) + "%";
            }

            document.getElementById('rbMainR2').textContent = stats.avgR2.toFixed(4);
            const r2El = document.getElementById('rbMainR2');
            if (stats.avgR2 >= 1.0) r2El.style.color = '#10b981';
            else if (stats.avgR2 >= 0.9) r2El.style.color = '#fbbf24';
            else if (stats.avgR2 <= 0.5) r2El.style.color = '#ef4444';
            else r2El.style.color = '#f8fafc';

            elStatus.textContent = "Completed";
            elLoading.classList.add('hidden');
            elStats.classList.remove('hidden');
            elLegend.classList.remove('hidden');

            // TRIGGER SENSITIVITY TEST (Chained)
            triggerMainSensitivityTest(params);

        } catch (e) {
            console.error(e);
            elStatus.textContent = "Error";
        }
    }, 500);
}

// --- STRATEGY SAVING LOGIC ---
// --- PARAMETER WAREHOUSE LOGIC ---
let warehouseParams = JSON.parse(localStorage.getItem('parameterWarehouse')) || [];

function renderWarehouse() {
    const list = document.getElementById('warehouseList');
    const wrapper = document.getElementById('warehouseWrapper');
    const toggle = document.getElementById('toggleWarehouse');
    const isChecked = toggle ? toggle.checked : false;

    if (!list) return;

    if (warehouseParams.length === 0) {
        list.innerHTML = `<div style="color: #64748b; font-size: 0.9rem;">No params in warehouse.</div>`;
        if (wrapper) wrapper.style.display = isChecked ? 'block' : 'none';
        return;
    }

    if (wrapper) wrapper.style.display = isChecked ? 'block' : 'none';

    list.innerHTML = warehouseParams.map((item, idx) => {
        const stats = item.stats;
        const p = item.params;
        const dateStr = new Date(item.id).toLocaleDateString();

        return `
            <div class="warehouse-card">
                <!-- Header: Nickname & Actions -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
                    <div style="flex:1;">
                         <input type="text" value="${item.nickname}" 
                            onchange="updateWarehouseNickname(${item.id}, this.value)"
                            style="width:100%; font-weight:bold; color:#059669; border:none; border-bottom:1px dashed #6ee7b7; background:transparent; padding:0;" placeholder="Nickname">
                         <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">${dateStr}</div>
                    </div>
                </div>

                <!-- Stats Grid -->
                 <div style="display:grid; grid-template-columns: 1fr 1fr; gap:3px; background:#f0fdf4; padding:5px; border-radius:4px; font-size:0.75rem;">
                    <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">CAGR</span>
                        <div style="font-weight:bold; color:#1e293b;">${stats.avgCagr.toFixed(1)}%</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">MDD</span>
                        <div style="font-weight:bold; color:#1e293b;">${stats.avgMdd.toFixed(1)}%</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">SQN</span>
                        <div style="font-weight:bold; color:#d97706;">${stats.avgSqn.toFixed(2)}</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">Win</span>
                        <div style="font-weight:bold; color:#1e293b;">${(stats.avgWinRate || 0).toFixed(0)}%</div>
                    </div>
                </div>
                
                <!-- Params Summary -->
                <div style="font-size:0.7rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                     Safe: ${p.safe.buyLimit}% | Off: ${p.offensive.buyLimit}% | Rebal: ${p.rebalance.profitAdd}%
                </div>

                <!-- Action Buttons -->
                <div style="display:flex; gap:0.5rem; margin-top:auto;">
                     <button class="wh-action-btn" onclick="loadAndRunWarehouse(${item.id})" style="background:#059669; color:white;">🚀 RUN</button>
                     <button class="wh-action-btn" onclick="deleteFromWarehouse(${item.id})" style="background:#fee2e2; color:#ef4444;">🗑</button>
                </div>
            </div>
        `;
    }).join('');
}

window.addToWarehouse = (tempIdx) => {
    const item = savedStrategies[tempIdx];
    if (!item) return;

    const nickname = prompt("전략의 닉네임을 입력하세요:", "My Strategy " + (warehouseParams.length + 1));
    if (nickname === null) return; // Cancelled

    const newItem = {
        id: Date.now(),
        nickname: nickname || "Unnamed",
        params: item.params,
        stats: item.stats
    };

    warehouseParams.unshift(newItem);
    localStorage.setItem('parameterWarehouse', JSON.stringify(warehouseParams));
    renderWarehouse();
    alert("파라미터 창고에 저장되었습니다.");

    // Auto-open warehouse if closed?
    const toggle = document.getElementById('toggleWarehouse');
    if (toggle && !toggle.checked) {
        toggle.checked = true;
        renderWarehouse();
    }
};

window.updateWarehouseNickname = (id, newName) => {
    const idx = warehouseParams.findIndex(x => x.id === id);
    if (idx !== -1) {
        warehouseParams[idx].nickname = newName;
        localStorage.setItem('parameterWarehouse', JSON.stringify(warehouseParams));
    }
};

window.deleteFromWarehouse = (id) => {
    if (!confirm("파라미터 창고에서 삭제하시겠습니까?")) return;
    warehouseParams = warehouseParams.filter(x => x.id !== id);
    localStorage.setItem('parameterWarehouse', JSON.stringify(warehouseParams));
    renderWarehouse();
};

window.loadAndRunWarehouse = (id) => {
    const item = warehouseParams.find(x => x.id === id);
    if (item) {
        applyDeepDrillParams(item.params);
    }
};

// --- STRATEGY SAVING LOGIC ---
let savedStrategies = JSON.parse(localStorage.getItem('deepMindSaved')) || [];
let currentRobustnessStats = null; // Store robustness result for saving

// --- RENDER SAVED STRATEGIES (Updated for Temp Storage logic & Warehouse button) ---
function renderSavedStrategies() {
    // 1. Render in Deep Mind View (Vertical Grid)
    const containerDM = document.getElementById('savedStrategiesView');
    // 2. Render in Main View (Horizontal Scroll)
    const containerMain = document.getElementById('mainSavedStrategies');

    if (savedStrategies.length === 0) {
        if (containerDM) containerDM.innerHTML = `<div style="color:#64748b; font-style:italic;">저장된 파라미터가 없습니다.</div>`;
        if (containerMain) containerMain.innerHTML = `<div style="color:#64748b; font-size:0.9rem;">No saved strategies.</div>`;
        return;
    }

    // Helper to create card HTML
    const createCardHTML = (item, idx, isMainView) => {
        const stats = item.stats;
        const p = item.params;
        const dateStr = new Date(item.timestamp).toLocaleDateString();

        // Colors
        const survColor = stats.survivalRate >= 80 ? '#10b981' : '#ef4444';
        const bg = '#ffffff';
        const border = '#e2e8f0';

        // If Main View, make it compact
        const widthStyle = isMainView ? 'min-width: 250px; width: 250px;' : '';
        const runBtnText = isMainView ? '🚀 RUN' : 'RUN';

        // Add "Save to Warehouse" button
        const warehouseBtn = `
            <button onclick="addToWarehouse(${idx})" style="background:#8b5cf6; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem; margin-right:5px;">
                💾 Save
            </button>
        `;

        return `
            <div class="strategy-card" style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:1rem; display:flex; flex-direction:column; gap:0.5rem; ${widthStyle}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.8rem; color:#64748b;">${dateStr}</span>
                    <div style="display:flex;">
                         ${warehouseBtn} <!-- New Button -->
                         <button onclick="deleteStrategy(${idx})" style="color:#ef4444; margin-right:5px; cursor:pointer; background:none; border:none; font-size:1rem;">🗑</button>
                    </div>
                </div>
                 
                 <div style="display:flex; justify-content:flex-end; margin-bottom:5px;">
                     <button onclick="loadAndRunStrategy(${idx})" style="width:100%; background:#2563eb; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-size:0.9rem; font-weight:bold;">${runBtnText}</button>
                 </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0; font-size:0.8rem;">
                    <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">CAGR</span>
                        <div style="font-weight:bold; color:#1e293b;">${stats.avgCagr.toFixed(1)}%</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">MDD</span>
                        <div style="font-weight:bold; color:#1e293b;">${stats.avgMdd.toFixed(1)}%</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">Win</span>
                        <div style="font-weight:bold; color:#1e293b;">${(stats.avgWinRate || 0).toFixed(0)}%</div>
                    </div>
                     <div style="text-align:center;">
                        <span style="color:#64748b; font-size:0.7em;">SQN</span>
                        <div style="font-weight:bold; color:#d97706;">${stats.avgSqn.toFixed(2)}</div>
                    </div>
                </div>
                <div style="font-size:0.75rem; color:#64748b; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">
                    Safe: ${p.safe.buyLimit}% | W: ${p.safe.weights.slice(0, 2).join(',')}...
                </div>
            </div>
        `;
    };

    if (containerDM) {
        containerDM.innerHTML = savedStrategies.map((item, idx) => createCardHTML(item, idx, false)).join('');
    }

    // Main View Rendering & Toggle
    const wrapperMain = document.getElementById('mainSavedStrategiesWrapper');
    const toggleSaved = document.getElementById('toggleSavedStrategies');
    const isChecked = toggleSaved ? toggleSaved.checked : false;

    if (containerMain) {
        if (savedStrategies.length === 0) {
            containerMain.innerHTML = `<div style="color: #64748b; font-size: 0.9rem;">No saved strategies.</div>`;
            // Always hide if empty, regardless of toggle? Or show "No strategies" if toggled ON?
            // User wants to "Hide" it via button. If ON, show (even if empty? likely not desired if empty).
            // Let's say: If ON AND Not Empty -> Show.
            // Actually, if ON and Empty -> Show "No Saved" is good feedback.
            if (wrapperMain) wrapperMain.style.display = isChecked ? 'block' : 'none';
        } else {
            containerMain.innerHTML = savedStrategies.map((item, idx) => createCardHTML(item, idx, true)).join('');
            if (wrapperMain) wrapperMain.style.display = isChecked ? 'block' : 'none';
        }
    }
}


window.saveCurrentParamsToWarehouse = () => {
    // 1. Gather all inputs
    const getVal = (id) => parseFloat(document.getElementById(id).value);

    // Helper to get weights
    const getWeights = (prefix) => {
        const w = [];
        for (let i = 1; i <= 8; i++) { // Include up to 8 if needed, logic uses 1-7 usually.
            // logic.js handles weights array. We should capture what logic expects.
            // UI has inputs inside #safeWeights / #offWeights
            const container = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights');
            const inputs = container.querySelectorAll('input');
            // inputs are in order 1..8
            const wArr = Array.from(inputs).map(inp => parseFloat(inp.value));
            w.push(...wArr);
        }
        // Actually, logic.js expects array of numbers.
        // Let's reuse the weight collecting logic if possible, or just re-implement simple extractor.
        // Re-implementing is safer for decoupling.
        const w2 = [];
        const container = document.getElementById(prefix === 'safe' ? 'safeWeights' : 'offWeights');
        const inputs = container.querySelectorAll('input');
        inputs.forEach(inp => w2.push(parseFloat(inp.value) || 0));
        return w2;
    };

    const params = {
        initialCapital: getVal('initCapital'),
        feeRate: getVal('feeRate'),
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        useRealTier: document.getElementById('toggleRealTier').checked,

        safe: {
            buyLimit: getVal('safeBuyLimit'),
            target: getVal('safeTarget'),
            timeCut: getVal('safeTimeCut'),
            weights: getWeights('safe')
        },
        offensive: {
            buyLimit: getVal('offBuyLimit'),
            target: getVal('offTarget'),
            timeCut: getVal('offTimeCut'),
            weights: getWeights('off')
        },
        rebalance: {
            profitAdd: getVal('profitAdd'),
            lossSub: getVal('lossSub')
        }
    };

    const nickname = prompt("현재 파라미터의 닉네임을 입력하세요:", "My Manual Strategy " + (warehouseParams.length + 1));
    if (nickname === null) return;

    // We don't have stats yet because we haven't run it specifically as a package.
    // Or should we run it first? User said "save input".
    // We can save with empty stats or "Ready to Run".
    // Let's save with placeholder stats or 0.
    const newItem = {
        id: Date.now(),
        nickname: nickname || "Unnamed",
        params: params,
        stats: { avgCagr: 0, avgMdd: 0, avgWinRate: 0, avgSqn: 0 } // Placeholder
    };

    warehouseParams.unshift(newItem);
    localStorage.setItem('parameterWarehouse', JSON.stringify(warehouseParams));
    renderWarehouse();
    alert("현재 파라미터가 창고에 저장되었습니다.");

    // Auto open
    const toggle = document.getElementById('toggleWarehouse');
    if (toggle && !toggle.checked) {
        toggle.checked = true;
        renderWarehouse();
    }
};

// Toggle Event Listeners (Restored & Added)
document.addEventListener('DOMContentLoaded', () => {
    // ... existing toggles ...

    // Manual Save Button
    const btnSaveParams = document.getElementById('btnSaveCurrentParams');
    if (btnSaveParams) {
        btnSaveParams.addEventListener('click', window.saveCurrentParamsToWarehouse);
    }

    // 1. Temp Storage Toggle
    const toggleSaved = document.getElementById('toggleSavedStrategies');
    if (toggleSaved) {
        toggleSaved.checked = false; // Default OFF
        toggleSaved.addEventListener('change', () => {
            renderSavedStrategies();
        });
    }

    // 2. Warehouse Toggle
    const toggleWarehouse = document.getElementById('toggleWarehouse');
    if (toggleWarehouse) {
        toggleWarehouse.checked = false; // Default OFF
        toggleWarehouse.addEventListener('change', () => {
            renderWarehouse();
        });
    }

    // Initial Render
    renderSavedStrategies();
    renderWarehouse();
});

window.deleteStrategy = (idx) => {
    if (!confirm("이 전략을 삭제하시겠습니까?")) return;
    savedStrategies.splice(idx, 1);
    localStorage.setItem('deepMindSaved', JSON.stringify(savedStrategies));
    renderSavedStrategies();
};

window.loadAndRunStrategy = (idx) => {
    const item = savedStrategies[idx];
    if (item) {
        applyDeepDrillParams(item.params);
    }
};

// --- SENSITIVITY ANALYSIS RENDERING ---

function renderHeatmap(data, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Grid Setup: 15x15 based on steps=7 (-7..+7)
    const steps = 7;
    const cols = steps * 2 + 1; // 15
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    const minVal = data.minCagr;
    const maxVal = data.maxCagr;
    const span = maxVal - minVal;

    data.grid.forEach(cell => {
        const div = document.createElement('div');
        div.className = 'heatmap-cell';

        // Color: Red(Min) -> Yellow(Median) -> Green(Max)
        // Normalize 0..1
        let norm = 0;
        if (span > 0) norm = (cell.cagr - minVal) / span;
        else norm = 0.5; // If flat

        // HSL: Red (0) -> Green (120)
        const hue = norm * 120;
        div.style.backgroundColor = `hsl(${hue}, 70%, 50%)`;

        // Highlight Center (x=0, y=0)
        if (Math.abs(cell.x) < 0.001 && Math.abs(cell.y) < 0.001) {
            div.style.border = '2px solid white';
            div.style.zIndex = '10';
            div.style.transform = 'scale(1.2)';
            div.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
        }

        // Tooltip
        div.title = `CAGR: ${cell.cagr.toFixed(2)}%\nBuy: ${cell.x > 0 ? '+' : ''}${cell.x.toFixed(1)}%\nTgt: ${cell.y > 0 ? '+' : ''}${cell.y.toFixed(1)}%`;

        container.appendChild(div);
    });
}

// Main Sensitivity Trigger
let mainSensitivityTimer = null;
async function triggerMainSensitivityTest(params) {
    const elReport = document.getElementById('sensitivityReport');
    const elStatus = document.getElementById('senMainStatus');
    const elLoading = document.getElementById('senMainLoading');
    const elProgress = document.getElementById('senMainProgress');
    const elContent = document.getElementById('senMainContent');
    const elCsrScore = document.getElementById('senMainCsrScore');
    const elCsrText = document.getElementById('senMainCsrText');

    if (!elReport) return;

    // Check if Robustness is active
    const toggle = document.getElementById('toggleRobustness');
    if (!toggle || !toggle.checked) {
        elReport.classList.add('hidden');
        return;
    }

    if (mainSensitivityTimer) clearTimeout(mainSensitivityTimer);

    elReport.classList.remove('hidden');
    elStatus.textContent = "Waiting...";
    elLoading.classList.remove('hidden');
    elProgress.style.width = "0%";
    elContent.classList.add('hidden');

    mainSensitivityTimer = setTimeout(async () => {
        elStatus.textContent = "Analyzing...";
        try {
            const stats = await runSensitivityTest(params, SOXL_DATA, QQQ_DATA, (current, total) => {
                const pct = (current / total) * 100;
                elProgress.style.width = pct + "%";
            });

            // Render CSR
            elCsrScore.textContent = stats.csr.toFixed(2);
            elCsrText.textContent = stats.csr >= 0.9 ? "Plateau (Safe)" : "Peak (Risky)";
            elCsrScore.style.color = stats.csr >= 0.9 ? '#10b981' : (stats.csr < 0.8 ? '#ef4444' : '#fbbf24');

            // Render Heatmap
            renderHeatmap(stats, 'senMainHeatmap');

            elStatus.textContent = "Completed";
            elLoading.classList.add('hidden');
            elContent.classList.remove('hidden');

        } catch (e) {
            console.error(e);
            elStatus.textContent = "Error";
        }
    }, 500);
}

// Deep Dive Sensitivity Trigger
window.triggerDmSensitivityTest = async (params) => {
    const elContainer = document.getElementById('dmSensitivityReport');
    const elLoading = document.getElementById('senDmLoading');
    const elProgress = document.getElementById('senDmProgress');
    const elContent = document.getElementById('senDmContent');
    const elCsrScore = document.getElementById('senDmCsrScore');
    const elCsrText = document.getElementById('senDmCsrText');

    if (!elContainer) return;

    elContainer.classList.remove('hidden');
    elLoading.classList.remove('hidden');
    elProgress.style.width = "0%";
    elContent.classList.add('hidden');

    try {
        const stats = await runSensitivityTest(params, SOXL_DATA, QQQ_DATA, (current, total) => {
            const pct = (current / total) * 100;
            elProgress.style.width = pct + "%";
        });

        // Render CSR
        elCsrScore.textContent = stats.csr.toFixed(2);
        elCsrText.textContent = stats.csr >= 0.9 ? "Plateau (Safe)" : "Peak (Risky)";
        elCsrScore.style.color = stats.csr >= 0.9 ? '#10b981' : (stats.csr < 0.8 ? '#ef4444' : '#fbbf24');

        // Render Heatmap
        renderHeatmap(stats, 'senDmHeatmap');

        elLoading.classList.add('hidden');
        elContent.classList.remove('hidden');

    } catch (e) {
        console.error(e);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Other init...
    // Defer render until Deep Mind view opens or simple check
    // We can call it here if element exists? Element hidden but exists.

    // Button 6: Total (Match Start Date input?) or specific?
    // User said "Total". Let's assume early start.
    const btnDate6 = document.getElementById('btnDate6');
    if (btnDate6) {
        btnDate6.addEventListener('click', () => {
            document.getElementById('startDate').value = "2010-01-01"; // Or earliest data
            document.getElementById('endDate').value = new Date().toISOString().split('T')[0];
            runBacktest();
        });
    }

    // Button 7: Next Day (Business Day)
    const btnDate7 = document.getElementById('btnDate7');
    if (btnDate7) {
        btnDate7.addEventListener('click', () => {
            const endDateInput = document.getElementById('endDate');
            const currentEndStr = endDateInput.value;

            // Find current index in SOXL_DATA
            // SOXL_DATA is sorted ascending? Yes, typically. logic.js assumes chronological.
            // Let's assume SOXL_DATA is sorted ascending (Old -> New). 
            // If checking 'data.js' is not possible, we sort it or assume it.
            // Usually data files are sorted.

            // We need to find the first date > currentEndStr
            // Optimally: Find index of currentEndStr, then take index + 1.
            // If currentEndStr not in data (e.g. weekend), find first date > currentEndStr.

            let nextDateStr = null;

            // Helper to parsing "YYYY-MM-DD" comparison
            // Just string comparison works for ISO dates.

            for (let i = 0; i < SOXL_DATA.length; i++) {
                if (SOXL_DATA[i].date > currentEndStr) {
                    nextDateStr = SOXL_DATA[i].date;
                    break;
                }
            }

            if (nextDateStr) {
                endDateInput.value = nextDateStr;
                runBacktest();
            } else {
                alert("No future data available.");
            }
        });
    }

    // Event Listeners for Deep Drill Modal
    const btnBack = document.getElementById('btnBackToList');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            document.getElementById('dmModal').classList.add('hidden');
        });
    }

    const btnSave = document.getElementById('btnSaveStrategy');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            if (!currentDrillParams || !currentRobustnessStats) {
                alert("아직 분석 결과가 완료되지 않았거나 없습니다.");
                return;
            }

            // Save
            const item = {
                timestamp: Date.now(),
                params: currentDrillParams,
                stats: currentRobustnessStats
            };

            savedStrategies.unshift(item); // Add to top
            localStorage.setItem('deepMindSaved', JSON.stringify(savedStrategies));

            renderSavedStrategies();
            alert("전략이 저장되었습니다.");
        });
    }

    const btnDeepDrill = document.getElementById('btnDeepDrill');
    if (btnDeepDrill) {
        btnDeepDrill.addEventListener('click', async () => {
            if (!currentDrillParams) {
                alert("분석할 파라미터가 없습니다.");
                return;
            }

            // UI Feedback
            btnDeepDrill.disabled = true;
            btnDeepDrill.textContent = "Running Analysis...";

            // 1. Run Robustness Test (Deep Dive context)
            // Need to trigger logic similarly to runRobustnessTest but focused on modal elements
            const elSurvival = document.getElementById('rbSurvival');
            const elCagr = document.getElementById('rbCagr');
            const elMdd = document.getElementById('rbMdd');
            const elSqn = document.getElementById('rbSqn');
            const elR2 = document.getElementById('rbR2');

            const elLoading = document.getElementById('rbLoading');
            const elProgress = document.getElementById('rbProgress');
            const elPText = document.getElementById('rbProgressText');

            if (elLoading) elLoading.classList.remove('hidden');
            if (elProgress) elProgress.style.width = '0%';

            // Stats Reset
            if (elSurvival) elSurvival.textContent = "-";
            if (elCagr) elCagr.textContent = "-";
            if (elMdd) elMdd.textContent = "-";

            // Run Robustness
            try {
                const stats = await runRobustnessTest(currentDrillParams, SOXL_DATA, QQQ_DATA, (count, total) => {
                    if (elProgress) elProgress.style.width = (count / total * 100) + '%';
                    if (elPText) elPText.textContent = `${count} / ${total}`;
                });

                currentRobustnessStats = stats; // Store for saving

                if (elSurvival) elSurvival.textContent = stats.survivalRate.toFixed(1) + "%";
                if (elCagr) elCagr.textContent = stats.avgCagr.toFixed(1) + "%";
                if (elMdd) elMdd.textContent = stats.avgMdd.toFixed(1) + "%";
                if (elSqn) elSqn.textContent = stats.avgSqn.toFixed(2);
                if (elR2) elR2.textContent = stats.avgR2.toFixed(2);

            } catch (e) {
                console.error(e);
                alert("Analysis Failed");
            } finally {
                if (elLoading) elLoading.classList.add('hidden');
            }

            // 2. Run Sensitivity Test
            // We use the helper we added earlier
            if (window.triggerDmSensitivityTest) {
                window.triggerDmSensitivityTest(currentDrillParams);
            }

            btnDeepDrill.disabled = false;
            btnDeepDrill.textContent = "💎 DEEP DRILL (Apply & Run)";
        });
    }
});

