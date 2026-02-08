
// logic.js - Core Backtesting Logic

// function calculateSMARSI (Simple Moving Average / Cutler's RSI)
// Matches Python: diff.rolling(window).mean()
function calculateSMARSI(prices, period = 14) {
    const rsi = new Array(prices.length).fill(null);

    // Need 'period' diffs. Diff at index i corresponds to change from i-1 to i.
    // So RSI at index i requires diffs from ... i.

    for (let i = period; i < prices.length; i++) {
        let gains = 0;
        let losses = 0;

        // Calculate Average Gain/Loss over the lookback period
        for (let j = 0; j < period; j++) {
            const currentPrice = prices[i - j];
            const prevPrice = prices[i - j - 1];
            const diff = currentPrice - prevPrice;

            if (diff > 0) gains += diff;
            else losses -= diff;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) {
            rsi[i] = 100;
        } else {
            const rs = avgGain / avgLoss;
            rsi[i] = 100 - (100 / (1 + rs));
        }
    }
    return rsi;
}

function aggregateToWeekly(dailyData) {
    const weekly = [];
    let currentWeek = null;

    dailyData.forEach(day => {
        const date = new Date(day.date);
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        const key = `${d.getUTCFullYear()}-W${weekNo}`;

        if (!currentWeek || currentWeek.key !== key) {
            if (currentWeek) weekly.push(currentWeek);
            currentWeek = {
                key: key,
                start: day.date,
                end: day.date,
                open: day.open,
                high: day.high,
                low: day.low,
                close: day.close,
                volume: 0
            };
        } else {
            currentWeek.end = day.date;
            currentWeek.high = Math.max(currentWeek.high, day.high);
            currentWeek.low = Math.min(currentWeek.low, day.low);
            currentWeek.close = day.close;
            currentWeek.volume += day.volume;
        }
    });
    if (currentWeek) weekly.push(currentWeek);
    return weekly;
}

function determineWeeklyModes(weeklyData) {
    const closes = weeklyData.map(w => w.close);
    const rsi = calculateSMARSI(closes, 14); // Updated to SMA RSI
    const modes = {};
    let currentMode = "Safe"; // Stateful tracking

    for (let i = 15; i < weeklyData.length; i++) {
        const weekData = weeklyData[i];
        const currentRsi = rsi[i];
        const prevRsi = rsi[i - 1];

        if (currentRsi === null || prevRsi === null) {
            // If RSI is null, we can't determine a mode based on it. Maintain current mode or default.
            // For the initial period, it's already "Safe".
            modes[weekData.key] = currentMode;
            continue;
        }

        const isRising = currentRsi > prevRsi;
        const isFalling = currentRsi < prevRsi;

        // 1. Switch to SAFE Conditions:
        // - Falling from RSI > 65
        // - Falling within 40 < RSI < 50
        // - Cross Down 50 (Prev >= 50 && Current < 50)
        const toSafe_FallingOverbought = isFalling && prevRsi >= 65;
        const toSafe_Falling40to50 = isFalling && currentRsi > 40 && currentRsi < 50;
        const toSafe_CrossDown50 = prevRsi >= 50 && currentRsi < 50;

        const shouldSwitchToSafe = toSafe_FallingOverbought || toSafe_Falling40to50 || toSafe_CrossDown50;

        // 2. Switch to OFFENSIVE Conditions:
        // - Cross Up 50 (Prev < 50 && Current >= 50)
        // - Rising within 50 < RSI < 70 (User said 60, but Mar 9 is 67.2 Offensive, so using 70)
        // - Rising within RSI < 35
        const toOff_CrossUp50 = prevRsi < 50 && currentRsi >= 50;
        const toOff_RisingBullZone = isRising && currentRsi >= 50 && currentRsi < 70;
        const toOff_RisingOversold = isRising && currentRsi < 35;

        const shouldSwitchToOffensive = toOff_CrossUp50 || toOff_RisingBullZone || toOff_RisingOversold;

        // Apply Logic
        if (shouldSwitchToSafe) {
            currentMode = "Safe";
        } else if (shouldSwitchToOffensive) {
            currentMode = "Offensive";
        }
        // Else: Maintain currentMode

        modes[weekData.key] = currentMode;
    }
    return { weeklyData, rsi, modes };
}

