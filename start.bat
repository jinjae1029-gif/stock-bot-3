@echo off
chcp 65001
cls
echo ===================================================
echo     FDTS Premium Backtest Dashboard Launcher
echo ===================================================
echo.
echo [모바일(갤럭시/아이폰) 접속 준비]
echo ---------------------------------------------------
echo 1. PC와 핸드폰이 "같은 와이파이"를 쓰고 있어야 합니다.
echo 2. 아래 출력되는 [IPv4 주소]를 핸드폰 인터넷 창에 입력하세요.
echo    예) 192.168.0.5:8000
echo ---------------------------------------------------
echo.
echo [현재 내 PC 아이피 주소]
ipconfig | findstr /i "IPv4"
echo.
echo ---------------------------------------------------
echo 이제 서버를 시작합니다... (방화벽 경고가 뜨면 '허용'을 누르세요)
echo.

start http://localhost:8000
python -m http.server 8000 --bind 0.0.0.0
pause
