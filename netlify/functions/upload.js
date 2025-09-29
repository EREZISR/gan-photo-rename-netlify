// Netlify Function: מקבל קבצים + שמות (אם נשלחו), יוצר ZIP, מעלה ל-file.io ומחזיר לינק הורדה.
import archiver from 'archiver';
import multipart from 'lambda-multipart-parser';
import FormData from 'form-data'; // ← חשוב: FormData ל-Node

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
    if (!ct.startsWith('multipart/form-data')) {
      return json(400, { error: 'Expected multipart/form-data' });
    }

    const parsed = await multipart.parse(event);
    const files = parsed.files || [];
    if (!files.length) return json(400, { error: 'No files' });

    // קבלת שמות בצורה סלחנית
    let names = [];
    if (parsed.multiValueFields && parsed.multiValueFields['names[]']) {
      names = parsed.multiValueFields['names[]'];
    } else if (parsed.fields && parsed.fields['names[]']) {
      names = Array.isArray(parsed.fields['names[]']) ? parsed.fields['names[]'] : [parsed.fields['names[]']];
    } else if (parsed.fields && parsed.fields.names) {
      try { names = JSON.parse(parsed.fields.names); } catch { names = []; }
    }
    if (!names.length || names.length !== files.length) {
      names = files.map((f, i) => sanitize(f.filename || `image_${i+1}.jpg`));
    }

    // בנה ZIP בזיכרון (Buffer)
    const zipBuffer = await makeZipBuffer(files, names);

    // העלאה ל-file.io עם form-data של Node
    const fd = new FormData();
    fd.append('file', zipBuffer, { filename: 'gan_photos.zip', contentType: 'application/zip' });
    // לינק חד-פעמי; אפשר להחליף ל-?expires=1d כדי לפוג אחרי יום
    const resp = await fetch('https://file.io/?auto=1', { method: 'POST', body: fd, headers: fd.getHeaders() });
    if (!resp.ok) {
      const txt = await resp.text();
      return json(502, { error: 'file.io upload failed', details: txt });
    }
    const data = await resp.json();
    if (!data?.link) return json(502, { error: 'file.io: no link in response', raw: data });

    return json(200, { url: data.link });
  } catch (err) {
    return json(500, { error: 'Server error', message: err.message });
  }
};

// ------- helpers -------
function json(status, obj) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}

function sanitize(s) {
  return (s || '').trim()
    .replace(/[^0-9A-Za-z\u0590-\u05FF \._-]/g, '_')
    .replace(/\s{2,}/g, ' ');
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
      const fname = sanitize(names[i] || f.filename || `image_${i+1}.jpg`);
      const buf = Buffer.from(f.content, 'base64'); // parser מחזיר base64
      archive.append(buf, { name: fname });
    });
    archive.finalize();
  });
}
