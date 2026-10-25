// Run locally. Only the public APK signature patch is committed; the key never leaves this PC.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { applySignature } from './apply-android-signature.mjs';

const [baseCommit, toolsDir, javaDir] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(baseCommit || '')) throw new Error('Provide the reviewed Android build commit');
const privateDir = path.resolve('../work/private/android-signing');
await mkdir(privateDir, {recursive:true});
const key = path.join(privateDir, 'shike-release.p12'), secret = path.join(privateDir, 'password.txt');
const java = path.join(javaDir, process.platform === 'win32' ? 'java.exe' : 'java');
const keytool = path.join(javaDir, process.platform === 'win32' ? 'keytool.exe' : 'keytool');
try { await access(key); }
catch {
  await writeFile(secret, randomBytes(48).toString('base64url'), {mode:0o600});
  execFileSync(keytool, ['-genkeypair','-keystore',key,'-storetype','PKCS12','-alias','shike','-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10000','-dname','CN=Shike, O=Personal Study, C=CN','-storepass:file',secret,'-keypass:file',secret], {stdio:'inherit'});
}
const unsigned = path.resolve(toolsDir, 'app-release-unsigned.apk');
const signed = path.resolve('../outputs/shike-v1.1.0.apk');
const signer = path.resolve(toolsDir, 'apksigner.jar');
execFileSync(java, ['-jar',signer,'sign','--ks',key,'--ks-key-alias','shike','--ks-pass',`file:${secret}`,'--key-pass',`file:${secret}`,'--v1-signing-enabled','false','--v2-signing-enabled','true','--v3-signing-enabled','true','--v4-signing-enabled','false','--out',signed,unsigned], {stdio:'inherit'});
execFileSync(java, ['-jar',signer,'verify','--verbose','--print-certs',signed], {stdio:'inherit'});
const before = await readFile(unsigned), after = await readFile(signed);
let prefix=0, suffix=0;
while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
while (suffix < before.length-prefix && suffix < after.length-prefix && before[before.length-1-suffix] === after[after.length-1-suffix]) suffix++;
const hash = data => createHash('sha256').update(data).digest('hex');
const patch = {format:'shike-apk-signature-v1', baseCommit, baseRelease:`android-build-${baseCommit}`, prefix, suffix,
  middle:after.subarray(prefix,after.length-suffix).toString('base64'), bytes:after.length, baseSHA256:hash(before), signedSHA256:hash(after)};
if (patch.middle.length > 400000) throw new Error('Unexpected APK rewrite; refusing to publish a large signature patch');
if (!applySignature(before,patch).equals(after)) throw new Error('APK reconstruction mismatch');
await mkdir('android/release', {recursive:true});
await writeFile('android/release/signature.json', JSON.stringify(patch,null,2)+'\n');
await writeFile('../outputs/shike-v1.1.0.sha256', `${patch.signedSHA256}  shike-v1.1.0.apk\n`);
console.log(`Signed locally; public signature patch is ${patch.middle.length} characters; private key remains in work/private/android-signing.`);
