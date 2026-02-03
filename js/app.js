// app.js
import { runSimulation } from './logic.js';
import { SOXL_DATA, QQQ_DATA } from './data.js';

let mainChartInstance = null;
let ddChartInstance = null;
let cashChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // Set End Date to 2025-11-26 (User Request)
    const specificDate = "2025-11-26";
    document.getElementById('endDate').value = specificDate;

    // Initial Run on Load
    runBacktest();

    // Event Listener
    document.getElementById('runBtn').addEventListener('click', runBacktest);

    // Sidebar Toggle
    document.getElementById('sidebarToggle').addEventListener('click', () => {
        document.querySelector('main').classList.toggle('sidebar-hidden');
    });

    // Real Tier Toggle Re-run
    document.getElementById('toggleRealTier').addEventListener('change', runBacktest);

    // Date Range Quick Select
    const setDates = (mode) => {
        const end = new Date();
        end.setDate(end.getDate() - 1); // Yesterday
        const endDateStr = end.toISOString().split('T')[0];

        let start = new Date(end); // Default base

        if (mode === 1) {
            // This Year (Jan 1)
            start = new Date(end.getFullYear(), 0, 1);
            // Adjust to local time (or just simple string construction)
            // Note: 'new Date(2025, 0, 1)' is local. 
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

        // Handle timezone offset for Start Date string
        // Simple trick: YYYY-MM-DD manually or use library. 
        // Using local ISO string equivalent:
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
    // Use setTimeout to override browser's form state restoration
    setTimeout(() => {
        toggleCash.checked = false;
        toggleAsset.checked = false;
        toggleDD.checked = false;

        updateChartVisibility(toggleCash, containerCash);
        updateChartVisibility(toggleAsset, containerAsset);
        updateChartVisibility(toggleDD, containerDD);
    }, 0);
});

function getWeights(containerId) {
    const inputs = document.querySelectorAll(`#${containerId} input`);
    return Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
}

