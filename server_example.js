// server.js
// npm i express body-parser uuid cloudinary multer multer-storage-cloudinary node-fetch

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// === Configure Cloudinary ===
cloudinary.config({
  cloud_name: 'dxouurt3f', // Your cloud name
  api_key: '867862983437672',
  api_secret: 'FXKOdYZqkQgeL8VfAA2PIU2tw4E'
});

// === Multer Storage ===
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shakhna_uploads',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'docx', 'html']
  }
});
const parser = multer({ storage });

// === Upload Homework ===
app.post('/api/upload_homework', parser.single('file'), async (req, res) => {
  try {
    const { title, studentEmail, due_date } = req.body;
    if (!req.file || !title || !studentEmail || !due_date)
      return res.status(400).json({ error: 'Missing required fields' });

    const publicUrl = req.file.path;

    const record = {
      fields: {
        Title: title,
        studentEmail,
        "Due Date": due_date,
        Attachments: [
          { url: publicUrl, filename: req.file.originalname }
        ]
      }
    };

    // === Airtable API ===
    const AIRTABLE_BASE = 'YOUR_BASE_ID';
    const HOMEWORKS_TABLE = 'HOMEWORKS';
    const AIRTABLE_TOKEN = 'YOUR_API_KEY';

    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${HOMEWORKS_TABLE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(record)
      }
    );

    const data = await airtableRes.json();
    if (!airtableRes.ok) return res.status(400).json({ error: data });

    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'upload_failed' });
  }
});

// === Start Server ===
app.listen(3000, () => console.log('Server running on http://localhost:3000'));
