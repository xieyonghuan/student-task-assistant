package cn.shike.study;

import android.content.*;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.*;
import java.util.*;

final class TaskCardStore {
    static Intent create(Context context,String encoded) throws Exception {
        if(encoded.length()>12000000)throw new IllegalArgumentException("图片卡片过大，请减少任务数量。");
        byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
        if(bytes.length>8*1024*1024)throw new IllegalArgumentException("图片卡片过大，请减少任务数量。");
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
        if(!"image/png".equals(bounds.outMimeType)||bounds.outWidth<=0||bounds.outHeight<=0||(long)bounds.outWidth*bounds.outHeight>16000000)throw new IllegalArgumentException("图片卡片格式无效。");
        File dir=new File(context.getCacheDir(),"task-cards");if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法创建分享图片，请检查可用空间。");
        File[] existing=dir.listFiles(file->file.isFile()&&file.getName().matches("[a-f0-9-]{36}\\.png"));
        if(existing!=null){Arrays.sort(existing,Comparator.comparingLong(File::lastModified));for(int i=0;i<existing.length;i++)if(i<existing.length-49||System.currentTimeMillis()-existing[i].lastModified()>86400000L)existing[i].delete();}
        File image=new File(dir,UUID.randomUUID()+".png");try(OutputStream out=new FileOutputStream(image)){out.write(bytes);}
        Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".taskcards",image);
        Intent intent=new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("拾课课程任务",uri));return intent;
    }
}
