import yfinance as yf
import json
import os
from datetime import datetime, time
import pytz

import requests
import sys

# 데이터 다운로드 (최대 기간) - Ticker.history 사용 (더 안정적)
def fetch_data(ticker_symbol):
    print(f"Fetching {ticker_symbol}...")
    try:
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        })
        dat = yf.Ticker(ticker_symbol, session=session).history(start="2010-01-01", auto_adjust=False)
        if dat.empty:
            print(f"⚠️ Warning: {ticker_symbol} returned empty dataframe.")
            return None
        return dat
    except Exception as e:
        print(f"❌ Error fetching {ticker_symbol}: {e}")
        return None

soxl = fetch_data("SOXL")
qqq = fetch_data("QQQ")

if soxl is None or soxl.empty or qqq is None or qqq.empty:
    print("❌ Critical Error: Data fetch failed. Exiting without update.")
    sys.exit(1)

def is_market_open_or_today_incomplete(last_date):
    """
    Checks if the given last_date is 'today' and if the market is likely still open or just closed but unconfirmed.
    US Market Closes at 16:00 ET.
    """
    try:
        # NY timezone
        ny_tz = pytz.timezone('America/New_York')
        now_ny = datetime.now(ny_tz)
        
        # Check if last_date matches today in NY
        last_date_str = last_date.strftime('%Y-%m-%d')
        today_ny_str = now_ny.strftime('%Y-%m-%d')
        
        if last_date_str == today_ny_str:
            # If it's today, check time.
            # If Before 16:15 ET (give 15 min buffer for data settlement), consider it incomplete/live.
            market_close_time = time(16, 15)
            if now_ny.time() < market_close_time:
                print(f"⚠️ Last candle ({last_date_str}) is LIVE (Current NY Time: {now_ny.time()}). Dropping it.")
                return True
        return False
    except Exception as e:
        print(f"Time check error: {e}")
        return False

# 데이터 포맷 변환 함수 (+ 안전장치 추가)
def format_data(df):
    data = []
    if df.empty:
        return data

    # 1. 안전장치: 마지막 데이터가 '진행 중(장중)'이라면 제거
    if not df.empty:
        last_idx = df.index[-1]
        # Check if we should drop
        if is_market_open_or_today_incomplete(last_idx):
             df = df.iloc[:-1] # Drop last row

    # 인덱스(날짜)를 직접 순회
    for date_idx, row in df.iterrows():
        # 날짜 포맷 (YYYY-MM-DD)
        # date_idx는 Timestamp 객체임
        date_str = date_idx.strftime('%Y-%m-%d')
        
        # 안전하게 float 변환
        def get_val(val):
            try:
                # pandas Series/numpy scalar 처리
                val = float(val) 
                return round(val, 2)
            except:
                return 0
        
        data.append({
            "date": date_str,
            "open": get_val(row['Open']),
            "high": get_val(row['High']),
            "low": get_val(row['Low']),
            "close": get_val(row['Close']),
            "volume": int(row['Volume']) if 'Volume' in row else 0
        })
    return data

soxl_data = format_data(soxl)
qqq_data = format_data(qqq)

print(f"Fetched {len(soxl_data)} SOXL records.")
print(f"Fetched {len(qqq_data)} QQQ records.")

# JS 파일로 저장 (export const ... 형식)
js_content = f"""export const SOXL_DATA = {json.dumps(soxl_data)};
export const QQQ_DATA = {json.dumps(qqq_data)};
"""

# js 폴더가 없으면 생성
if not os.path.exists("js"):
    os.makedirs("js")

with open("js/data.js", "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"Update Complete: {datetime.now()}")
