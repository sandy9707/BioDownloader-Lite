#!/usr/bin/env python3
"""Local scheduled mirror of complete published installer releases; no credentials in repo."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPO = 'sandy9707/BioDownloader-Lite'
BASE = '/apps/baidupcs/BioDownloader-Lite'
def command(*args, timeout=900):
    return subprocess.check_output(list(map(str,args)), text=True, stderr=subprocess.STDOUT, timeout=timeout)
def main():
    p = argparse.ArgumentParser()
    p.add_argument('--state', required=True)
    p.add_argument('--tag')
    args = p.parse_args()
    root = Path(args.state).resolve(); root.mkdir(parents=True, exist_ok=True)
    lock = root/'sync.lock'
    try: fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError: raise RuntimeError('Sync lock exists; inspect prior process before retry')
    os.write(fd, str(os.getpid()).encode()); os.close(fd)
    try:
        command('BaiduPCS-Go','who',timeout=20)
        releases = json.loads(command('gh','api',f'repos/{REPO}/releases',timeout=30))
        for release in reversed(releases):
            tag = release['tag_name']
            if release['draft'] or (args.tag and tag != args.tag) or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[\w.]+)?',tag): continue
            # A full-install release is a "big package"; hot-update-only releases are excluded.
            names = {a['name'] for a in release['assets']}
            if 'release-manifest.json' not in names or not any(n.endswith('.exe') for n in names): continue
            done = root/f'{tag}.verified.json'
            if done.exists(): continue
            folder = root/tag; folder.mkdir(exist_ok=True)
            manifest_file = folder/'release-manifest.json'
            if not manifest_file.exists(): command('gh','release','download',tag,'--repo',REPO,'--pattern','release-manifest.json','--dir',folder)
            manifest = json.loads(manifest_file.read_text())
            if manifest['tag'] != tag: raise RuntimeError('Manifest tag mismatch')
            files = manifest['files']
            if len(files) != 7 or len({f['name'] for f in files}) != 7: raise RuntimeError('Expected seven installers')
            for row in files:
                name = row['name']
                if Path(name).name != name or not name.startswith(f'BioDownloader-Lite-{tag[1:]}-'): raise RuntimeError('Unsafe asset name')
                local = folder/name
                if not local.exists(): command('gh','release','download',tag,'--repo',REPO,'--pattern',name,'--dir',folder)
                with local.open('rb') as handle: digest = hashlib.file_digest(handle,'sha256').hexdigest()
                if local.stat().st_size != row['bytes'] or digest != row['sha256']: raise RuntimeError('Local release checksum mismatch')
            remote = BASE+'/'+tag
            command('BaiduPCS-Go','mkdir',BASE,remote,timeout=60)
            # Skip policy only: same-name conflicts are not overwritten, then exact sizes verified.
            for row in files:
                print('Upload',tag,row['name'],flush=True)
                print(command('BaiduPCS-Go','upload','-p','1','-l','1','--retry','1','--policy','skip',folder/row['name'],remote,timeout=1800),flush=True)
            for row in files:
                meta = command('BaiduPCS-Go','meta',remote+'/'+row['name'],timeout=60)
                sizes = re.findall(r'(?:文件大小|大小)\s*[:：]?\s*(\d+)(?:,|\s|$)',meta,re.M)
                if not sizes or int(sizes[0].replace(',','')) != row['bytes']:
                    raise RuntimeError(f'Cannot verify exact remote bytes: {row["name"]}\n{meta}')
            done.write_text(json.dumps(dict(tag=tag,remote=remote,files=files),indent=2)+'\n')
            print('Verified',remote,flush=True)
    finally:
        lock.unlink(missing_ok=True)
if __name__ == '__main__':
    main()
