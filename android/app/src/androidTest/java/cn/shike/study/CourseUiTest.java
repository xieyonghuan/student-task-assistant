package cn.shike.study;

import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CourseUiTest {
    private MainActivity activity;
    private String eval(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch ready = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.browserForTests().evaluateJavascript(script, value -> { result.set(value); ready.countDown(); }));
        assertTrue(ready.await(20, TimeUnit.SECONDS)); return result.get();
    }
    private void waitFor(String expression, int seconds) throws Exception {
        long until = System.currentTimeMillis() + seconds * 1000L;
        while (System.currentTimeMillis() < until) { if ("true".equals(eval(expression))) return; Thread.sleep(250); }
        fail(expression + ": " + eval("document.body.innerText.slice(-2500)"));
    }
    private void open() {
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
    }
    private int countClass(android.view.accessibility.AccessibilityNodeInfo node,String name) {
        if(node==null)return 0;int total=name.contentEquals(node.getClassName()==null?"":node.getClassName())?1:0;
        for(int i=0;i<node.getChildCount();i++)total+=countClass(node.getChild(i),name);return total;
    }
    @Test public void nativeTimeSpinnerConfirmsAndCancelsThroughTheLocalBridge() throws Exception {
        open();android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();int previous=info.flags;info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;ui.setServiceInfo(info);
        try {
            waitFor("!!window.ShikeNative && !!document.querySelector('.home-capture')",30);
            eval("window.__timeResult=null;window.__previousTimeHandler=ShikeNative.onmessage;ShikeNative.onmessage=e=>{const r=JSON.parse(e.data);if(r.id==='time-test')window.__timeResult=r;else window.__previousTimeHandler?.(e)};ShikeNative.postMessage(JSON.stringify({id:'time-test',method:'coursePickTime',args:{time:'09:15',title:'选择上课时间'}}))");
            android.view.accessibility.AccessibilityNodeInfo root=null;long until=System.currentTimeMillis()+10000;
            while(System.currentTimeMillis()<until){root=ui.getRootInActiveWindow();if(countClass(root,"android.widget.NumberPicker")>=2)break;Thread.sleep(150);}
            assertTrue("Native time selection must expose hour and minute spinners",countClass(root,"android.widget.NumberPicker")>=2);
            java.util.List<android.view.accessibility.AccessibilityNodeInfo> buttons=root.findAccessibilityNodeInfosByViewId("android:id/button1");assertFalse(buttons.isEmpty());assertTrue(buttons.get(0).performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
            waitFor("window.__timeResult?.ok===true && window.__timeResult.result.time==='09:15'",10);
            eval("window.__timeResult=null;ShikeNative.postMessage(JSON.stringify({id:'time-test',method:'coursePickTime',args:{time:'09:15'}}))");
            Thread.sleep(400);InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
            waitFor("window.__timeResult?.result.cancelled===true",10);
        } finally {info.flags=previous;ui.setServiceInfo(info);InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.finish());}
    }
    @Test public void bundledCourseOcrNativeSaveAndReopenPreserveTwoCourses() throws Exception {
        CourseStore store = new CourseStore(InstrumentationRegistry.getInstrumentation().getTargetContext()); JSONObject original = store.read();
        store.replace(CourseEngine.empty(), original.getLong("revision")); open();
        try {
            waitFor("!!document.querySelector('.home-capture')", 30);
            eval("location.hash='#/timetable'"); waitFor("!!document.querySelector('[data-course=new-table]')", 20);
            eval("(()=>{document.querySelector('[data-course=new-table]').click();const f=document.querySelector('#course-table-form');f.elements.name.value='测试学期';f.elements.firstMonday.value='2026-10-26';f.requestSubmit()})()");
            waitFor("!!document.querySelector('.period-row')", 10);
            eval("document.querySelector('#course-table-form').requestSubmit()");
            waitFor("document.querySelector('#period-page-label')?.innerText.includes('5—8')", 10);
            eval("document.querySelector('#course-table-form').requestSubmit()");
            waitFor("document.querySelector('#period-page-label')?.innerText.includes('9—12')", 10);
            eval("document.querySelector('#course-table-form').requestSubmit()");
            waitFor("!!document.querySelector('.course-grid')", 20);
            eval("document.querySelector('[data-course=ocr]').click()"); waitFor("!!document.querySelector('#course-images')", 15);
            eval("document.querySelector('#course-import-mode').value='list';document.querySelector('#course-import-mode').dispatchEvent(new Event('change'))");
            eval("(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1600,1000);x.fillStyle='#111';x.font='42px sans-serif';['课程名称：运筹学','周一 第1-2节','周次：1-16','教室：A201','','课程名称：大学英语','周二 第3-4节','周次：1-16','教室：B102'].forEach((l,i)=>x.fillText(l,60,80+i*85));c.toBlob(b=>{const d=new DataTransfer();d.items.add(new File([b],'课程.png',{type:'image/png'}));const f=document.querySelector('#course-images');f.files=d.files;f.dispatchEvent(new Event('change'));});})()");
            waitFor("document.querySelectorAll('.course-candidates fieldset').length===1 && document.querySelector('.course-review-progress')?.innerText.includes('1 / 2')", 180);
            assertEquals("true", eval("[...document.querySelectorAll('.course-candidates [name=name]')].some(e=>e.value==='运筹学')"));
            eval("document.querySelector('#course-import-confirm').requestSubmit()");
            waitFor("document.querySelector('.course-review-progress')?.innerText.includes('2 / 2')", 15);
            eval("document.querySelector('#course-import-confirm').requestSubmit()");
            waitFor("document.querySelectorAll('.course-row').length===2 && !document.querySelector('dialog[open]')", 20);
            assertEquals(2, store.read().getJSONArray("tables").getJSONObject(0).getJSONArray("courses").length());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish()); open();
            waitFor("!!document.querySelector('.home-capture')", 30); eval("location.hash='#/timetable'"); waitFor("document.querySelectorAll('.course-row').length===2", 20);
            assertEquals("true", eval("document.querySelector('.course-arrangements').innerText.includes('运筹学')"));
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish());
            store.replace(original, store.read().getLong("revision")); new CourseAlarms(InstrumentationRegistry.getInstrumentation().getTargetContext()).rebuild();
        }
    }
}
