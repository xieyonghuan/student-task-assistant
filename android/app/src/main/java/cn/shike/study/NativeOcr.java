package cn.shike.study;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

/** Bundled model: no Play Services model download or cloud OCR is required. */
final class NativeOcr implements AutoCloseable {
    private final TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    JSONObject recognize(String content) throws Exception {
        if (content.length() > 16000000) throw new IllegalArgumentException("图片过大，请裁剪课程通知后重试。");
        byte[] bytes = Base64.decode(content, Base64.DEFAULT);
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 16000000)
            throw new IllegalArgumentException("无法读取图片或图片尺寸过大。");
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) throw new IllegalArgumentException("无法读取图片。");
        long start = android.os.SystemClock.elapsedRealtime();
        com.google.android.gms.tasks.Task<com.google.mlkit.vision.text.Text> task = recognizer.process(InputImage.fromBitmap(bitmap, 0));
        try {
            String text = Tasks.await(task, 45, TimeUnit.SECONDS).getText();
            return new JSONObject().put("text", text).put("engine", "native-chinese")
                .put("elapsedMs", android.os.SystemClock.elapsedRealtime() - start);
        } finally { if (task.isComplete()) bitmap.recycle(); else task.addOnCompleteListener(ignored -> bitmap.recycle()); }
    }
    @Override public void close() { recognizer.close(); }
}
