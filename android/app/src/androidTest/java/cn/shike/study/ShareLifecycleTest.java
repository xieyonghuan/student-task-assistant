package cn.shike.study;

import android.content.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ShareLifecycleTest {
    private MainActivity activity;
    private String eval(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch ready = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.browserForTests().evaluateJavascript(script, value -> { result.set(value); ready.countDown(); }));
        assertTrue(ready.await(15, TimeUnit.SECONDS)); return result.get();
    }
    private void waitFor(String script) throws Exception {
        long until = System.currentTimeMillis() + 30000;
        while (System.currentTimeMillis() < until) { if ("true".equals(eval(script))) return; Thread.sleep(150); }
        fail("Shared content did not appear: " + eval("document.body.innerText.slice(-2000)"));
    }
    @Test public void coldAndWarmSharedTextOpensExtractionAndPersistsAcrossReopening() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String first = ShareStore.receive(context, new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "完成冷启动分享练习\n截止时间：2026年12月30日"));
        String second = null;
        try {
            Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(launch);
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value.includes('冷启动分享练习'))");
            second = ShareStore.receive(context, new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "完成热启动分享报告\n截止时间：2026年12月31日"));
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.startActivity(new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value.includes('热启动分享报告'))");
            assertEquals(0, ShareStore.pending(context).length());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.browserForTests().reload());
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value.includes('冷启动分享练习')) && [...document.querySelectorAll('[name=title]')].some(e=>e.value.includes('热启动分享报告'))");
        } finally {
            ShareStore.consume(context, first); if (second != null) ShareStore.consume(context, second);
            if (activity != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish());
        }
    }
}
