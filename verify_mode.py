
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# 1. Fetch QQQ Data
print("Fetching QQQ Data...")
qqq = yf.download("QQQ", start="2017-01-01", end="2018-10-01", progress=False, auto_adjust=False)

# Support multi-index columns if latest yfinance
if isinstance(qqq.columns, pd.MultiIndex):
    qqq = qqq.xs('Close', axis=1, level=0) if 'Close' in qqq.columns.get_level_values(0) else qqq['Close']
else:
    qqq = qqq['Close']

# 2. Resample to Weekly (Ending Friday, typically standard)
# JS logic: "weekNo = ...". JS aggregation sums volume, takes last close.
# Simplest Python equivalent for verification: Resample 'W-FRI'
weekly = qqq.resample('W-FRI').last()
weekly_opens = qqq.resample('W-FRI').first() # Approx

# 3. Calculate Wilder's RSI 14
def wilder_rsi(series, period=14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)

    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

# Note: JS implementation is standard Wilder's (SMA of gains). 
# Python's ewm(alpha=1/period) is equivalent to Wilder's Smoothing.
# Let's verify manually if needed, but this is close enough for diagnosys.

rsi_series = wilder_rsi(weekly, 14)

# 4. Check Mode Logic for Feb - Mar 2018
print("\n--- Verification for 2018 Full Run (Jan-Oct) ---\n")
subset = rsi_series['2018-01-01':'2018-10-01']

prev_rsi = None
for date in subset.index:
    # Ensure date is datetime
    if isinstance(date, str):
        date = pd.to_datetime(date)
    
    # Force scalar
    rsi = float(subset.loc[date])
    date_str = date.strftime('%Y-%m-%d')
    if prev_rsi is None:
        prev_rsi = rsi
        continue
    
    current_rsi = rsi
    is_rising = current_rsi > prev_rsi
    is_falling = current_rsi < prev_rsi
    
    # Logic from logic.js
    # Offensive:
    # 1. Cross Up 50
    # 2. Rising AND 50 <= RSI < 65
    # 3. RSI < 35 AND Rising
    
    is_cross_up_50 = prev_rsi < 50 and current_rsi >= 50
    is_rising_50_to_65 = is_rising and current_rsi >= 50 and current_rsi < 65
    is_rising_low = is_rising and current_rsi < 35
    
    offensive = is_cross_up_50 or is_rising_50_to_65 or is_rising_low
    
    # Safe:
    # 1. Rising but > 65 (Default)
    # 2. Falling > 65
    # 3. Falling 40-50
    # 4. Cross Down 50
    
    mode = "Safe"
    if offensive: mode = "Offensive"
    
    # Force scalar for Price too
    raw_price = weekly.loc[date]
    if hasattr(raw_price, 'iloc'):
        price = float(raw_price.iloc[0])
    else:
        price = float(raw_price)
        
    print(f"Week {date_str}: Price {price:.2f} | RSI {current_rsi:.2f} (Prev {prev_rsi:.2f}) | Mode: {mode}")
    
    # Detailed Diagonosis for Feb 20 - Mar 16
    if "2018-02" in date_str or "2018-03" in date_str:
        if mode == "Safe":
            if current_rsi >= 65 and is_rising:
                print(f"   -> [DIAGNOSIS] Marked Safe because RSI >= 65 ({current_rsi:.2f}) even though Rising.")
            elif not is_rising:
                print(f"   -> [DIAGNOSIS] Marked Safe because Falling.")
    
    prev_rsi = current_rsi

