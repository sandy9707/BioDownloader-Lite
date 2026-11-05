import { existsSync } from 'node:fs';
// Finder-launched macOS applications do not inherit the terminal Homebrew PATH.
export function toolPath(name) {
  if (process.platform === 'darwin') {
    const paths = name === 'aria2c' ? ['/opt/homebrew/bin/aria2c', '/usr/local/bin/aria2c'] : ['/usr/bin/curl'];
    return paths.find(path => existsSync(path)) || name;
  }
  if (process.platform === 'win32' && name === 'curl') {
    const system = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\curl.exe`;
    return existsSync(system) ? system : 'curl.exe';
  }
  return name;
}