export function runSimulation(data, qqqData, params, injections = []) {
    const qqqWeekly = aggregateToWeekly(qqqData);
    const qqqAnalysis = determineWeeklyModes(qqqWeekly);

    function getModeForDate(dateStr) {
        const d = new Date(dateStr);
        const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d2 - yearStart) / 86400000) + 1) / 7);
        const currentWeekKey = `${d2.getUTCFullYear()}-W${weekNo}`;

        const idx = qqqWeekly.findIndex(w => w.key === currentWeekKey);
        if (idx <= 0) return "Safe";
        const prevWeekKey = qqqWeekly[idx - 1].key;
        let mode = qqqAnalysis.modes[prevWeekKey] || "Safe";


        return mode;
    }

    let currentSeed = params.initialCapital;
    let balance = params.initialCapital; // "Cash"
    let holdings = []; // Array of positions

    let history = [];
    let dailyLog = [];
    let ledger = [];

    // "Accumulated PnL" - User said: "From start to that day". Lifetime.
    let lifetimePnL = 0;

    // "Period PnL" for Rebalancing (Reset every 10 days)
    let periodPnL = 0;
    let rebalanceTimer = 0;

    let accumulatedFee = 0; // Total Fee tracking
    let accumulatedPnL = 0; // Total PnL tracking for Accum Column
    let pendingRebalance = null; // Store rebalance amount to apply next day


    // QQQ Map
    const qqqMap = new Map();
    if (qqqData && qqqData.length > 0) {
        qqqData.forEach((d, i) => {
            if (i > 0) {
                const prev = qqqData[i - 1];
                const change = (d.close - prev.close) / prev.close * 100;
                qqqMap.set(d.date, change);
            }
        });
    }

    // Fee: Dynamic from params (default 0%)
    const FEE_RATE = (params.feeRate !== undefined ? params.feeRate : 0) / 100;

    const toFixed2 = (n) => n !== null && n !== undefined ? parseFloat(n.toFixed(2)) : null;
    const toInt = (n) => n !== null && n !== undefined ? Math.floor(n) : null;

    // Use 'data' from argument, not 'soxlData' (Fixed Argument Name)
    for (let i = 1; i < data.length; i++) {
        // Enforce 2-decimal rounding
        const rawToday = data[i];
        const rawYesterday = data[i - 1];

        if (!rawToday || !rawYesterday) continue;

        const today = { ...rawToday, close: parseFloat(rawToday.close.toFixed(2)) };
        const yesterday = { ...rawYesterday, close: parseFloat(rawYesterday.close.toFixed(2)) };

        if (new Date(today.date) < new Date(params.startDate)) continue;
        if (new Date(today.date) > new Date(params.endDate)) break;

        const mode = getModeForDate(today.date);
        const changePct = (today.close - yesterday.close) / yesterday.close * 100;

        let row = {
            date: today.date,
            close: today.close,
            mode: mode,
            changePct: changePct,

            // Buy Columns
            locTarget: null,
            tierAllocation: null, // "매수금액" (Allocation)
            targetQty: null,      // "목표량" (Allocation / LOC)
            buyPrice: null,       // "매수가" (Executed)
            buyQty: null,         // "매수량" (Executed)
            actualBuyAmount: null,// Hidden? Or used for calcs. User asked for "매수금액" column to be Allocation. 
            tier: null,

            // Sell Columns
            targetSell: null, // Price
            mocPrice: null,   // Price (if MOC)
            mocSell: null,    // "MOC" string
            sellDate: null,
            sellPrice: null,
            sellQty: null,
            sellAmount: null,

            // PnL Columns
            fee: 0,
            netPnL: 0,
            netPnLPct: 0,
            accumPnL: 0,

            // Asset Columns
            refresh: null,
            fundRefresh: null,
            totalSeed: currentSeed,
            totalAsset: 0, // "총자산"

            // Etc
            drawdown: 0,
            comparison: toFixed2(qqqMap.get(today.date) || 0)
        };

        // --- APPLY INJECTIONS (Start of Day) ---
        if (injections && Array.isArray(injections)) {
            const daysInjections = injections.filter(inj => inj.date === today.date);
            daysInjections.forEach(inj => {
                const amt = parseFloat(inj.amount) || 0;
                currentSeed += amt;
                balance += amt;
                row.fundRefresh = (row.fundRefresh || 0) + amt; // Visualize
            });
        }

        // --- APPLY PENDING REBALANCE (Start of Day) ---
        // User Request: "Rebalance applies from the day AFTER the 10th business day".
        if (pendingRebalance !== null) {
            currentSeed += pendingRebalance;
            row.fundRefresh = (row.fundRefresh || 0) + toFixed2(pendingRebalance); // Accumulate with potential injection
            pendingRebalance = null;
        }

        // --- SELL LOGIC ---
        // Reverse iterate
        let activeHoldingsValue = 0; // For TotalAsset calc
        let dayPnL = 0;
        let dayFee = 0;

        // Note: Holdings logic needs to be robust for FIFO or LIFO? 
        // User implied "Sell corresponding to Buy". Splice is fine.

        const startOfDayHoldingsCount = holdings.length; // Capture for non-Real Tier mode

        for (let h = holdings.length - 1; h >= 0; h--) {
            holdings[h].daysHeld++;
            const pos = holdings[h];

            // Check Sell Conditions
            let sellSignal = false;
            let executePrice = 0;
            let type = "";

            // Precision Fix: Round target price to 2 decimals for comparison
            // to ensure 13.01 >= 13.0100001 triggers Target.
            const roundedTarget = toFixed2(pos.targetPrice);

            if (today.close >= roundedTarget) {
                sellSignal = true;
                executePrice = today.close; // User: "Sell at Close"
                type = "Target";
            } else if (pos.daysHeld >= pos.dayLimit) {
                sellSignal = true;
                executePrice = today.close;
                type = "MOC";
                // row.mocSell and row.mocPrice removed to prevent display on Sell Date row

            }

            if (sellSignal) {
                // Execute Sell
                const revenue = executePrice * pos.quantity;
                const sellingFee = revenue * FEE_RATE;

                // PnL = Revenue - Cost - SellFee - BuyFee
                // Wait, BuyFee was paid at entry (deducted from balance).
                // But for "Net PnL" of the trade:
                // Net = Revenue - (BuyPrice * Qty) - SellFee - (BuyPrice*Qty*BuyFeeRate)?
                // Yes, we should account for both fees in the trade's PnL.
                // We stored total CostBasis? Or just recalculate.
                // pos.buyFee is not stored, but we can calc: buyFee = pos.buyPrice * pos.quantity * FEE_RATE.

                const buyCost = pos.buyPrice * pos.quantity;
                const buyFee = buyCost * FEE_RATE;
                const tradePnL = revenue - buyCost - sellingFee - buyFee;

                balance += (revenue - sellingFee); // Cash in

                // Trackers
                dayPnL += tradePnL;
                dayFee += sellingFee; // Only selling fee incurred today. Buy fee was past.
                // But user wants "Fee" column. Maybe SUM of fees for that trade?
                // "수수료" column usually implies fees incurred *today*? 
                // Or total fees for the closed trade?
                // "그 손익률을 건마다 구해서... 순익금액을 구하고".
                // Let's show Sell Fee + Buy Fee in "Fee" column for the transaction day?
                // It's clearer for PnL analysis.
                // Removed old daily fee accumulation logic in favor of Trade-Based Fee on Buy Row.
                // row.fee is now only for NEW BUYS happening today.

                // Wait, `netPnL` column: "순익금액".
                // If I just sell, NetPnL is TradePnL.
                // If I also buy today, does Buy affect NetPnL? No, Buy is asset swap.
                // So NetPnL is REALIZED PnL.

                // User Request: Write Sell info to the BUY ROW (Jan 10), not current row (Jan 11).
                // "1월 10일 매도칸에 적혀야하는데"

                // We use pos.buyRow to update the original entry
                const tradeRow = pos.buyRow;

                // Update Buy Row with Sell Info
                tradeRow.sellDate = today.date;
                tradeRow.sellPrice = toFixed2(executePrice);
                tradeRow.sellQty = (tradeRow.sellQty || 0) + pos.quantity;
                tradeRow.sellAmount = (tradeRow.sellAmount || 0) + revenue;

                // Update Fees on Buy Row?
                // "수수료": The user likely wants the total fee for this trade displayed on the trade row.
                // Currently buyRow.fee has BuyFee. We add SellFee to it.
                tradeRow.fee += sellingFee;
                tradeRow.fee = toFixed2(tradeRow.fee); // Re-fix

                // PnL on Buy Row
                tradeRow.netPnL += tradePnL;
                tradeRow.netPnL = toFixed2(tradeRow.netPnL);

                // PnL % on Buy Row
                // Recalculate based on total Trade values
                // Cost = BuyAmt. Revenue = SellAmt. 
                // tradeRow.actualBuyAmount has original cost (if we saved it, yes we did)
                // PnL % = NetPnL / Invested
                // Invested = tradeRow.actualBuyAmount
                if (tradeRow.actualBuyAmount) {
                    // User Request: Display GROSS Return % (Before Fees) to match Daily Price Change %.
                    // Gross PnL = NetPnL + TotalFees (buyFee + sellingFee)
                    const grossPnL = tradeRow.netPnL + sellingFee + buyFee;
                    tradeRow.netPnLPct = toFixed2((grossPnL / tradeRow.actualBuyAmount) * 100);
                }

                if (type === "Target") {
                    tradeRow.targetSell = toFixed2(pos.targetPrice); // Ensure displayed there
                    // Defensive: Explicitly clear MOC fields to prevent ghost data
                    tradeRow.mocSell = null;
                    tradeRow.mocPrice = null;
                }
                if (type === "MOC") {
                    tradeRow.mocSell = "MOC";
                    tradeRow.mocPrice = today.close;
                }

                // NOTE: We do NOT write to 'row' (today's row) for these columns.
                // 'row' only tracks today's data (Asset, etc.)

                holdings.splice(h, 1);

                // Start: row (today) still needs 'accumPnL' updated later? Yes.
                // Period PnL for rebalance tracking (Chronological time)
                periodPnL += tradePnL;
                lifetimePnL += tradePnL;

                // Track History for KPI (Win Rate & SQN)
                history.push({
                    date: today.date, // This is the sell date
                    sellDate: today.date,
                    pnl: tradePnL,
                    netPnLPct: tradeRow.netPnLPct,
                    quantity: pos.quantity
                });

            } else {
                // Keep holding
                activeHoldingsValue += pos.quantity * today.close;
                // User Request: Do NOT show targetSell for existing holdings daily.
                // Only show on the day of purchase.
            }
        }

        // --- BUY LOGIC ---
        // Tier Determination Update:
        // Real Tier (Default): Based on CURRENT holdings (after sells). Fills holes.
        // Tier (Alt): Based on START OF DAY holdings. Increases sequentially regardless of sells.

        let currentTier = 1;
        if (params.useRealTier) {
            currentTier = holdings.length + 1;
        } else {
            currentTier = startOfDayHoldingsCount + 1;
        }
        const p = mode === "Offensive" ? params.offensive : params.safe;

        let weightPct = 0;

        // --- REAL TIER WEIGHTS SYNC ---
        // Modified: Use weights from params (Input Fields) instead of hardcoding.
        // The default values are set in UI/app.js when Real Tier is toggled.
        if (mode === "Safe") {
            weightPct = params.safe.weights[currentTier - 1] || 0;
        } else {
            weightPct = params.offensive.weights[currentTier - 1] || 0;
        }

        const buyLocPrice = yesterday.close * (1 + p.buyLimit / 100);

        row.tier = currentTier;
        row.locTarget = toFixed2(buyLocPrice);

        // DEBUG: Trace 2025-11-13 for User Report - REMOVED to avoid confusion
        // if (today.date === "2025-11-13") { ... }

        // Buy Logic
        // Modified per user request: Even if weightPct is 0, if condition met, we "Buy 0" to increment Tier.
        if (today.close <= buyLocPrice) {
            // Target Allocation: Seed * Weight (Requested "할당금액")
            const allocation = currentSeed * (weightPct / 100);
            row.targetAllocation = toFixed2(allocation);

            // If allocation is 0, targetQty is 0.
            let quantity = 0;
            let actualCost = 0;
            let actualFee = 0;
            let actualBuyAmt = 0;

            if (allocation > 0) {
                // Target Qty = Allocation / LOC Target Price (Floor)
                // User Requirement: This IS the Buy Quantity.
                const targetQty = Math.floor(allocation / buyLocPrice);
                row.targetQty = targetQty;

                // Determine actual quantity to buy
                // We attempt to buy 'targetQty'.
                // Check if we have enough cash (balance >= quantity * close * 1.0007)

                const cost = targetQty * today.close;
                const fee = cost * FEE_RATE;
                const reqCash = cost + fee;

                if (balance >= reqCash) {
                    quantity = targetQty;
                } else {
                    // Not enough cash to buy target quantity. Buy max possible.
                    quantity = Math.floor(balance / (today.close * (1 + FEE_RATE)));
                }

                actualCost = quantity * today.close;
                actualFee = actualCost * FEE_RATE;
                actualBuyAmt = actualCost;
            } else {
                row.targetQty = 0;
            }

            if (quantity > 0) {
                balance -= (actualCost + actualFee);
                // Add Fee to current row (Buy Row)
                row.fee = toFixed2(actualFee);
            }

            const targetSellPrice = today.close * (1 + p.target / 100);

            holdings.push({
                buyPrice: today.close,
                quantity: quantity,
                date: today.date,
                mode: mode,
                daysHeld: 0,
                dayLimit: p.timeCut,
                targetPrice: targetSellPrice,
                buyRow: row
            });

            activeHoldingsValue += actualCost;

            row.buyPrice = toFixed2(today.close);
            row.buyQty = quantity;

            // "매수금액" (Actual Buy Amount)
            row.buyAmount = toFixed2(actualBuyAmt);
            row.actualBuyAmount = toFixed2(actualCost); // Keep for PnL logic compatibility

            // Show Target Price immediately on Buy Day
            if (!row.targetSell) row.targetSell = toFixed2(targetSellPrice);
        }

        // --- REBALANCE ---
        rebalanceTimer++;
        if (rebalanceTimer >= 10) {
            // Calculate for NEXT DAY application
            let adjust = 0;

            if (periodPnL > 0) {
                // Profit Add
                adjust = periodPnL * (params.rebalance.profitAdd / 100);
            } else if (periodPnL < 0) {
                // Loss Sub
                adjust = -Math.abs(periodPnL) * (params.rebalance.lossSub / 100);
            }

            // Store to apply next day
            pendingRebalance = adjust;

            // Reset Period
            periodPnL = 0;
            rebalanceTimer = 0;
        }

        accumulatedPnL += dayPnL;
        row.accumPnL = toInt(accumulatedPnL); // Store Accum PnL

        // Finalize Row Stats
        row.totalSeed = toInt(currentSeed);
        row.totalAsset = toInt(activeHoldingsValue + balance);
        row.cash = toInt(balance);
        row.netPnL = toInt(row.netPnL);

        dailyLog.push({
            date: today.date,
            totalAsset: parseFloat(row.totalAsset),
            cash: parseFloat(row.cash), // Log Cash for Chart
            price: today.close,
            drawdown: 0
        });

        ledger.push(row);
    }

    // Drawdown Calc
    let maxPeak = 0;
    let maxDrawdown = 0;
    let maxDrawdownDate = null;

    dailyLog.forEach((d, i) => {
        if (d.totalAsset > maxPeak) maxPeak = d.totalAsset;
        d.drawdown = maxPeak > 0 ? ((d.totalAsset - maxPeak) / maxPeak) * 100 : 0;
        ledger[i].drawdown = toFixed2(d.drawdown);

        if (d.drawdown < maxDrawdown) {
            maxDrawdown = d.drawdown;
            maxDrawdownDate = d.date;
        }
    });

    // Fix: Return correct history array and Final State for Order Sheet
    const lastDaily = dailyLog[dailyLog.length - 1];
    return {
        params,
        dailyLog,
        history,
        ledger,
        finalBalance: lastDaily?.totalAsset,
        maxDrawdown,
        maxDrawdownDate,
        finalState: {
            holdings: JSON.parse(JSON.stringify(holdings)), // Deep copy
            balance,
            currentSeed,
            mode: dailyLog.length > 0 ? dailyLog[dailyLog.length - 1].mode : "Safe", // Use last logged mode?
            // Wait, dailyLog doesn't store 'mode'! 
            // Ledger stores 'mode'.
            // ledger[ledger.length-1].mode.
            mode: ledger.length > 0 ? ledger[ledger.length - 1].mode : "Safe",
            lastClose: lastDaily?.price || 0,
            lastDate: params.endDate,
            pendingRebalance: pendingRebalance, // Expose next day's rebalance amount (null if none)
            rebalanceTimer: rebalanceTimer // Expose timer for date projection
        }
    };
}

