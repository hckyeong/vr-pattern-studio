@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
if not exist node_modules\vite\bin\vite.js (
  echo 최초 실행 준비: 프로젝트 폴더에서 npm ci 명령을 실행해 주세요.
  pause
  exit /b 1
)
call npm.cmd run build
if errorlevel 1 (
  echo 프로그램 빌드에 실패했습니다. 위 오류를 확인해 주세요.
  pause
  exit /b 1
)
echo 패턴 스튜디오를 시작합니다. 이 창을 닫으면 프로그램 서버가 종료됩니다.
call npm.cmd run preview -- --open
pause
