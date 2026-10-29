// Separate database: completing a task-import draft cannot delete timetable images.
let connection;
function database() {
  return connection ||= new Promise((resolve, reject) => {
    let blocked=false;
    const request = indexedDB.open('shike-course-drafts', 2);
    request.onupgradeneeded = () => {for(const name of ['drafts','images'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
    request.onsuccess = () => {const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    request.onblocked = () => {blocked=true;connection=null;reject(new Error('请关闭其他打开的拾课页面后，重新打开课程截图导入。原草稿仍然保留。'));};
    request.onerror = () => { connection = null; reject(new Error('无法保存课程表草稿，请检查存储空间。')); };
  });
}
export async function courseDraft(action, value, key = 'import') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts','images'], action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('drafts'),images=tx.objectStore('images'),prefix=key+'/';let result;
    if(action==='get'){
      const request=store.get(key);request.onsuccess=()=>{
        result=request.result;
        // Read old inline-file drafts directly. The next atomic save migrates them.
        for(const source of result?.sources||[])if(!source.file){const file=images.get(prefix+source.id);file.onsuccess=()=>{if(file.result)source.file=file.result;};}
      };
    }else{
      const keys=images.getAllKeys();keys.onsuccess=()=>{
        const existing=new Set(keys.result),keep=new Set(action==='delete'?[]:(value.sources||[]).map(s=>prefix+s.id));
        for(const id of existing)if(typeof id==='string'&&id.startsWith(prefix)&&!keep.has(id))images.delete(id);
        if(action==='delete')store.delete(key);
        else{
          for(const source of value.sources||[])if(source.file&&!existing.has(prefix+source.id))images.put(source.file,prefix+source.id);
          // Editing/progress saves rewrite only metadata, never every screenshot.
          store.put({...value,sources:(value.sources||[]).map(({file,...source})=>source)},key);
        }
      };
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error('课程表草稿保存失败，请检查存储空间后重试。'));
    tx.onabort = () => reject(new Error('课程表草稿保存中断，请重试。'));
  });
}
