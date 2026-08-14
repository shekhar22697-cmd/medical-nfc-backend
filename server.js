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

const MASTER_ADMIN = {
  username: "Admin",
  password: "1P@ssword"
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER_EMAIL, pass: SENDER_APP_PASSWORD }
});

const USERS_DB = {}; 
const CARD_MAP_DB = {};
const PATIENT_ID_MAP_DB = {};
const RESET_TOKENS = {};
let CLINIC_QUEUE = [];
let NEXT_PATIENT_ID = 1;

const CLINICS_DB = {
  "admin@clinic.com": {
    facilityName: "Shekhar, Vinayak & Randhir Medical Center",
    facilityLicense: "LIC-MED-2026-TT",
    email: "admin@clinic.com",
    password: "clinicpassword123",
    registeredAt: new Date().toLocaleString()
  }
};

app.get('/', (req, res) => {
  res.send('Shekhar, Vinayak & Randhir Clinical API is active!');
});

// 1. Master Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === MASTER_ADMIN.username && password === MASTER_ADMIN.password) {
    res.json({ 
      success: true, 
      clinics: Object.values(CLINICS_DB),
      totalPatients: Object.keys(USERS_DB).length
    });
  } else {
    res.status(401).json({ error: "Invalid Master Administrator credentials." });
  }
});

// Master Admin: Provision Clinic
app.post('/api/admin/create-clinic', (req, res) => {
  const { adminUsername, adminPassword, facilityName, facilityLicense, email, password } = req.body;
  if (adminUsername !== MASTER_ADMIN.username || adminPassword !== MASTER_ADMIN.password) {
    return res.status(403).json({ error: "Unauthorized: Master Admin credentials required." });
  }

  const cleanEmail = email.toLowerCase().trim();
  if (CLINICS_DB[cleanEmail]) {
    return res.status(400).json({ error: "A clinic with this email already exists." });
  }

  CLINICS_DB[cleanEmail] = {
    facilityName,
    facilityLicense,
    email: cleanEmail,
    password,
    registeredAt: new Date().toLocaleString()
  };

  res.json({ success: true, message: `Clinic '${facilityName}' successfully provisioned!`, clinics: Object.values(CLINICS_DB) });
});

// 2. Clinic Facility Login
app.post('/api/clinic/login', (req, res) => {
  const { email, password } = req.body;
  const clinic = CLINICS_DB[email.toLowerCase().trim()];

  if (!clinic || clinic.password !== password) {
    return res.status(401).json({ error: "Access Denied: Unrecognized facility or incorrect credentials." });
  }

  res.json({ success: true, clinic });
});

