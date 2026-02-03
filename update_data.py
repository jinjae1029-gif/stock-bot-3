import yfinance as yf
import json
import os
from datetime import datetime

# 데이터 다운로드 (최대 기간) - Ticker.history 사용 (더 안정적)
print("Fetching Data...")
# auto_adjust=False ensures we get Open/High/Low/Close/Volume explicitly
soxl = yf.Ticker("SOXL").history(start="2010-01-01", auto_adjust=False)
qqq = yf.Ticker("QQQ").history(start="2010-01-01", auto_adjust=False)

# 데이터 포맷 변환 함수
def format_data(df):
    data = []
    if df.empty:
        return data
        
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
