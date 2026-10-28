// Separate database: completing a task-import draft cannot delete timetable images.
let connection;
function database() {
  return connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('shike-course-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(new Error('无法保存课程表草稿，请检查存储空间。')); };
  });
}
export async function courseDraft(action, value, key = 'import') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('drafts');
    const request = action === 'get' ? store.get(key) : action === 'delete' ? store.delete(key) : store.put(value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(new Error('课程表草稿保存失败，请检查存储空间后重试。'));
    tx.onabort = () => reject(new Error('课程表草稿保存中断，请重试。'));
  });
}
