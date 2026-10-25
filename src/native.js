// Available only in the bundled Android app, injected for its local origin.
export const isNativeApp = () => typeof globalThis.ShikeNative?.postMessage === 'function';
let sequence = 0;
const pending = new Map();
function attach() {
  if (!isNativeApp()) return;
  globalThis.ShikeNative.onmessage = event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const call = pending.get(data.id);
    if (!call) return;
    clearTimeout(call.timer); pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(new Error(data.error || '系统日历暂时没有完成同步。'));
  };
}
export function nativeCall(method, args = {}) {
  if (!isNativeApp()) return Promise.reject(new Error('此功能需要拾课 Android 安装版。'));
  attach();
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('系统操作等待超时。任务仍已保存在拾课中，请重试同步。')); }, 120000);
    pending.set(id, { resolve, reject, timer });
    try { globalThis.ShikeNative.postMessage(JSON.stringify({ id, method, args })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
