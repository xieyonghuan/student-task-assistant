#!/usr/bin/env bash
set +e
adb logcat -c
adb shell wm size 1264x2780
adb shell wm density 480
adb shell settings put secure show_ime_with_hard_keyboard 1
gradle -p android connectedDebugAndroidTest --stacktrace
result=$?
mkdir -p android/app/build/reports/androidTests/device
adb logcat -d -v brief > android/app/build/reports/androidTests/device/logcat.txt
grep -E 'SHIKE_|ShikeWeb|CONSOLE' android/app/build/reports/androidTests/device/logcat.txt | tail -n 60 || true
exit "$result"
