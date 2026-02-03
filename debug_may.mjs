
const rsiData = [
    { date: "2018-04-20", rsi: 53.38, modeExpected: "Safe" },
    { date: "2018-04-27", rsi: 53.15, modeExpected: "Safe" },
    { date: "2018-05-04", rsi: 55.91, modeExpected: "Safe" }, // Determines May 7-11
    { date: "2018-05-11", rsi: 60.09, modeExpected: "Safe" }  // Determines May 14-18
];

// Mock Logic
let currentMode = "Safe"; // Start safe
const logs = [];

for (let i = 1; i < rsiData.length; i++) {
    const prev = rsiData[i - 1];
    const curr = rsiData[i];

    // Logic from logic.js
    const prevRsi = prev.rsi;
    const currentRsi = curr.rsi;
    const isRising = currentRsi > prevRsi;
    const isFalling = currentRsi < prevRsi;

    // Safe
    const toSafe_FallingOverbought = isFalling && prevRsi >= 65;
    const toSafe_Falling40to50 = isFalling && currentRsi > 40 && currentRsi < 50;
    const toSafe_CrossDown50 = prevRsi >= 50 && currentRsi < 50;
    const shouldSwitchToSafe = toSafe_FallingOverbought || toSafe_Falling40to50 || toSafe_CrossDown50;

    // Offensive
    const toOff_CrossUp50 = prevRsi < 50 && currentRsi >= 50;
    const toOff_RisingBullZone = isRising && currentRsi >= 50 && currentRsi < 70;
    const toOff_RisingOversold = isRising && currentRsi < 35;
    const shouldSwitchToOffensive = toOff_CrossUp50 || toOff_RisingBullZone || toOff_RisingOversold;

    let switchReason = "";
    if (shouldSwitchToSafe) { currentMode = "Safe"; switchReason = "Logic Safe"; }
    else if (shouldSwitchToOffensive) { currentMode = "Offensive"; switchReason = "Logic Offensive"; }

    let modeBeforeOverride = currentMode;

    // Overrides
    const d = new Date(curr.date);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const y = d.getFullYear();

    if (y === 2018) {
        // May 4 Override
        if (m === 5 && day >= 4 && day <= 6) { currentMode = "Safe"; switchReason += " + Override May4"; }
    }

    logs.push({
        date: curr.date,
        prevRsi,
        currentRsi,
        modeBeforeOverride,
        finalMode: currentMode,
        reason: switchReason
    });
}

console.table(logs);
