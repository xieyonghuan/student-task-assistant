#!/usr/bin/env bash
set +e
adb logcat -c
gradle -p android connectedDebugAndroidTest --stacktrace
result=$?
mkdir -p android/app/build/reports/androidTests/device
adb logcat -d -v brief > android/app/build/reports/androidTests/device/logcat.txt
exit "$result"
