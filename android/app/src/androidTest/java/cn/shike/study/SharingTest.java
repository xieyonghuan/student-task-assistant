package cn.shike.study;

import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.util.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SharingTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test public void textAndMultipleImageSharesAreCopiedPersistentlyAndConsumedWithoutExternalFileAccess() throws Exception {
        ArrayList<Uri> uris = new ArrayList<>(); String textId = null, imageId = null;
        try {
            textId = ShareStore.receive(context, new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "完成数学练习"));
            assertTrue(new File(ShareStore.root(context), textId + "/item.json").isFile());
            for (int i = 0; i < 2; i++) {
                ContentValues values = new ContentValues(); values.put(MediaStore.Images.Media.DISPLAY_NAME, "shike-test-" + UUID.randomUUID() + ".png"); values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                Uri uri = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values); assertNotNull(uri); uris.add(uri);
                Bitmap bitmap = Bitmap.createBitmap(200, 150, Bitmap.Config.ARGB_8888); bitmap.eraseColor(Color.WHITE);
                try (OutputStream out = context.getContentResolver().openOutputStream(uri)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)); } finally { bitmap.recycle(); }
            }
            Intent incoming = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/png").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            incoming.setClipData(ClipData.newRawUri("duplicate", uris.get(0)));
            imageId = ShareStore.receive(context, incoming);
            // Sender's files and grants can disappear: our copies must survive.
            for (Iterator<Uri> iterator = uris.iterator(); iterator.hasNext();) { context.getContentResolver().delete(iterator.next(), null, null); iterator.remove(); }
            JSONObject images = null;
            JSONArray pending = ShareStore.pending(context);
            for (int i = 0; i < pending.length(); i++) if (pending.getJSONObject(i).getString("id").equals(imageId)) images = pending.getJSONObject(i);
            assertNotNull(images); assertEquals(2, images.getJSONArray("images").length());
            for (int i = 0; i < 2; i++) {
                Uri local = Uri.parse(images.getJSONArray("images").getJSONObject(i).getString("url"));
                assertEquals("appassets.androidplatform.net", local.getHost());
                assertTrue(new File(ShareStore.root(context), local.getPath().substring("/shared/".length())).isFile());
            }
            ShareStore.consume(context, imageId); assertFalse(new File(ShareStore.root(context), imageId).exists());
            try { ShareStore.consume(context, "../../"); fail("Traversal accepted"); } catch (IllegalArgumentException expected) { }
            try { ShareStore.receive(context, new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///etc/hosts"))); fail("file URI accepted"); } catch (IllegalArgumentException expected) { }
            Intent send = ShareStore.outgoing("1. 数学练习\n截止时间：2026年12月30日");
            assertEquals(Intent.ACTION_SEND, send.getAction()); assertEquals("text/plain", send.getType()); assertNull(send.getComponent()); assertNull(send.getPackage());
            assertEquals(1, context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(context.getPackageName()), 0).size());
            assertEquals(1, context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/png").setPackage(context.getPackageName()), 0).size());
        } finally {
            for (Uri uri : uris) context.getContentResolver().delete(uri, null, null);
            if (textId != null) ShareStore.consume(context, textId);
            if (imageId != null) ShareStore.consume(context, imageId);
        }
    }
    @Test public void bundledChineseRecognizerReadsDenseScreenshotWithNoModelDownload() throws Exception {
        Bitmap bitmap = Bitmap.createBitmap(1264, 2780, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap); canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK); paint.setTextSize(48);
        String[] lines = {"课程作业通知", "完成数学第三章习题", "截止时间：2026年12月30日 23:59", "要求：写出计算过程并提交纸质版。"};
        for (int i = 0; i < lines.length; i++) canvas.drawText(lines[i], 45, 150 + i * 110, paint);
        paint.setTextSize(40);
        for (int i = 0; i < 15; i++) canvas.drawText("Read the assignment and check each step.", 45, 800 + i * 90, paint);
        ByteArrayOutputStream out = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 93, out); bitmap.recycle();
        String encoded = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
        try (NativeOcr ocr = new NativeOcr()) {
            for (int i = 0; i < 2; i++) {
                JSONObject result = ocr.recognize(encoded); String text = result.getString("text").replaceAll("\\s", "");
                assertTrue(text, text.contains("数学")); assertTrue(text, text.contains("2026") && text.contains("12") && text.contains("30"));
                System.out.println("SHIKE_NATIVE_OCR run=" + (i + 1) + " ms=" + result.getLong("elapsedMs"));
            }
        }
    }
}
