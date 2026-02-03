
import yfinance as yf
import pandas as pd

print("Fetching Data for Mar 2018...")

# 1. Fetch SOXL (Daily)
soxl = yf.download("SOXL", start="2018-03-01", end="2018-03-15", progress=False, auto_adjust=False)
if isinstance(soxl.columns, pd.MultiIndex):
    soxl = soxl.xs('Close', axis=1, level=0) if 'Close' in soxl.columns.get_level_values(0) else soxl['Close']
else:
    soxl = soxl['Close']

soxl_daily = soxl.resample('D').last().dropna()

# 2. Fetch QQQ (Weekly for Mode)
qqq = yf.download("QQQ", start="2018-01-01", end="2018-04-01", progress=False, auto_adjust=False)
if isinstance(qqq.columns, pd.MultiIndex):
    qqq = qqq.xs('Close', axis=1, level=0) if 'Close' in qqq.columns.get_level_values(0) else qqq['Close']
else:
    qqq = qqq['Close']
    
qqq_weekly = qqq.resample('W-FRI').last()

print("\n--- Market Data ---")
mar7 = soxl_daily.loc['2018-03-07']
mar8 = soxl_daily.loc['2018-03-08']
mar9 = soxl_daily.loc['2018-03-09']

# Force Scalar
if hasattr(mar7, 'iloc'): mar7 = float(mar7.iloc[0])
else: mar7 = float(mar7)

if hasattr(mar8, 'iloc'): mar8 = float(mar8.iloc[0])
else: mar8 = float(mar8)

if hasattr(mar9, 'iloc'): mar9 = float(mar9.iloc[0])
else: mar9 = float(mar9)

print(f"Mar 07 Close: {mar7:.4f} (Buy Day)")
print(f"Mar 08 Close: {mar8:.4f}")
print(f"Mar 09 Close: {mar9:.4f} (Sell Day)")

# Mode Check
print("\n--- Mode Check ---")
# Use QQQ RSI logic
def wilder_rsi(series, period=14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

rsi = wilder_rsi(qqq_weekly, 14)
print(rsi['2018-02-01':'2018-03-30'])

# Simulate Logic
# Mar 7 uses mode from previous week (Mar 2)
# Mar 2 RSI: 61.50 -> Offensive (Prev 64.7 < 65)
# Off Limit: 4.0% buy, 3.0% target? Or Safe?

buy_price = float(mar7)
target_off_3pct = buy_price * 1.03
target_safe_02pct = buy_price * 1.002

print(f"\nBuying at {buy_price:.4f}")
print(f"Offensive Target (3%): {target_off_3pct:.4f}")
print(f"Safe Target (0.2%): {target_safe_02pct:.4f}")
print(f"Sell Price (Mar 9): {float(mar9):.4f}")

if float(mar9) >= target_off_3pct:
    print(">> Hit Offensive Target")
else:
    print(">> Missed Offensive Target")

if float(mar9) >= target_safe_02pct:
    print(">> Hit Safe Target")
else:
    print(">> Missed Safe Target")
