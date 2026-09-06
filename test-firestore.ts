import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const configPath = 'firebase-applet-config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

admin.initializeApp({ projectId: config.projectId });
console.log(config.firestoreDatabaseId);

const db = getFirestore(config.firestoreDatabaseId);
db.collection('settings').get().then(() => console.log('success')).catch(e => console.error('error:', e));
