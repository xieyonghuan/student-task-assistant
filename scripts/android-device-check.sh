#!/usr/bin/env bash
set +e
adb logcat -c
gradle -p android connectedDebugAndroidTest --stacktrace
result=$?
mkdir -p android/app/build/reports/androidTests/device
adb logcat -d -v brief > android/app/build/reports/androidTests/device/logcat.txt
grep -E 'ShikeWeb|CONSOLE' android/app/build/reports/androidTests/device/logcat.txt | tail -n 60 || true
exit "$result"
