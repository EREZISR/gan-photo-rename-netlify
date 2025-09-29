// Netlify Function: receive files + names, zip with target names, upload to file.io (one-time link), return URL
import archiver from 'archiver';
import multipart from 'lambda-multipart-parser';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return { statusCode: 400, body: 'Expected multipart/form-data' };
    }
    const parsed = await multipart.parse(event);
    const namesField = parsed.fields?.names;
    if (!namesField) return { statusCode: 400, body: 'Missing names' };
    let names;
    try { names = JSON.parse(namesField); } catch { return { statusCode: 400, body: 'Bad names JSON' }; }
    const files = parsed.files || [];
    if (!files.length) return { statusCode: 400, body: 'No files' };
    if (names.length !== files.length) return { statusCode: 400, body: 'Names count mismatch' };

    const zipBuffer = await makeZipBuffer(files, names);

    const form = new FormData();
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'gan_photos.zip');

    const resp = await fetch('https://file.io/?auto=1', { method: 'POST', body: form });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('file.io upload failed: ' + txt);
    }
    const data = await resp.json();
    if (!data || !data.link) throw new Error('file.io: no link');

    return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ url: data.link }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error: ' + err.message };
  }
};

function sanitize(name) {
  return (name || '').trim().replace(/[^0-9A-Za-z\u0590-\u05FF \._-]/g, '_').replace(/\s{2,}/g, ' ');
}

function makeZipBuffer(files, names) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('warning', (e) => console.warn(e));
    archive.on('error', reject);
    archive.on('data', (d) => chunks.push(d));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    files.forEach((f, i) => {
      const fname = sanitize(names[i] || f.filename || 'תמונה');
      const buf = Buffer.from(f.content, 'base64');
      archive.append(buf, { name: fname });
    });
    archive.finalize();
  });
}