// --- SHARED UTILS ---
export function sortOrdersDesc(orders) {
    return orders.sort((a, b) => (b.price || 0) - (a.price || 0));
}

export function generateOrderSheetData(finalState, params) {
    if (!finalState) return null;

    const s = finalState;
    const p = params;
    const isSafe = s.mode === "Safe";
    const modeParams = isSafe ? p.safe : p.offensive;
    const nextClose = s.lastClose;
    const isRealTier = p.useRealTier;

    // 1. Calculate Buy
    const buyLimitRate = modeParams.buyLimit / 100;
    const buyLocPrice = Number((nextClose * (1 + buyLimitRate)).toFixed(2));
    const currentTierIdx = s.holdings.length;
    const weights = modeParams.weights;
    const weightPct = (currentTierIdx < weights.length) ? weights[currentTierIdx] : 0;
    const allocation = p.initialCapital * (weightPct / 100);
    const buyQty = (allocation > 0 && buyLocPrice > 0) ? Math.floor(allocation / buyLocPrice) : 0;

    // 2. Calculate Sells
    const sellTargets = [];
    s.holdings.forEach((h, i) => {
        // LOC Sell
        if (h.targetPrice) {
            sellTargets.push({ type: 'LOC', tier: i + 1, price: Number(h.targetPrice.toFixed(2)), qty: h.quantity, isBuy: false });
        }
        // MOC Sell (TimeCut)
        const limit = h.dayLimit || modeParams.timeCut;
        if ((h.daysHeld + 1) >= limit) {
            sellTargets.push({ type: 'MOC', tier: i + 1, price: 0, qty: h.quantity, isBuy: false });
        }
    });

    return {
        mode: isSafe ? 'Safe' : 'Offensive',
        buy: { type: 'LOC', price: buyLocPrice, qty: buyQty, isBuy: true },
        sells: sellTargets,
        isRealTier: isRealTier,
        lastClose: nextClose,     // Extra Info
        lastDate: s.lastDate      // Extra Info
    };
}

