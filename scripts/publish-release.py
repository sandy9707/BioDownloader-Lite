#!/usr/bin/env python3
"""Publish an immutable complete four-platform installer build, never clobber."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REPO = 'sandy9707/BioDownloader-Lite'
def gh(*args):
    return subprocess.check_output(['gh', *map(str, args)], text=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--run', required=True)
    p.add_argument('--tag', required=True)
    p.add_argument('--directory', required=True)
    p.add_argument('--notes', required=True)
    args = p.parse_args()
    run = json.loads(gh('run', 'view', args.run, '--repo', REPO, '--json', 'headSha,conclusion,workflowName'))
    if run['conclusion'] != 'success' or run['workflowName'] != 'Build Lite installers':
        raise RuntimeError('A successful complete installer workflow is required')
    version = gh('api', f'repos/{REPO}/contents/package.json?ref={run["headSha"]}', '-H', 'Accept: application/vnd.github.raw+json')
    if args.tag != 'v' + json.loads(version)['version']:
        raise RuntimeError('Tag/package version mismatch')
    existing = json.loads(gh('api', f'repos/{REPO}/releases'))
    if any(r['tag_name'] == args.tag for r in existing):
        raise RuntimeError('Release exists: never overwrite published assets')
    dest = Path(args.directory).resolve()
    dest.mkdir(parents=True, exist_ok=False)
    subprocess.run(['gh', 'run', 'download', args.run, '--repo', REPO, '--dir', str(dest)], check=True)
    files = sorted(f for f in dest.rglob('*') if f.is_file() and f.suffix in ('.exe', '.dmg', '.zip', '.AppImage', '.deb'))
    expected = {'win32-x64.exe', 'mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip', 'linux-x64.AppImage', 'linux-x64.deb'}
    actual = {f.name.removeprefix(f'BioDownloader-Lite-{args.tag[1:]}-') for f in files}
    # electron-builder uses "win" or "win32" depending on platform macro.
    actual = {'win32-x64.exe' if n == 'win-x64.exe' else n for n in actual}
    if actual != expected or any(f.stat().st_size < 1_000_000 for f in files):
        raise RuntimeError(f'Incomplete or unexpected installer set: {actual}')
    manifest = dest/'release-manifest.json'
    manifest.write_text(json.dumps(dict(tag=args.tag, commit=run['headSha'], buildRun=args.run,
        files=[dict(name=f.name, bytes=f.stat().st_size, sha256=hashlib.file_digest(f.open('rb'), 'sha256').hexdigest()) for f in files]), indent=2)+'\n')
    checksum = dest/'SHA256SUMS'
    data = json.loads(manifest.read_text())
    checksum.write_text(''.join(f'{r["sha256"]}  {r["name"]}\n' for r in data['files']))
    subprocess.run(['gh', 'release', 'create', args.tag, '--repo', REPO, '--target', run['headSha'],
        '--title', f'BioDownloader Lite {args.tag[1:]} Preview', '--prerelease', '--notes-file', args.notes,
        *map(str, files), str(manifest), str(checksum)], check=True)

if __name__ == '__main__':
    main()
