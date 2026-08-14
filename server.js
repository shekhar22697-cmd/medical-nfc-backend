const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const USERS_DB = {}; 
const CARD_MAP_DB = {};

app.get('/', (req, res) => {
  res.send('Shekhar and Vinayak Medical API is live!');
});

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
    emergencyContact, document: null, linkedCardId: null
  };

  res.json({ success: true, message: "Account created successfully!", user: USERS_DB[email] });
});

app.post('/api/patient/login', (req, res) => {
  const { email, password } = req.body;
  const user = USERS_DB[email];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ success: true, user });
});

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

app.post('/api/clinic/link-card', (req, res) => {
  const { cardId, email } = req.body;
  
  if (!USERS_DB[email]) {
    return res.status(404).json({ error: "No patient account found with that email." });
  }

  USERS_DB[email].linkedCardId = cardId;
  CARD_MAP_DB[cardId] = email;

  res.json({ success: true, message: `Card ${cardId} linked to ${USERS_DB[email].name}` });
});

app.get('/api/clinic/scan/:cardId', (req, res) => {
  const { cardId } = req.params;
  const patientEmail = CARD_MAP_DB[cardId];

  if (!patientEmail || !USERS_DB[patientEmail]) {
    return res.status(404).json({ error: "Unregistered card. No patient linked to this NFC tag." });
  }

  res.json({ success: true, patient: USERS_DB[patientEmail] });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));