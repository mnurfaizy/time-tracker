import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUrl } from '../lib/google.js';
import { createZip } from '../lib/zip.js';

const r = Router();
const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}

// Download the browser extension, preconfigured for this server's address.
r.get('/download', (req, res) => {
  const origin = new URL(appUrl(req)).origin;
  const files = listFiles(extDir).map((name) => {
    let data = fs.readFileSync(path.join(extDir, name));
    if (name === 'manifest.json' || name === 'config.js') data = Buffer.from(data.toString('utf8').replaceAll('__SERVER_ORIGIN__', origin));
    return { name: `time-tracker-extension/${name}`, data };
  });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="time-tracker-extension.zip"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(createZip(files));
});

export default r;