function runBacktest() {
    const rawFee = document.getElementById('feeRate').value;
    const params = {
        initialCapital: parseFloat(document.getElementById('initCapital').value),
        feeRate: parseFloat(document.getElementById('feeRate').value) || 0,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        useRealTier: document.getElementById('toggleRealTier').checked, // New Param

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

    console.log("Running Phase 2 Sim:", params);

    try {
        // 2. Run Engine
        const result = runSimulation(SOXL_DATA, QQQ_DATA, params);

        // 3. Update UI
        updateKPI(result);
        renderCharts(result);
        // Duplicate removed
        renderTable(result.ledger);
        renderOrderSheet(result);
    } catch (error) {
        console.error("Simulation Error:", error);
        alert("오류가 발생했습니다:\n" + error.message);
    }
}

// Order Sheet Toggle
document.getElementById('btnOrderSheet').addEventListener('click', () => {
    const area = document.getElementById('orderSheetArea');
    area.classList.toggle('hidden');
});

function renderOrderSheet(result) {
    console.log("Rendering Order Sheet... V1.2 (Debug Enabled)");
    // alert("DEBUG: Order Sheet Code is Running!"); // Temporary Debug
    const state = result.finalState;
    const params = result.params;
    const area = document.getElementById('orderSheetArea');

    if (!state) return;

    // 4. Render HTML
    const fmtC = (n) => "$" + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const fmtI = (n) => n.toLocaleString();

    // 0. Define Mode First
    const modeName = state.mode; // "Safe" or "Offensive"
    const modeParams = modeName === "Safe" ? params.safe : params.offensive;

    // --- ADVANCED LOGIC: REAL TIER ---
    // Override Weights & Logic if Real Tier is Active
    const useRealTier = params.useRealTier;
    const isRealTier = params.useRealTier;

    // 1. Determine Weights
    // Default: use modeParams.weights
    let weights = modeParams.weights;

    // Real Tier Overrides
    if (isRealTier) {
        if (modeName === "Safe") {
            // Tier 1=0, 2~6=20, 7=0
            weights = [0, 20, 20, 20, 20, 20, 0, 0];
        } else {
            // Offensive: Tier 1~2=0, 3~7=20
            weights = [0, 0, 20, 20, 20, 20, 20, 0];
        }
    }

    // 2. Buy Calc
    // Tier is Holdings + 1
    const nextTier = state.holdings.length + 1;
    const weightPct = weights[nextTier - 1] || 0;

    // Initial LOC Price Calculation
    // (100 + LOC)% 
    let locRate = (modeParams.buyLimit / 100);
    let initialLocPrice = state.lastClose * (1 + locRate);

    // 2. Buy Order (LOC)
    // Note: This matches "Real Tier" logic (Holdings + 1). 
    // If strict "Tier" logic (pre-sell) is needed for *Next Day* planning, 
    // it usually assumes Start of Day == Current Holdings (since market hasn't opened).

    // Target Allocation
    const targetAlloc = state.currentSeed * (weightPct / 100);
    // Initial Qty (Floor)
    let totalBuyQty = initialLocPrice > 0 ? Math.floor(targetAlloc / initialLocPrice) : 0;


    // 3. Sell Orders Collection (Raw)
    // We need these to check for crossings
    let sellOrders = state.holdings
        .filter(h => h.quantity > 0) // Filter out Ghost Holdings (0 qty)
        .map(h => {
            // FIX: Use STORED Target Price from Simulation (h.targetPrice) 
            // instead of recalculating based on Current Mode.
            // Recalculating causes issues if Mode changed (e.g. bought in Offensive, now Safe).

            let targetPrice = 0;
            if (h.targetPrice) {
                targetPrice = h.targetPrice;
            } else {
                // Fallback (Should not happen if logic.js is correct)
                const targetRate = modeParams.target / 100;
                targetPrice = h.buyPrice * (1 + targetRate);
            }

            return {
                type: 'SELL',
                price: targetPrice,
                qty: h.quantity,
                date: h.date,
                buyPrice: h.buyPrice
            };
        });

    // 4. Smart Logic & Splitting (Real Tier Only)
    // DEBUG INSTRUMENTED
    let finalBuyOrders = [];

    if (isRealTier && totalBuyQty > 0) {
        console.log(`[OrderSheet Logic] Starting Split Check. BuyQty=${totalBuyQty}, InitialLOC=${initialLocPrice}`);

        // Sort Sells by Price ASC
        let sortedSells = [...sellOrders].sort((a, b) => a.price - b.price);
        console.table(sortedSells.map(s => ({ qty: s.qty, price: s.price })));

        let remainingQty = totalBuyQty;

        // Iterate through Sells that are LOWER/EQUAL to Initial LOC
        for (let sell of sortedSells) {
            if (remainingQty <= 0) break;

            console.log(`[OrderSheet Logic] Checking Sell ${sell.price} vs LOC ${initialLocPrice}`);

            if (initialLocPrice >= sell.price) {
                console.log(`  -> Conflict! Buying Matches Sell Price ${sell.price}`);
                // COLLISION!

                let matchQty = Math.min(remainingQty, sell.qty);

                finalBuyOrders.push({
                    type: 'BUY',
                    price: sell.price,
                    qty: matchQty,
                    note: `(Split Match)`
                });

                remainingQty -= matchQty;

                // Update "Current Limit" to (SellPrice - 0.01) for the remaining.
                initialLocPrice = sell.price - 0.01;
                console.log(`  -> New LOC Limit: ${initialLocPrice}, Remaining: ${remainingQty}`);

            } else {
                console.log("  -> No Conflict.");
            }
        }

        // Add Remaining (at whatever price lines up, or initial if no collision)
        if (remainingQty > 0) {
            console.log(`  -> Final Remaining Buy ${remainingQty} @ ${initialLocPrice}`);
            finalBuyOrders.push({
                type: 'BUY',
                price: initialLocPrice,
                qty: remainingQty,
                note: `(LOC)`
            });
        }

    } else {
        // Normal Mode (Non-Real Tier) or Zero Qty
        if (totalBuyQty > 0) {
            finalBuyOrders.push({
                type: 'BUY',
                price: initialLocPrice,
                qty: totalBuyQty,
                note: `(LOC)`
            });
        }
    }

    // 5. Combine and Sort
    // All Orders
    let allOrders = [
        ...finalBuyOrders.map(b => ({ ...b, rawType: 'BUY' })),
        ...sellOrders.map(s => ({ ...s, rawType: 'SELL' }))
    ];

    // Sort by Price DESC
    allOrders.sort((a, b) => b.price - a.price);


    // 6. Render
    const fmtType = (o) => o.rawType === 'BUY' ? `<span style="color:#ef4444; font-weight:bold;">LOC매수</span>` : `<span style="color:#2563eb; font-weight:bold;">LOC매도</span>`;

    // Define Color again
    const modeColor = modeName === "Safe" ? "#10b981" : "#f97316";

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 0.5rem; margin-bottom: 1rem;">
            <h3 style="margin:0; color:#1e3a8a;">📑 주문표 (Order Sheet) 
                <span style="font-size:0.8em; color:#666; font-weight:400; margin-left:10px;">
                    Last Close: <span style="font-weight:bold; color:black;">${fmtC(state.lastClose)}</span> 
                    (<span style="font-weight:bold; color:${modeColor}">${modeName} Mode</span>)
                </span>
            </h3>
        </div>
        
        <div style="background: white; border: 1px solid #bfdbfe; border-radius: 8px; overflow: hidden; min-height: 100px;">
            ${allOrders.length === 0
            ? `<div style="display:flex; justify-content:center; align-items:center; height:150px; color:black; font-weight:bold; font-size:1.1rem;">오늘 주문은 없습니다.</div>`
            : `<table style="width:100%; border-collapse: collapse;">
                <tbody style="font-size: 1rem;">
                    ${allOrders.map(o => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 0.75rem 1rem; width: 40%; text-align: right;">
                             ${fmtType(o)}
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                            <span style="font-weight:bold;">${fmtC(o.price)}</span>
                            <span style="margin-left: 0.5rem; color:#333;">${fmtI(o.qty)}개</span>
                            ${o.rawType === 'SELL' ? `<span style="font-size:0.8em; color:#94a3b8; margin-left:8px;">(매수일: ${o.date})</span>` : ''}
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>`
        }
        </div>
        
        <!-- Info Summary -->
        <div style="margin-top: 1rem; font-size: 0.85rem; color: #64748b; text-align: right;">
            <span>Next Tier: ${nextTier}</span> | 
            <span>Alloc: ${weightPct}%</span>
        </div>
    `;

    area.innerHTML = html;
}

function updateKPI(result) {
    const finalBalance = result.finalBalance;
    const startBalance = result.params.initialCapital;
    const totalReturn = ((finalBalance - startBalance) / startBalance) * 100;

    const years = (new Date(result.params.endDate) - new Date(result.params.startDate)) / (1000 * 60 * 60 * 24 * 365);
    const cagr = (Math.pow(finalBalance / startBalance, 1 / years) - 1) * 100;

    const maxDD = Math.min(...result.dailyLog.map(d => d.drawdown));

    const allTrades = result.history;
    // Filter for Real Trades (quantity > 0) as requested by user
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

    // MDD Date
    if (result.maxDrawdownDate) {
        document.getElementById('kpiMddDate').textContent = result.maxDrawdownDate;
    } else {
        document.getElementById('kpiMddDate').textContent = "None";
    }

    document.getElementById('kpiWinRate').textContent = fmtP(winRate) + ` (${trades.length})`;
}

function renderTable(ledger) {
    const tbody = document.querySelector('#ledgerTable tbody');
    tbody.innerHTML = "";

    const fmtN = (n) => n !== null && n !== undefined ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
    const fmtP = (n) => n !== null && n !== undefined ? n.toFixed(2) + "%" : "";
    const fmtC = (n) => n !== null && n !== undefined ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "";
    const fmtI = (n) => n !== null && n !== undefined ? Math.round(n).toLocaleString() : ""; // Integer for shares

    let html = "";

    // Reverse order for display (Latest top) or Chronological?
    // User image usually implies Chronological top-down? Or Reverse?
    // Let's stick to Chronological (Standard Ledger).

    ledger.forEach(row => {
        const modeClass = row.mode === "Safe" ? "mode-safe" : "mode-offensive";
        const modeKo = row.mode === "Safe" ? "안전" : "공세";

        const changeClass = row.changePct > 0 ? "text-red" : "text-blue";
        const changeColor = row.changePct > 0 ? "#ef4444" : "#2563eb";

        const pnlColor = row.netPnL > 0 ? "#ef4444" : (row.netPnL < 0 ? "#2563eb" : "");
        const accumColor = row.accumPnL > 0 ? "#ef4444" : (row.accumPnL < 0 ? "#2563eb" : "");

        const dayKo = ['일', '월', '화', '수', '목', '금', '토'][new Date(row.date).getDay()];

        html += `
        <tr>
            <td>${row.date} (${dayKo})</td>
            <td style="font-weight:bold">${fmtN(row.close)}</td>
            <td class="${modeClass}">${modeKo}</td>
            <td style="color:${changeColor}">${fmtP(row.changePct)}</td>
            
            <!--Buy -->
            <td style="font-weight:bold">${row.tier || ""}</td>
            <td>${fmtC(row.targetAllocation)}</td>
            <td>${fmtN(row.locTarget)}</td>
            <td style="color:#ef4444">${fmtN(row.buyPrice)}</td>
            <td>${fmtI(row.buyQty)}</td>
            <td>${fmtC(row.buyAmount)}</td>
            
            <!--Sell -->
            <td>${fmtN(row.targetSell)}</td>
            <td>${row.mocSell || ""}</td>
            <td>${row.sellDate || ""}</td>
            <td style="color:#2563eb">${fmtN(row.sellPrice)}</td>
            <td>${fmtI(row.sellQty)}</td>
            <td>${fmtN(row.sellAmount)}</td>
            
            <!--PnL -->
            <td style="color:#666">${fmtN(row.fee)}</td>
            <td style="font-weight:bold; color:${pnlColor}">${fmtC(row.netPnL)}</td>
            <td>${fmtP(row.netPnLPct)}</td>
            <td style="color:${accumColor}">${fmtC(row.accumPnL)}</td>
            
            <!--Asset -->
            <td style="color:${row.fundRefresh > 0 ? '#ef4444' : (row.fundRefresh < 0 ? '#2563eb' : '')}">
                ${row.fundRefresh > 0 ? '+' : ''}${fmtC(row.fundRefresh)}
            </td>
            <td>${fmtC(row.totalSeed)}</td>
            <td style="font-weight:bold">${fmtC(row.totalAsset)}</td>
            <td>${fmtC(row.cash)}</td>
            
            <!--Etc -->
            <td style="color:#2563eb">${fmtP(row.drawdown)}</td>
        </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderCharts(result) {
    const ctxMain = document.getElementById('mainChart').getContext('2d');
    const ctxDD = document.getElementById('ddChart').getContext('2d');
    const ctxCash = document.getElementById('cashChart').getContext('2d');

    if (mainChartInstance) mainChartInstance.destroy();
    if (ddChartInstance) ddChartInstance.destroy();
    if (cashChartInstance) cashChartInstance.destroy();

    const labels = result.dailyLog.map(d => d.date);
    const assetData = result.dailyLog.map(d => d.totalAsset);
    const priceData = result.dailyLog.map(d => d.price);
    const ddData = result.dailyLog.map(d => d.drawdown);
    const cashData = result.dailyLog.map(d => d.cash);

    // --- Cash Chart ---
    cashChartInstance = new Chart(ctxCash, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '예수금 ($)',
                data: cashData,
                borderColor: '#10b981', // Emerald Green
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 1.5,
                fill: true,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { display: false },
                y: { grid: { color: '#f1f5f9' } }
            },
            plugins: {
                legend: { display: true },
                title: { display: true, text: 'Cash Flow (예수금)' }
            }
        }
    });

    mainChartInstance = new Chart(ctxMain, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Asset',
                    data: assetData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    yAxisID: 'y',
                    pointRadius: 0,
                    borderWidth: 2,
                    fill: true
                },
                {
                    label: 'SOXL Price',
                    data: priceData,
                    borderColor: '#94a3b8',
                    yAxisID: 'y1',
                    pointRadius: 0,
                    borderWidth: 1,
                    borderDash: [5, 5]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { type: 'linear', display: true, position: 'left' },
                y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false } },
            }
        }
    });

    ddChartInstance = new Chart(ctxDD, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Drawdown %',
                data: ddData,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.2)',
                pointRadius: 0,
                borderWidth: 1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
        }
    });
}
