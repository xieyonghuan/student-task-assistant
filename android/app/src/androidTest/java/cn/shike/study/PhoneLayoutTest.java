package cn.shike.study;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.Context;
import android.view.inputmethod.InputMethodManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PhoneLayoutTest {
    private MainActivity activity;
    private String eval(String script) throws Exception {
        AtomicReference<String> value=new AtomicReference<>(); CountDownLatch ready=new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.browserForTests().evaluateJavascript(script,result->{value.set(result);ready.countDown();}));
        assertTrue(ready.await(20,TimeUnit.SECONDS)); return value.get();
    }
    private void waitFor(String script,int seconds) throws Exception {
        long end=System.currentTimeMillis()+seconds*1000L;
        while(System.currentTimeMillis()<end){if("true".equals(eval(script)))return;Thread.sleep(200);}
        fail("Phone layout did not become ready: "+script+"; "+eval("JSON.stringify({w:innerWidth,h:innerHeight,classes:document.documentElement.className,focused:document.activeElement?.tagName,sidebar:document.querySelector('.sidebar')?.getBoundingClientRect().width,expanded:document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded'),tablet:matchMedia('(min-width:651px)').matches})"));
    }
    @Test public void phoneKeyboardRotationAndLargeTextKeepFormsAndActionsReachable() throws Exception {
        activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            waitFor("!!document.querySelector('.home-capture')",40);
            assertEquals("true",eval("!document.querySelector('.topbar') && !document.querySelector('[data-action=install]') && getComputedStyle(document.querySelector('.native-utility .privacy-badge')).display!=='none'"));
            assertEquals("true",eval("(()=>{const s=document.querySelector('.native-utility [data-action=settings]').getBoundingClientRect();const m=document.querySelector('#home-manual').getBoundingClientRect();return s.x>innerWidth/2 && s.top<100 && s.width>=44 && m.bottom<=document.querySelector('.sidebar').getBoundingClientRect().top;})()"));
            assertEquals("true",eval("innerWidth>=350 && innerWidth<=450 && document.documentElement.scrollWidth<=innerWidth"));
            assertEquals("true",eval("[...document.querySelectorAll('.sidebar nav .nav-item')].every(e=>e.getBoundingClientRect().height>=44 && e.getBoundingClientRect().width>=44)"));
            eval("document.querySelector('#home-manual').click()");
            waitFor("!!document.querySelector('#task-form')",10);
            InputMethodManager input=(InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->input.hideSoftInputFromWindow(activity.browserForTests().getWindowToken(),0));
            waitFor("!document.documentElement.classList.contains('keyboard-open')",15);
            Thread.sleep(300);
            int originalHeight=Integer.parseInt(eval("innerHeight"));
            eval("document.querySelector('#task-form [name=details]').focus()");
            Thread.sleep(300);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{activity.browserForTests().requestFocus();input.showSoftInput(activity.browserForTests(),InputMethodManager.SHOW_IMPLICIT);});
            waitFor("document.documentElement.classList.contains('keyboard-open')",15);
            Thread.sleep(400);
            assertTrue(Integer.parseInt(eval("innerHeight"))<originalHeight-100);
            eval("document.querySelector('dialog .modal-body').scrollTop=10000");
            waitFor("(()=>{const save=document.querySelector('#task-form button[type=submit]').getBoundingClientRect();return save.top>=0 && save.bottom<=innerHeight;})()",10);
            assertEquals("true",eval("document.activeElement.name==='details'"));
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->input.hideSoftInputFromWindow(activity.browserForTests().getWindowToken(),0));
            waitFor("!document.documentElement.classList.contains('keyboard-open')",15);
            assertTrue(Math.abs(originalHeight-Integer.parseInt(eval("innerHeight")))<12);
            eval("document.querySelector('dialog[open]').close()");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.browserForTests().getSettings().setTextZoom(130));
            Thread.sleep(300);
            assertEquals("true",eval("document.documentElement.scrollWidth<=innerWidth"));
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            waitFor("innerWidth>innerHeight && innerWidth>650 && getComputedStyle(document.querySelector('.sidebar')).position==='sticky'",15);
            assertEquals("true",eval("document.documentElement.scrollWidth<=innerWidth"));
            eval("document.querySelector('.sidebar-toggle').click()");
            waitFor("document.querySelector('.sidebar').getBoundingClientRect().width<100 && document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')==='false'",10);
            assertEquals("true",eval("(()=>{const s=document.querySelector('.native-utility [data-action=settings]').getBoundingClientRect();return s.top>=0 && s.bottom<=innerHeight;})()"));
            eval("document.querySelector('#home-manual').click()");
            waitFor("!!document.querySelector('#task-form')",10);
            eval("document.querySelector('dialog .modal-body').scrollTop=10000");
            assertEquals("true",eval("(()=>{const r=document.querySelector('#task-form button[type=submit]').getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0;})()"));
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.finish()); }
    }
}
