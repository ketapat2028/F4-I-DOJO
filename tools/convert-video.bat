@echo off
REM Convert videos so they play smoothly on the Station screen (Raspberry Pi 4 + Chromium) - see VIDEO_GUIDE.md
REM Usage: drag one or more video files onto this .bat  ->  writes <name>_pi.mp4 next to each file
REM Output: MP4, H.264 High@4.1, max 1920x1080, max 30fps, ~6 Mbps cap, AAC 128k, faststart
setlocal

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ffmpeg is not installed.
  echo Install it with:   winget install Gyan.FFmpeg
  echo then close this window and drag the video onto this file again.
  pause
  exit /b 1
)

if "%~1"=="" (
  echo Drag one or more video files onto convert-video.bat
  pause
  exit /b 1
)

:next
if "%~1"=="" goto done
echo.
echo === Converting "%~nx1" ===
ffmpeg -hide_banner -y -i "%~1" ^
  -c:v libx264 -profile:v high -level:v 4.1 -pix_fmt yuv420p -preset slow -crf 23 -maxrate 6M -bufsize 12M ^
  -vf "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" -fpsmax 30 ^
  -c:a aac -b:a 128k -ac 2 ^
  -movflags +faststart ^
  "%~dpn1_pi.mp4"
if errorlevel 1 (
  echo FAILED: "%~nx1"
) else (
  echo OK -^> "%~dpn1_pi.mp4"
)
shift
goto next

:done
echo.
echo Finished. Upload the *_pi.mp4 files in the I-DOJO editor.
pause
