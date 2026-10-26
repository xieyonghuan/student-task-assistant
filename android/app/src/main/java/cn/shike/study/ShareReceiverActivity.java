package cn.shike.study;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;

public final class ShareReceiverActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView message = new TextView(this); message.setText("正在接收课程通知…"); message.setPadding(48, 80, 48, 48); setContentView(message);
        new Thread(() -> {
            try {
                ShareStore.receive(this, getIntent());
                runOnUiThread(() -> {
                    startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> { Toast.makeText(this, error.getMessage() == null ? "接收失败，请重新分享。" : error.getMessage(), Toast.LENGTH_LONG).show(); finish(); });
            }
        }, "shike-share-copy").start();
    }
}
