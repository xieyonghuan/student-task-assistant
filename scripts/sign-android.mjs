// Run locally. Only the public APK signature patch is committed; the key never leaves this PC.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { applySignature } from './apply-android-signature.mjs';

const [baseCommit, toolsDir, javaDir] = process.argv.slice(2);
const {version} = JSON.parse(await readFile('package.json','utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid app version');
if (!/^[a-f0-9]{40}$/.test(baseCommit || '')) throw new Error('Provide the reviewed Android build commit');
const privateDir = path.resolve('../work/private/android-signing');
await mkdir(privateDir, {recursive:true});
const key = path.join(privateDir, 'shike-release.p12'), secret = path.join(privateDir, 'password.txt');
const java = path.join(javaDir, process.platform === 'win32' ? 'java.exe' : 'java');
const keytool = path.join(javaDir, process.platform === 'win32' ? 'keytool.exe' : 'keytool');
try { await access(key); }
catch {
  if (version !== '1.1.0') throw new Error('Original signing key is missing; refusing to generate a different key for an upgrade');
  await writeFile(secret, randomBytes(48).toString('base64url'), {mode:0o600});
  execFileSync(keytool, ['-genkeypair','-keystore',key,'-storetype','PKCS12','-alias','shike','-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10000','-dname','CN=Shike, O=Personal Study, C=CN','-storepass:file',secret,'-keypass:file',secret], {stdio:'inherit'});
}
const unsigned = path.resolve(toolsDir, 'app-release-unsigned.apk');
const signed = path.resolve(`../outputs/shike-v${version}.apk`);
const signer = path.resolve(toolsDir, 'apksigner.jar');
execFileSync(java, ['-jar',signer,'sign','--ks',key,'--ks-key-alias','shike','--ks-pass',`file:${secret}`,'--v1-signing-enabled','false','--v2-signing-enabled','true','--v3-signing-enabled','true','--v4-signing-enabled','false','--out',signed,unsigned], {stdio:'inherit'});
const verification=execFileSync(java, ['-jar',signer,'verify','--verbose','--print-certs',signed], {encoding:'utf8'});
process.stdout.write(verification);
const certificateSHA256=(await readFile('android/signing-certificate.sha256','utf8')).trim();
if(verification.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1]!==certificateSHA256)throw new Error('APK signing certificate differs from v1.1; refusing to publish an incompatible upgrade');
const before = await readFile(unsigned), after = await readFile(signed);
const hash = data => createHash('sha256').update(data).digest('hex');
function entries(data) {
  let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50 && i+22+data.readUInt16LE(i+20)===data.length){end=i;break;}
  if(end<0)throw new Error('ZIP directory not found');
  const result=[];let cursor=data.readUInt32LE(end+16);
  for(let i=0;i<data.readUInt16LE(end+10);i++){
    if(data.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid ZIP entry');
    const length=data.readUInt32LE(cursor+20),nameLength=data.readUInt16LE(cursor+28),extra=data.readUInt16LE(cursor+30),comment=data.readUInt16LE(cursor+32),local=data.readUInt32LE(cursor+42);
    if(data.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid local ZIP entry');
    result.push({name:data.subarray(cursor+46,cursor+46+nameLength).toString('utf8'),start:local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28),length});
    cursor+=46+nameLength+extra+comment;
  }
  return result;
}
const original=new Map(entries(before).map(entry=>[entry.name,entry]));
const operations=[];let cursor=0, literalSize=0;
const literal=data=>{if(data.length){literalSize+=data.length;operations.push({data:data.toString('base64')});}};
for(const entry of entries(after).sort((a,b)=>a.start-b.start)){
  const source=original.get(entry.name);
  if(!source||source.length!==entry.length||!before.subarray(source.start,source.start+source.length).equals(after.subarray(entry.start,entry.start+entry.length)))throw new Error('Signer unexpectedly rewrote an APK payload');
  if(entry.start<cursor)throw new Error('Overlapping ZIP payloads');
  literal(after.subarray(cursor,entry.start));
  operations.push({copy:[source.start,source.length]});cursor=entry.start+entry.length;
}
literal(after.subarray(cursor));
if(literalSize>1000000)throw new Error('Unexpected APK metadata size');
const patch = {format:'shike-apk-signature-v2', version, certificateSHA256, baseCommit, baseRelease:`android-build-${baseCommit}`, operations,
  bytes:after.length, baseSHA256:hash(before), signedSHA256:hash(after)};
if (!applySignature(before,patch).equals(after)) throw new Error('APK reconstruction mismatch');
await mkdir('android/release', {recursive:true});
await writeFile('android/release/signature.json', JSON.stringify(patch,null,2)+'\n');
await writeFile(`../outputs/shike-v${version}.sha256`, `${patch.signedSHA256}  shike-v${version}.apk\n`);
console.log(`Signed locally; public signature patch contains ${literalSize} metadata bytes; private key remains in work/private/android-signing.`);
