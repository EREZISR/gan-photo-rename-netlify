# Gan Photo Rename (Netlify)
אתר קטן להעלאת תמונות מהטלפון, מתן שמות קבצים, וקבלת לינק הורדה חד־פעמי ל-ZIP.

## פריסה מהירה
1) פתח ריפו חדש ב-GitHub והעלה את הקבצים.
2) Netlify → New site from Git → בחר את הריפו.
3) אחרי Deploy, שלח לגננת את הקישור.

- `public/index.html` – הממשק.
- `netlify/functions/upload.js` – פונקציה שיוצרת ZIP ומעלה ל-file.io (נמחק אחרי הורדה).