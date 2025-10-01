// Netlify Function: מקבל קבצים + שמות (אם נשלחו), יוצר ZIP בזיכרון,
// מעלה ל-file.io ומחזיר לינק חד-פעמי כ-JSON. כולל טיפול בשגיאות ברורות.
import archiver from 'archiver';
import multipart from 'lambda-multipart-parser';
import FormData from 'form-data'; // FormData ל-Node (חשוב: הוסף "form-data" ל-package.json)

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
    if (!ct.startsWith('multipart/form-data')) {
      return json(400, { error: 'Expected multipart/form-data' });
    }

    // פירוק ה-multipart
    const parsed = await multipart.parse(event);
    const files = parsed.files || [];
    if (!files.length) return json(400, { error: 'No files' });

    // ---- איסוף שמות בצורה סלחנית ----
    let names = [];
    // 1) names[] (ריבוי שדות)
    if (parsed.multiValueFields && parsed.multiValueFields['names[]']) {
      names = parsed.multiValueFields['names[]'];
    } else if (parsed.fields && parsed.fields['names[]']) {
      names = Array.isArray(parsed.fields['names[]'])
        ? parsed.fields['names[]']
        : [parsed.fields['names[]']];
    }
    // 2) names כ-JSON מחרוזת
    else if (parsed.fields && parsed.fields.names) {
      try { names = JSON.parse(parsed.fields.names); } catch { names = []; }
    }
    // 3) fallback: אין שמות או לא בהלימה לכמות הקבצים → השתמש בשם המקורי
    if (!names.length || names.length !== files.length) {
      names = files.map((f, i) => {
        const base = sanitize(f.filename || `image_${i + 1}.jpg`);
        return base || `image_${i + 1}.jpg`;
      });
    }

    // יצירת ZIP לתוך Buffer
    const zipBuffer = await makeZipBuffer(files, names);

    // העלאה ל-file.io – ננהל תשובה כטקסט כדי לזהות HTML/JSON
    const fd = new FormData();
    fd.append('file', zipBuffer, { filename: 'gan_photos.zip', contentType: 'application/zip' });

    const resp = await fetch('https://file.io/?auto=1', {
      method: 'POST',
      body: fd,
      headers: fd.getHeaders()
    });

    const respType = (resp.headers.get('content-type') || '').toLowerCase();
    const raw = await resp.text();

    // נסה לפענח JSON; אם קיבלנו HTML או טקסט – החזר שגיאה מפורטת
    let data = null;
    try { data = JSON.parse(raw); } catch {
      return json(502, {
        error: 'file.io bad response (not JSON)',
        status: resp.status,
        contentType: respType,
        bodyPreview: raw.slice(0, 300)
      });
    }

    const link = data.link || data.data?.link;
    if (!resp.ok || !link) {
      return json(502, { error: 'file.io upload failed', status: resp.status, response: data });
    }

    return json(200, { url: link });
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
  return (s || '')
    .trim()
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
      const fname = sanitize(names[i] || f.filename || `image_${i + 1}.jpg`);
      const buf = Buffer.from(f.content, 'base64'); // parser מחזיר Base64
      archive.append(buf, { name: fname });
    });

    archive.finalize();
  });
}
