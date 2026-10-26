package cn.shike.study;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FileSelectionTest {
    @Test public void selectedDocumentsPreserveMultipleImagesAndIgnoreDuplicateOrRemoteUris() {
        Uri first = Uri.parse("content://test/images/1"), second = Uri.parse("content://test/images/2");
        ClipData clip = ClipData.newRawUri("screenshots", first);
        clip.addItem(new ClipData.Item(second));
        clip.addItem(new ClipData.Item(Uri.parse("https://example.com/image.png")));
        Intent selected = new Intent().setData(first);
        selected.setClipData(clip);
        assertArrayEquals(new Uri[]{first, second}, MainActivity.selectedFiles(selected));
        assertArrayEquals(new Uri[]{first}, MainActivity.selectedFiles(new Intent().setData(first)));
        assertNull(MainActivity.selectedFiles(null));
    }
}