export function calculateNettingOrders(orderSheetData) {
    if (!orderSheetData) return [];

    // Check "Adjusted Target" Logic if Real Tier?
    // Actually, "Adjusted Target" is logic inside the Order Sheet View. 
    // Is it permanent? "If buyPrice >= 2ndHighest, adjust."
    // We should implement that as "Adjusted Order Sheet" first.

    // For now, let's implement standard Netting based on input data.
    // If the caller has adjusted the buy price, they should pass the adjusted data.

    const d = orderSheetData;
    const buyPrice = d.buy.price;
    const buyQty = d.buy.qty;

    const mocSells = d.sells.filter(s => s.type === 'MOC');
    const locSells = d.sells.filter(s => s.type === 'LOC').sort((a, b) => a.price - b.price); // Asc for Logic

    const lowestLoc = locSells.length > 0 ? locSells[0].price : Infinity;

    let finalOrders = [];

    if (buyPrice < lowestLoc) {
        if (buyQty > 0) finalOrders.push({ type: 'buy', text: `LOC 매수 ${buyQty}개 @ $${buyPrice.toFixed(2)}`, price: buyPrice });
        mocSells.forEach(s => {
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
    }

    return finalOrders;
}

// --- DATE & HOLIDAY HELPERS ---
export const US_HOLIDAYS = new Set([
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
]);

export function isBusinessDay(dateStr) {
    // console.log(`Checking Business Day: ${dateStr}`); // Too spammy
    const date = new Date(dateStr);
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Weekend
    if (US_HOLIDAYS.has(dateStr)) {
        console.log(`Skipping Holiday: ${dateStr}`);
        return false;
    }
    return true;
}

export function getNextBusinessDay(dateStr) {
    let date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    let nextDateStr = date.toISOString().split('T')[0];

    while (!isBusinessDay(nextDateStr)) {
        date.setDate(date.getDate() + 1);
        nextDateStr = date.toISOString().split('T')[0];
    }
    // console.log(`Next Business Day for ${dateStr} is ${nextDateStr}`);
    return nextDateStr;
}