// 3. Patient Registration (With 4-Digit Security PIN & Privacy Settings)
app.post('/api/patient/register', (req, res) => {
  const { email, password, pin, name, dob, bloodType, insurance, allergies, conditions, emergencyContact } = req.body;
  
  if (USERS_DB[email]) {
    return res.status(400).json({ error: "Account already exists with this email." });
  }

  const patientId = String(NEXT_PATIENT_ID++);

  USERS_DB[email] = {
    patientId,
    email, password, name, dob, bloodType,
    pin: pin || "1234",
    cardFrozen: false,
    privacySettings: {
      doctorNotes: true,
      bloodTests: true,
      xray: true,
      ctScans: true,
      ultrasound: true,
      cardiology: true
    },
    auditLogs: [
      { event: "Account Created & Security PIN Established", facility: "Patient Self-Service", timestamp: new Date().toLocaleString() }
    ],
    insurance: insurance || {},
    allergies: allergies || [],
    conditions: conditions || [],
    emergencyContact: emergencyContact || "",
    document: null,
    linkedCardId: null,
    vitals: null,
    consultation: null
  };

  PATIENT_ID_MAP_DB[patientId] = email;

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

// Patient: Toggle Card Freeze (Kill Switch)
app.post('/api/patient/toggle-freeze', (req, res) => {
  const { email, frozen } = req.body;
  const user = USERS_DB[email];
  if (!user) return res.status(404).json({ error: "User not found." });

  user.cardFrozen = frozen;
  user.auditLogs.unshift({
    event: frozen ? "🔒 Physical NFC Card Frozen" : "🔓 Physical NFC Card Unfrozen",
    facility: "Patient Dashboard",
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, message: frozen ? "NFC Card access has been frozen." : "NFC Card access restored.", user });
});

// Patient: Update Security PIN & Privacy Consent
app.post('/api/patient/security-settings', (req, res) => {
  const { email, pin, privacySettings } = req.body;
  const user = USERS_DB[email];
  if (!user) return res.status(404).json({ error: "User not found." });

  if (pin) user.pin = pin;
  if (privacySettings) user.privacySettings = privacySettings;

  user.auditLogs.unshift({
    event: "Security PIN / Folder Privacy Controls Updated",
    facility: "Patient Dashboard",
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, message: "Security settings saved!", user });
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
    res.status(500).json({ error: "Failed to dispatch email." });
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

// Helper: Dispatch Email Alert to Patient on Scan
async function dispatchScanAlert(patient, facilityName) {
  if (!patient.email) return;
  const mailOptions = {
    from: `"Healthcare Security Alert" <${SENDER_EMAIL}>`,
    to: patient.email,
    subject: `Security Alert: Your Medical Record Was Accessed`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h3 style="color: #0284c7;">🏥 Medical Record Access Notice</h3>
        <p>Hello <b>${patient.name}</b>,</p>
        <p>Your NFC Medical Card / Patient ID was just checked in at:</p>
        <div style="background:#f8fafc; padding: 12px; border-left: 4px solid #0284c7; margin: 15px 0;">
          <b>Facility:</b> ${facilityName}<br>
          <b>Timestamp:</b> ${new Date().toLocaleString()}
        </div>
        <p style="font-size:0.85rem; color:#64748b;">If you did not authorize this visit, please log into your Patient Portal and activate the <b>Card Freeze</b> switch immediately.</p>
      </div>
    `
  };
  try { await transporter.sendMail(mailOptions); } catch (e) {}
}

// 4. Clinic: Scan Card & Check-In (With Kill-Switch & Audit Log)
app.get('/api/clinic/scan/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const facilityName = req.query.facility || "Authorized Healthcare Clinic";
  const patientEmail = CARD_MAP_DB[cardId];

  if (!patientEmail || !USERS_DB[patientEmail]) {
    return res.status(404).json({ error: "Unregistered card. No patient linked to this NFC tag." });
  }

  const patient = USERS_DB[patientEmail];

  if (patient.cardFrozen) {
    return res.status(403).json({ error: "ACCESS DENIED: This NFC card has been FROZEN by the patient due to security/loss." });
  }

  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Log Audit
  patient.auditLogs.unshift({
    event: `NFC Tap Check-In (Card ID: ${cardId})`,
    facility: facilityName,
    timestamp: new Date().toLocaleString()
  });

  // Async email notification
  dispatchScanAlert(patient, facilityName);

  const exists = CLINIC_QUEUE.find(q => q.email === patientEmail && q.status === 'Waiting');
  if (!exists) {
    CLINIC_QUEUE.unshift({
      id: Date.now().toString(),
      name: patient.name,
      email: patient.email,
      patientId: patient.patientId,
      cardId: cardId,
      time: timeString,
      status: 'Waiting'
    });
  }

  res.json({ success: true, patient, queue: CLINIC_QUEUE });
});

// Clinic: Lookup by Patient ID Number
app.get('/api/clinic/lookup-id/:id', (req, res) => {
  const id = req.params.id.trim();
  const facilityName = req.query.facility || "Authorized Healthcare Clinic";
  const patientEmail = PATIENT_ID_MAP_DB[id];

  if (!patientEmail || !USERS_DB[patientEmail]) {
    return res.status(404).json({ error: `No patient account found with ID #${id}.` });
  }

  const patient = USERS_DB[patientEmail];
  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  patient.auditLogs.unshift({
    event: `Manual ID Lookup Check-In (ID #${id})`,
    facility: facilityName,
    timestamp: new Date().toLocaleString()
  });

  dispatchScanAlert(patient, facilityName);

  const exists = CLINIC_QUEUE.find(q => q.email === patientEmail && q.status === 'Waiting');
  if (!exists) {
    CLINIC_QUEUE.unshift({
      id: Date.now().toString(),
      name: patient.name,
      email: patient.email,
      patientId: patient.patientId,
      cardId: patient.linkedCardId || `ID #${patient.patientId}`,
      time: timeString,
      status: 'Waiting'
    });
  }

  res.json({ success: true, patient, queue: CLINIC_QUEUE });
});

// Clinic: Verify 4-Digit Security PIN to Unlock Full Archive
app.post('/api/clinic/verify-pin', (req, res) => {
  const { email, pin, facilityName } = req.body;
  const user = USERS_DB[email];

  if (!user) return res.status(404).json({ error: "Patient not found." });

  if (user.pin === pin) {
    user.auditLogs.unshift({
      event: "🔓 Full Medical Records & Archive Unlocked via PIN",
      facility: facilityName || "Clinical Workstation",
      timestamp: new Date().toLocaleString()
    });
    res.json({ success: true, message: "PIN Verified. Full archive unlocked.", privacySettings: user.privacySettings });
  } else {
    res.status(401).json({ error: "Incorrect 4-digit Security PIN. Access denied." });
  }
});

// Clinic: Link / Replace Card
app.post('/api/clinic/link-card', (req, res) => {
  const { cardId, email } = req.body;
  const user = USERS_DB[email];
  if (!user) return res.status(404).json({ error: "No patient account found with that email." });

  if (user.linkedCardId && CARD_MAP_DB[user.linkedCardId]) {
    delete CARD_MAP_DB[user.linkedCardId];
  }

  user.linkedCardId = cardId;
  CARD_MAP_DB[cardId] = email;

  user.auditLogs.unshift({
    event: `Physical NFC Tag Assigned (${cardId})`,
    facility: "Clinical Desk",
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, message: `Card ID '${cardId}' successfully assigned to ${user.name}` });
});

// Queue management
app.get('/api/clinic/queue', (req, res) => res.json({ success: true, queue: CLINIC_QUEUE }));
app.post('/api/clinic/queue/status', (req, res) => {
  const { queueId, status } = req.body;
  if (status === 'Remove') CLINIC_QUEUE = CLINIC_QUEUE.filter(q => q.id !== queueId);
  else {
    const item = CLINIC_QUEUE.find(q => q.id === queueId);
    if (item) item.status = status;
  }
  res.json({ success: true, queue: CLINIC_QUEUE });
});

// Clinic: Save Triage Vitals & Doctor Notes
app.post('/api/clinic/update-clinical-record', (req, res) => {
  const { email, vitals, consultation, facilityName } = req.body;
  const user = USERS_DB[email];
  if (!user) return res.status(404).json({ error: "Patient record not found." });

  if (vitals) user.vitals = { ...vitals, recordedAt: new Date().toLocaleString(), facility: facilityName };
  if (consultation) user.consultation = { ...consultation, recordedAt: new Date().toLocaleString(), facility: facilityName };

  user.auditLogs.unshift({
    event: "Clinical Encounter & Prescription Logged by Doctor",
    facility: facilityName || "Clinic Station",
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, message: "Clinical encounter saved to patient profile!", user });
});

// Admin Reset
app.post('/api/admin/reset-database', (req, res) => {
  for (let key in USERS_DB) delete USERS_DB[key];
  for (let key in CARD_MAP_DB) delete CARD_MAP_DB[key];
  for (let key in PATIENT_ID_MAP_DB) delete PATIENT_ID_MAP_DB[key];
  for (let key in RESET_TOKENS) delete RESET_TOKENS[key];
  CLINIC_QUEUE = [];
  NEXT_PATIENT_ID = 1;
  res.json({ success: true, message: "All patient records and queues wiped. Default clinic active." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Clinical server live on port ${PORT}`));