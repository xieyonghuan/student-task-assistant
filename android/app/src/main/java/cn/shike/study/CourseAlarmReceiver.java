package cn.shike.study;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class CourseAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                CourseAlarms alarms = new CourseAlarms(context);
                if (CourseAlarms.FIRE.equals(intent.getAction()) && intent.getData() != null)
                    alarms.deliver(intent.getData().getLastPathSegment(), System.currentTimeMillis());
                alarms.rebuild();
            } catch (Exception error) {
                context.getSharedPreferences("course-alarm-state", Context.MODE_PRIVATE).edit()
                    .putString("error", "上课提醒尚未恢复，请打开拾课检查课程表与权限。").apply();
            } finally { pending.finish(); }
        }, "shike-course-alarm").start();
    }
}
