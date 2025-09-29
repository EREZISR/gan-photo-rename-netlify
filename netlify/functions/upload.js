// Netlify Function: מקבל קבצים + שמות (אם נשלחו), יוצר ZIP, מעלה ל-file.io ומחזיר לינק הורדה.
import archiver from 'archiver';
import multipart from 'lambda-multipart-parser';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
    if (!ct.startsWith('multipart/form-data')) {
      return { statusCode: 400, body: 'Expected multipart/form-data' };
    }

    // פרסר מולטי-פארט
    const parsed = await multipart.parse(event);
    const files = parsed.files || [];
    if (!files.length) return { statusCode: 400, body: 'No files' };

    // --- קבלת שמות בצורה סופר-סלחנית ---
    let names = [];

    // 1) names[] מרובים
    if (parsed.multiValueFields && parsed.multiValueFields['names[]']) {
      names = parsed.multiValueFields['names[]'];
    } else if (parsed.fields && parsed.fields['names[]']) {
      names = Array.isArray(parsed.fields['names[]']) ? parsed.fields['names[]'] : [parsed.fields['names[]']];
    }
    // 2) names כ-JSON (מחרוזת)
    else if (parsed.fields && parsed.fields.names) {
      try { names = JSON.parse(parsed.fields.names); } catch { names = []; }
    }

    // 3) אם לא התקבלו שמות תואמים – נופלים חזרה לשמות הקבצים שהגיעו מהדפדפן
    if (!names.length || names.length !== files.length) {
      names = files.map((f, i) => {
        const base = sanitize(f.filename || `image_${i+1}`);
        return base || `image_${i+1}.jpg`;
      });
    }

    // בניית ZIP בזיכרון
    const zipBuffer = await makeZipBuffer(files, names);

    // העלאה ל-file.io (לינק חד-פעמי; אפשר להחליף ל-?expires=1d)
    const form = new FormData();
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'gan_photos.zip');

    const resp = await fetch('https://file.io/?auto=1', { method: 'POST', body: form });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    if (!data?.link) throw new Error('file.io: no link');

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ url: data.link })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error: ' + err.message };
  }
};

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
