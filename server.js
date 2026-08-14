const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// --- ENVIRONMENT CONFIGURATION ---
const SENDER_EMAIL = process.env.SENDER_EMAIL || "test@example.com";
const SENDER_APP_PASSWORD = process.env.SENDER_APP_PASSWORD || "password";
const FRONTEND_URL = "https://shekhar22697-cmd.github.io/medical-nfc-backend/patient-portal.html";

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER_EMAIL, pass: SENDER_APP_PASSWORD }
});

const USERS_DB = {}; 
const CARD_MAP_DB = {};
const RESET_TOKENS = {};
let CLINIC_QUEUE = []; // Active waiting room queue

app.get('/', (req, res) => {
  res.send('Shekhar, Vinayak & Randhir Clinical API is active!');
});

// Patient Registration
app.post('/api/patient/register', (req, res) => {
  const { email, password, name, dob, bloodType, insurance, allergies, conditions, emergencyContact } = req.body;
  
  if (USERS_DB[email]) {
    return res.status(400).json({ error: "Account already exists with this email." });
  }

  USERS_DB[email] = {
    email, password, name, dob, bloodType,
    insurance: insurance || {},
    allergies: allergies || [],
    conditions: conditions || [],
    emergencyContact: emergencyContact || "",
    document: null,
    linkedCardId: null,
    vitals: null,
    consultation: null
  };

  res.json({ success: true, message: "Account registered successfully!", user: USERS_DB[email] });
});

// Patient Login
app.post('/api/patient/login', (req, res) => {
  const { email, password } = req.body;
  const user = USERS_DB[email];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ success: true, user });
});

// Send Reset Email
app.post('/api/patient/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = USERS_DB[email];

  if (!user) return res.status(404).json({ error: "No account found with this email." });

  const token = crypto.randomBytes(32).toString('hex');
  RESET_TOKENS[token] = { email, expiresAt: Date.now() + 30 * 60 * 1000 };

  const resetLink = `${FRONTEND_URL}?resetToken=${token}`;
  const mailOptions = {
    from: `"Clinic Medical Desk" <${SENDER_EMAIL}>`,
    to: email,
    subject: "Reset Your Clinic Portal Password",
    html: `<div style="font-family: sans-serif; padding: 20px;">
      <h2>Password Reset Request</h2>
      <p>Hello ${user.name}, click below to reset your password:</p>
      <a href="${resetLink}" style="background:#0284c7;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Reset Password</a>
    </div>`
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Password reset link sent to your email!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to dispatch email. Check server configuration." });
  }
});

// Reset Password with Token
app.post('/api/patient/reset-password-with-token', (req, res) => {
  const { token, newPassword } = req.body;
  const tokenData = RESET_TOKENS[token];

  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired token link." });
  }

  if (USERS_DB[tokenData.email]) {
    USERS_DB[tokenData.email].password = newPassword;
    delete RESET_TOKENS[token];
    res.json({ success: true, message: "Password reset successfully!" });
  } else {
    res.status(404).json({ error: "User not found." });
  }
});

// Update Profile & Folders
app.post('/api/patient/update-profile', (req, res) => {
  const { email, allergies, conditions, emergencyContact, insurance, document } = req.body;
  const user = USERS_DB[email];

  if (!user) return res.status(404).json({ error: "User not found" });

  if (allergies) user.allergies = allergies;
  if (conditions) user.conditions = conditions;
  if (emergencyContact) user.emergencyContact = emergencyContact;
  if (insurance) user.insurance = insurance;
  if (document) user.document = document;

  res.json({ success: true, user });
});

// Clinic: Link / Replace Card
app.post('/api/clinic/link-card', (req, res) => {
  const { cardId, email } = req.body;
  const user = USERS_DB[email];
  
  if (!user) return res.status(404).json({ error: "No patient account found with that email." });

  // Clean old link if re-assigning
  if (user.linkedCardId && CARD_MAP_DB[user.linkedCardId]) {
    delete CARD_MAP_DB[user.linkedCardId];
  }

  user.linkedCardId = cardId;
  CARD_MAP_DB[cardId] = email;

  res.json({ success: true, message: `Card ID '${cardId}' successfully assigned to ${user.name}` });
});

// Clinic: Scan Card & Add to Check-In Queue
app.get('/api/clinic/scan/:cardId', (req, res) => {
  const { cardId } = req.params;
  const patientEmail = CARD_MAP_DB[cardId];

  if (!patientEmail || !USERS_DB[patientEmail]) {
    return res.status(404).json({ error: "Unregistered card. No patient linked to this NFC tag." });
  }

  const patient = USERS_DB[patientEmail];
  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const exists = CLINIC_QUEUE.find(q => q.email === patientEmail && q.status === 'Waiting');
  if (!exists) {
    CLINIC_QUEUE.unshift({
      id: Date.now().toString(),
      name: patient.name,
      email: patient.email,
      cardId: cardId,
      time: timeString,
      status: 'Waiting'
    });
  }

  res.json({ success: true, patient, queue: CLINIC_QUEUE });
});

// Clinic: Lookup by Email Address
app.get('/api/clinic/lookup-email/:email', (req, res) => {
  const email = req.params.email.toLowerCase().trim();
  const patient = USERS_DB[email];

  if (!patient) {
    return res.status(404).json({ error: "No patient account found with this email address." });
  }

  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const exists = CLINIC_QUEUE.find(q => q.email === email && q.status === 'Waiting');
  if (!exists) {
    CLINIC_QUEUE.unshift({
      id: Date.now().toString(),
      name: patient.name,
      email: patient.email,
      cardId: patient.linkedCardId || 'Manual Email Entry',
      time: timeString,
      status: 'Waiting'
    });
  }

  res.json({ success: true, patient, queue: CLINIC_QUEUE });
});

// Clinic: Get / Update Queue
app.get('/api/clinic/queue', (req, res) => {
  res.json({ success: true, queue: CLINIC_QUEUE });
});

app.post('/api/clinic/queue/status', (req, res) => {
  const { queueId, status } = req.body;
  if (status === 'Remove') {
    CLINIC_QUEUE = CLINIC_QUEUE.filter(q => q.id !== queueId);
  } else {
    const item = CLINIC_QUEUE.find(q => q.id === queueId);
    if (item) item.status = status;
  }
  res.json({ success: true, queue: CLINIC_QUEUE });
});

// Clinic: Save Triage Vitals & Doctor Notes
app.post('/api/clinic/update-clinical-record', (req, res) => {
  const { email, vitals, consultation } = req.body;
  const user = USERS_DB[email];

  if (!user) return res.status(404).json({ error: "Patient record not found." });

  if (vitals) user.vitals = { ...vitals, recordedAt: new Date().toLocaleString() };
  if (consultation) user.consultation = { ...consultation, recordedAt: new Date().toLocaleString() };

  res.json({ success: true, message: "Clinical encounter saved to patient profile!", user });
});

// Reset Database
app.post('/api/admin/reset-database', (req, res) => {
  for (let key in USERS_DB) delete USERS_DB[key];
  for (let key in CARD_MAP_DB) delete CARD_MAP_DB[key];
  for (let key in RESET_TOKENS) delete RESET_TOKENS[key];
  CLINIC_QUEUE = [];
  res.json({ success: true, message: "All patient files, queues, and NFC links wiped." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Clinical server live on port ${PORT}`));