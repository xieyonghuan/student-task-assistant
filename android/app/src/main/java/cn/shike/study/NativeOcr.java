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
import java.util.ArrayList;
import java.util.Collections;

/** Bundled model: no Play Services model download or cloud OCR is required. */
final class NativeOcr implements AutoCloseable {
    private final TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    private Bitmap fitText(Bitmap bitmap) {
        // ML Kit needs roughly 16–24 pixels per glyph, not full-resolution chat fonts.
        // Use the smaller text bands so status clocks and large headings do not
        // cause small deadline digits to be shrunk blindly with the whole screen.
        int width = bitmap.getWidth(), height = bitmap.getHeight();
        int[] row = new int[width]; ArrayList<Integer> bands = new ArrayList<>();
        int start = -1, lastInk = -1;
        for (int y = 0; y <= height + 3; y++) {
            int ink = 0;
            if (y < height) {
                bitmap.getPixels(row, 0, width, 0, y, width, 1);
                for (int x = 0; x < width; x += 2) {
                    int color = row[x];
                    if (((color >> 16) & 255) * 0.299 + ((color >> 8) & 255) * 0.587 + (color & 255) * 0.114 < 180) ink++;
                }
            }
            if (ink >= Math.max(3, width / 500)) { if (start < 0) start = y; lastInk = y; }
            else if (start >= 0 && y - lastInk > 3) {
                int band = lastInk - start + 1;
                if (band >= 10 && band <= 120) bands.add(band);
                start = -1;
            }
        }
        if (bands.size() < 6) return bitmap;
        Collections.sort(bands); int glyph = bands.get(bands.size() / 4);
        if (glyph <= 32) return bitmap;
        float scale = Math.max(0.5f, 26f / glyph);
        Bitmap resized = Bitmap.createScaledBitmap(bitmap, Math.round(width * scale), Math.round(height * scale), true);
        if (resized != bitmap) bitmap.recycle();
        return resized;
    }
    private ArrayList<Integer> cuts(Bitmap bitmap) {
        // A tall screen gets internally reduced by the detector. Split at blank
        // rows so small Chinese strokes keep their shape, with no clipped lines.
        ArrayList<Integer> gaps = new ArrayList<>(), cuts = new ArrayList<>();
        int width = bitmap.getWidth(), height = bitmap.getHeight(), blank = -1;
        int[] row = new int[width];
        for (int y = 0; y <= height; y++) {
            int ink = 0;
            if (y < height) {
                bitmap.getPixels(row, 0, width, 0, y, width, 1);
                for (int x = 0; x < width; x += 2) {
                    int color = row[x];
                    if (((color >> 16) & 255) * 0.299 + ((color >> 8) & 255) * 0.587 + (color & 255) * 0.114 < 180) ink++;
                }
            }
            if (y < height && ink < Math.max(2, width / 1000)) { if (blank < 0) blank = y; }
            else if (blank >= 0) { if (y - blank >= 8) gaps.add((blank + y) / 2); blank = -1; }
        }
        int top = 0; cuts.add(0);
        while (height - top > 1000) {
            int next = -1;
            for (int gap : gaps) if (gap >= top + 350 && gap <= top + 1000) next = gap;
            if (next < 0) break;
            cuts.add(next); top = next;
        }
        cuts.add(height); return cuts;
    }
    JSONObject recognize(String content) throws Exception {
        if (content.length() > 16000000) throw new IllegalArgumentException("图片过大，请裁剪课程通知后重试。");
        byte[] bytes = Base64.decode(content, Base64.DEFAULT);
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 16000000)
            throw new IllegalArgumentException("无法读取图片或图片尺寸过大。");
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (decoded == null) throw new IllegalArgumentException("无法读取图片。");
        Bitmap bitmap = fitText(decoded);
        long start = android.os.SystemClock.elapsedRealtime();
        StringBuilder text = new StringBuilder(); ArrayList<Integer> cuts = cuts(bitmap);
        com.google.android.gms.tasks.Task<com.google.mlkit.vision.text.Text> running = null;
        try {
            for (int i = 0; i < cuts.size() - 1; i++) {
                if (android.os.SystemClock.elapsedRealtime() - start >= 45000) throw new java.util.concurrent.TimeoutException("本机识别等待超时。");
                Bitmap tile = Bitmap.createBitmap(bitmap, 0, cuts.get(i), bitmap.getWidth(), cuts.get(i + 1) - cuts.get(i));
                com.google.android.gms.tasks.Task<com.google.mlkit.vision.text.Text> task = recognizer.process(InputImage.fromBitmap(tile, 0));
                running = task;
                try {
                    if (text.length() > 0) text.append('\n');
                    text.append(Tasks.await(task, Math.max(1, 45000 - (android.os.SystemClock.elapsedRealtime() - start)), TimeUnit.MILLISECONDS).getText());
                } finally {
                    if (tile != bitmap) { if (task.isComplete()) tile.recycle(); else task.addOnCompleteListener(ignored -> tile.recycle()); }
                }
            }
            return new JSONObject().put("text", text.toString()).put("engine", "native-chinese")
                .put("elapsedMs", android.os.SystemClock.elapsedRealtime() - start).put("width", bitmap.getWidth()).put("height", bitmap.getHeight());
        } finally { if (running == null || running.isComplete()) bitmap.recycle(); else running.addOnCompleteListener(ignored -> bitmap.recycle()); }
    }
    @Override public void close() { recognizer.close(); }
}
