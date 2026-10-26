import express from "express";
console.log("SERVER STARTING AT " + new Date().toISOString());
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference } from 'mercadopago';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initClientApp, getApps as getClientApps } from 'firebase/app';
import { 
  getFirestore as getClientFirestore, 
  collection as clientCollection, 
  getDocs as getClientDocs,
  doc as clientDoc,
  getDoc as getClientDoc,
  updateDoc as clientUpdateDoc,
  query as clientQuery,
  where as clientWhere
} from 'firebase/firestore';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase Config safely
let firebaseConfig: any = {};
try {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log("[SERVER] Firebase config loaded from file.");
  }
} catch (e) {
  console.warn("[SERVER] Could not load firebase-applet-config.json, relying on env vars.");
}

// Initialize Firebase Client SDK (uses API Key, no Service Account needed)
let clientDb: any = null;
try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    const clientApp = getClientApps().length === 0 
      ? initClientApp(firebaseConfig, 'server-client-app')
      : getClientApps()[0];
    clientDb = getClientFirestore(clientApp, firebaseConfig.firestoreDatabaseId);
    console.log("[SERVER] Firebase Client SDK initialized successfully.");
  }
} catch (e: any) {
  console.error("[SERVER] Error initializing Firebase Client SDK:", e?.message);
}

// Initialize Firebase Admin
const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
let databaseId = process.env.FIREBASE_DATABASE_ID;

// Guard: Sometimes appId is mistakenly passed as databaseId in some environments
if (databaseId && databaseId.includes(':')) {
  console.warn(`[SERVER] Detected invalid databaseId (looks like an appId): ${databaseId}. Falling back to config.`);
  databaseId = null; // Clear it so we fall back to config
}

if (!databaseId) {
  databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
}

if (projectId) {
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        projectId: projectId
      });
      console.log(`[SERVER] Firebase Admin initialized for project: ${projectId}`);
    }
  } catch (e) {
    console.error("[SERVER] Error initializing Firebase Admin:", e);
  }
}

console.log(`[SERVER] Using Firestore Database ID: ${databaseId}`);
let db: any = null;
if (admin.apps.length > 0) {
  try {
    db = (databaseId && databaseId !== '(default)') ? getFirestore(databaseId) : getFirestore();
  } catch (e) {
    console.error("[SERVER] Error getting Firestore instance:", e);
    db = getFirestore('(default)'); // Fallback to default
  }
}

// Cache settings in memory with short TTL
let cachedSettings: any = null;
let lastSettingsFetch = 0;
const SETTINGS_CACHE_TTL = 15000; // 15 seconds

// Helper to get settings - uses Client SDK first (reliable without service account), then Admin SDK
async function getServerSettings(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSettings && (now - lastSettingsFetch < SETTINGS_CACHE_TTL)) {
    return cachedSettings;
  }

  // Priority 1: Firebase Client SDK (uses API Key, works without service account credentials)
  if (clientDb) {
    try {
      const snap = await getClientDocs(clientCollection(clientDb, 'settings'));
      const config: any = {};
      snap.docs.forEach((d: any) => {
        config[d.id] = d.data()?.value;
      });
      if (Object.keys(config).length > 0) {
        cachedSettings = config;
        lastSettingsFetch = now;
        return config;
      }
    } catch (clientErr: any) {
      console.warn("[SERVER] Client SDK failed to fetch settings:", clientErr?.message);
    }
  }

  // Priority 2: Firebase Admin SDK
  if (db) {
    try {
      const settingsSnap = await db.collection('settings').get();
      const config: any = {};
      settingsSnap.forEach((doc: any) => {
        config[doc.id] = doc.data()?.value;
      });
      if (Object.keys(config).length > 0) {
        cachedSettings = config;
        lastSettingsFetch = now;
        return config;
      }
    } catch (e: any) {
      // If we get a NOT_FOUND error (code 5), fallback to default database
      if (e.code === 5 || (e.message && e.message.includes('NOT_FOUND'))) {
        try {
          const fallbackDb = getFirestore('(default)');
          const settingsSnap = await fallbackDb.collection('settings').get();
          const config: any = {};
          settingsSnap.forEach((doc: any) => {
            config[doc.id] = doc.data()?.value;
          });
          db = fallbackDb;
          cachedSettings = config;
          lastSettingsFetch = now;
          return config;
        } catch (fallbackError) {
          console.error("[SERVER] Fallback also failed:", fallbackError);
        }
      }
      console.warn("[SERVER] Admin SDK failed to fetch settings:", e?.message);
    }
  }

  return cachedSettings || {};
}

// Helpers for order management across Client SDK and Admin SDK
async function findOrderByNumber(orderIdentifier: string): Promise<{ id: string; data: any; ref?: any } | null> {
  if (!orderIdentifier) return null;
  const cleanId = String(orderIdentifier).trim();
  const rawId = cleanId.replace(/^#/, '');

  if (clientDb) {
    try {
      // 1. Try finding by order_number field with variations
      for (const val of [cleanId, rawId, `#${rawId}`]) {
        const q = clientQuery(clientCollection(clientDb, 'orders'), clientWhere('order_number', '==', val));
        const snap = await getClientDocs(q);
        if (!snap.empty) {
          return { id: snap.docs[0].id, data: snap.docs[0].data(), ref: snap.docs[0].ref };
        }
      }

      // 2. Try finding directly by doc ID
      const dRef = clientDoc(clientDb, 'orders', cleanId);
      const dSnap = await getClientDoc(dRef);
      if (dSnap.exists()) {
        return { id: dSnap.id, data: dSnap.data(), ref: dRef };
      }
    } catch (e: any) {
      console.warn("[SERVER] Client SDK findOrderByNumber failed:", e?.message);
    }
  }

  if (db) {
    try {
      for (const val of [cleanId, rawId, `#${rawId}`]) {
        const snap = await db.collection('orders').where('order_number', '==', val).get();
        if (!snap.empty) {
          return { id: snap.docs[0].id, data: snap.docs[0].data(), ref: snap.docs[0].ref };
        }
      }
      const directDoc = await db.collection('orders').doc(cleanId).get();
      if (directDoc.exists) {
        return { id: directDoc.id, data: directDoc.data(), ref: directDoc.ref };
      }
    } catch (e: any) {
      console.warn("[SERVER] Admin SDK findOrderByNumber failed:", e?.message);
    }
  }

  return null;
}

async function updateOrderStatusOnServer(orderNumber: string, status: string, paymentId?: string) {
  const order = await findOrderByNumber(orderNumber);
  if (!order) return null;

  const updateFields: any = { status };
  if (paymentId) updateFields.payment_id = String(paymentId);

  if (clientDb) {
    try {
      await clientUpdateDoc(clientDoc(clientDb, 'orders', order.id), updateFields);
      return { ...order, data: { ...order.data, ...updateFields } };
    } catch (e: any) {
      console.warn("[SERVER] Client SDK updateOrderStatus failed:", e?.message);
    }
  }

  if (db) {
    try {
      await db.collection('orders').doc(order.id).update(updateFields);
      return { ...order, data: { ...order.data, ...updateFields } };
    } catch (e: any) {
      console.warn("[SERVER] Admin SDK updateOrderStatus failed:", e?.message);
    }
  }

  return order;
}

// Initialize settings and handle Firestore fallback at startup
getServerSettings().then(settings => {
  console.log("[SERVER] Initial settings loaded.");
}).catch(err => {
  console.error("[SERVER] Failed to load initial settings:", err);
});

// Helper to send WhatsApp (Placeholder for a real API like Twilio or Ultramsg)
async function sendWhatsApp(phone: string, message: string) {
  const adminWhatsApp = process.env.ADMIN_WHATSAPP;
  if (!adminWhatsApp) {
    console.log("[WHATSAPP] No ADMIN_WHATSAPP configured. Message:", message);
    return;
  }

  try {
    // Example using a generic webhook or a service like CallMeBot (Free for personal use)
    // You can replace this with Twilio, Ultramsg, etc.
    console.log(`[WHATSAPP] Sending to ${adminWhatsApp}: ${message}`);
    
    // If you have a specific API, you would fetch it here:
    // await fetch(`https://api.service.com/send?phone=${adminWhatsApp}&text=${encodeURIComponent(message)}`);
  } catch (err) {
    console.error("[WHATSAPP] Error sending message:", err);
  }
}

// Email Helper
async function sendEmail(to: string, subject: string, html: string) {
  try {
    const config = await getServerSettings();

    const rawUser = process.env.SMTP_USER || config.smtp_user;
    const rawPass = process.env.SMTP_PASS || config.smtp_pass;

    if (!rawUser || !rawPass) {
      console.log("[EMAIL] SMTP credentials not set. Skipping email send.");
      console.log(`[EMAIL] To: ${to}\nSubject: ${subject}`);
      return { skipped: true, reason: "Credentials missing" };
    }

    const smtpUser = String(rawUser).trim();
    // Remove all spaces in app passwords (common when pasting from Google)
    const smtpPass = String(rawPass).trim().replace(/\s+/g, '');

    console.log(`[EMAIL] Attempting to send email to ${to} using ${smtpUser}...`);

    let transporter;
    try {
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // SSL
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      const info = await transporter.sendMail({
        from: `"Sorella Indumentaria" <${smtpUser}>`,
        to,
        subject,
        html
      });

      console.log(`[EMAIL] Email sent to ${to} via 465: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err465: any) {
      console.warn("[EMAIL] Port 465 failed, attempting port 587 (TLS):", err465?.message);
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // STARTTLS
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      const info = await transporter.sendMail({
        from: `"Sorella Indumentaria" <${smtpUser}>`,
        to,
        subject,
        html
      });

      console.log(`[EMAIL] Email sent to ${to} via 587: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    }
  } catch (error: any) {
    console.error("[EMAIL] Error sending email:", error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
}

const app = express();

// Health checks
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.get("/api/ping", (req, res) => res.send("pong"));

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  }
  next();
});

// API Routes (Only those that need server-side secrets)

// Mercado Pago Connection Test (Supports GET and POST with body accessToken)
const testMercadoPagoHandler = async (req: express.Request, res: express.Response) => {
  try {
    const bodyToken = req.body?.accessToken;
    const config = await getServerSettings(true);
    const accessToken = (
      bodyToken ||
      process.env.MERCADOPAGO_ACCESS_TOKEN ||
      process.env.MP_ACCESS_TOKEN ||
      config.mercadopago_access_token ||
      ''
    ).trim();
    
    if (!accessToken) {
      return res.status(400).json({ status: 'error', message: 'Access Token no configurado' });
    }

    const response = await fetch('https://api.mercadopago.com/users/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await response.json();
    if (response.ok) {
      const userName = data.nickname || data.first_name || 'Vendedor';
      res.json({ 
        status: 'ok', 
        message: 'Conexión exitosa', 
        user: userName,
        email: data.email,
        site_id: data.site_id 
      });
    } else {
      res.status(response.status).json({ 
        status: 'error', 
        message: data.message || `Error ${response.status} de Mercado Pago` 
      });
    }
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

app.get("/api/admin/test-mercadopago", testMercadoPagoHandler);
app.post("/api/admin/test-mercadopago", testMercadoPagoHandler);

app.get("/api/checkout/retry/:order_number", async (req, res) => {
  const { order_number } = req.params;
  console.log(`[RETRY] Request received for order: ${order_number}`);
  
  try {
    const order = await findOrderByNumber(order_number);
    
    if (!order) {
      console.error(`[RETRY] Order not found: ${order_number}`);
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: "Pedido no encontrado" });
      }
      return res.status(404).send("Pedido no encontrado");
    }
    
    const orderData = order.data;
    console.log(`[RETRY] Order found. Status: ${orderData.status}, Total: ${orderData.total}`);
    
    const config = await getServerSettings(true);
    const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || config.mercadopago_access_token || '').trim();
    
    if (!accessToken) {
      console.error("[RETRY] Mercado Pago access token missing");
      const errorMsg = "Mercado Pago no está configurado. Por favor configure el Access Token en el panel.";
      if (req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: errorMsg });
      }
      return res.status(400).send(errorMsg);
    }

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host || req.get('host');
    const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/$/, '');

    const result = await preference.create({
      body: {
        items: (orderData.items || []).map((item: any) => ({
          id: String(item.id || 'item'),
          title: String(item.name || 'Producto').substring(0, 250),
          unit_price: Number(item.price || 0),
          quantity: Number(item.quantity || 1),
          currency_id: 'ARS'
        })),
        back_urls: {
          success: `${baseUrl}/api/checkout/success?order_id=${order_number}`,
          failure: `${baseUrl}/api/checkout/failure?order_id=${order_number}`,
          pending: `${baseUrl}/api/checkout/pending?order_id=${order_number}`
        },
        auto_return: 'approved',
        external_reference: String(order_number),
        statement_descriptor: "BySorellaStore"
      }
    });

    console.log(`[RETRY] Preference created: ${result.id}`);
    
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ init_point: result.init_point });
    }
    
    res.redirect(result.init_point!);
  } catch (err: any) {
    console.error("[RETRY] Unexpected Error:", err);
    
    let errorMessage = "Error interno";
    if (err.message) {
      errorMessage = typeof err.message === 'string' ? err.message : JSON.stringify(err.message);
    } else if (typeof err === 'string') {
      errorMessage = err;
    } else {
      errorMessage = JSON.stringify(err);
    }

    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: errorMessage });
    }
    res.status(500).send(`Error al procesar el pago: ${errorMessage}`);
  }
});

app.post("/api/checkout/mercadopago", async (req, res) => {
  try {
    const { items, orderData, accessToken: bodyAccessToken } = req.body;
    
    const config = await getServerSettings(true);
    const accessToken = (
      bodyAccessToken ||
      process.env.MERCADOPAGO_ACCESS_TOKEN ||
      process.env.MP_ACCESS_TOKEN ||
      config.mercadopago_access_token ||
      ''
    ).trim();
    
    if (!accessToken) {
      console.error("[MP] Mercado Pago access token missing");
      return res.status(400).json({ error: "Mercado Pago no está configurado. Verifique el Access Token en el panel de administración." });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host || req.get('host');
    const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/$/, '');

    const result = await preference.create({
      body: {
        items: items.map((item: any) => ({
          id: String(item.id || 'item'),
          title: String(item.name || 'Producto').substring(0, 250),
          unit_price: Number(item.price || 0),
          quantity: Number(item.quantity || 1),
          currency_id: 'ARS'
        })),
        back_urls: {
          success: `${baseUrl}/api/checkout/success?order_id=${orderData.order_number}`,
          failure: `${baseUrl}/api/checkout/failure?order_id=${orderData.order_number}`,
          pending: `${baseUrl}/api/checkout/pending?order_id=${orderData.order_number}`
        },
        auto_return: 'approved',
        external_reference: String(orderData.order_number),
        statement_descriptor: "BySorellaStore"
      }
    });

    console.log(`[MP] Preference created: ${result.id}`);
    res.json({ id: result.id, init_point: result.init_point });
  } catch (err: any) {
    console.error("MP Preference Error:", err);
    
    let errorMessage = "Error al crear preferencia";
    if (err.message) {
      errorMessage = typeof err.message === 'string' ? err.message : JSON.stringify(err.message);
    } else if (typeof err === 'string') {
      errorMessage = err;
    } else {
      errorMessage = JSON.stringify(err);
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// New Route for Checkout API (Payments) as requested by user link
app.post("/api/checkout/process_payment", async (req, res) => {
  try {
    const { payment_data, order_data } = req.body;
    
    const config = await getServerSettings();
    const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || config.mercadopago_access_token || '').trim();

    if (!accessToken) {
      console.error("[PROCESS_PAYMENT] Mercado Pago access token missing");
      return res.status(400).json({ error: "Mercado Pago not configured. Please set MERCADOPAGO_ACCESS_TOKEN." });
    }

    // Using fetch directly for the Payments API as it's often more reliable than SDK for custom bricks
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pay-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: payment_data.transaction_amount,
        token: payment_data.token,
        description: payment_data.description,
        installments: payment_data.installments,
        payment_method_id: payment_data.payment_method_id,
        issuer_id: payment_data.issuer_id,
        payer: {
          email: payment_data.payer.email,
          identification: payment_data.payer.identification
        },
        external_reference: order_data.order_number,
        metadata: {
          order_id: order_data.order_number
        }
      })
    });

    const result = await response.json();
    
    if (result.status === 'approved' && db) {
      const snapshot = await db.collection('orders').where('order_number', '==', order_data.order_number).get();
      if (!snapshot.empty) {
        await snapshot.docs[0].ref.update({ 
          status: 'Pagado', 
          payment_id: result.id,
          payment_method: result.payment_method_id
        });
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error("MP Payment Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Order Notification (Emails)
app.post("/api/notify-order", async (req, res) => {
  try {
    const { order_number, customer_email, customer_name, customer_phone, shipping_address, shipping_method, total, items } = req.body;
    
    const adminEmail = process.env.ADMIN_EMAIL || 'dgmvolpi@gmail.com';
    const adminWhatsApp = process.env.ADMIN_WHATSAPP;
    
    const config = await getServerSettings();
    const whatsappLink = config.whatsapp_link || `https://wa.me/${process.env.ADMIN_WHATSAPP || '5491122334455'}`;
    
    const whatsappButton = `
      <div style="margin-top: 30px; text-align: center;">
        <a href="${whatsappLink}" style="display: inline-block; padding: 15px 30px; background-color: #25D366; color: white; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: sans-serif;">
          Contactar por WhatsApp
        </a>
      </div>
    `;

    const itemsHtml = items.map((item: any) => {
      let options = [];
      if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
      if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
      if (item.selectedDynamicFilters) {
        Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
      }
      const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
      return `<li>${item.name}${optionsStr} x ${item.quantity} - $${item.price * item.quantity}</li>`;
    }).join('');

    const itemsText = items.map((item: any) => {
      let options = [];
      if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
      if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
      if (item.selectedDynamicFilters) {
        Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
      }
      const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
      return `- ${item.name}${optionsStr} x ${item.quantity} ($${item.price * item.quantity})`;
    }).join('\n');

    const customerHtml = buildCustomerOrderEmail({
      order_number,
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      shipping_method,
      total,
      items,
      status: 'Pendiente de pago'
    }, undefined, config);
    
    const adminHtml = `
      <div style="font-family: sans-serif; color: #333;">
        <h1>Nueva Venta Recibida</h1>
        <p>Pedido: <strong>#${order_number}</strong></p>
        <p>Cliente: ${customer_name} (${customer_email})</p>
        <p>Teléfono: ${customer_phone}</p>
        <h3>Productos:</h3>
        <ul>${itemsHtml}</ul>
        <p><strong>Total: $${total}</strong></p>
        <p>Método de envío: ${shipping_method}</p>
        <p>Dirección: ${shipping_address}</p>
      </div>
    `;

    const whatsappMessage = `🛍️ *NUEVA ORDEN #${order_number}*\n\n👤 *Cliente:* ${customer_name}\n📧 *Email:* ${customer_email}\n📞 *Tel:* ${customer_phone}\n\n📦 *Productos:*\n${itemsText}\n\n💰 *Total:* $${total}\n🚚 *Envío:* ${shipping_method}\n📍 *Dirección:* ${shipping_address}`;

    await sendEmail(customer_email, `Sorella Indumentaria - Confirmación de Pedido #${order_number}`, customerHtml);
    await sendEmail(adminEmail, `NUEVA VENTA - Pedido #${order_number}`, adminHtml);
    await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Notify Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to build buyer confirmation email with order details and prominent store contact info
function buildCustomerOrderEmail(orderData: any, paymentId?: string, settings?: any) {
  const storePhone = settings?.whatsapp_number || '+54 9 11 3509 2612';
  const cleanPhone = storePhone.replace(/[^0-9]/g, '');
  const storeEmail = settings?.smtp_user || 'info@sorella.com';

  const replyMsg = `¡Hola Sorella Indumentaria! Mi nombre es ${orderData.customer_name || 'Cliente'}. Acabo de realizar el pedido #${orderData.order_number}. Respondo a este mensaje para confirmar mis datos y coordinar el envío/entrega. ¡Muchas gracias!`;
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(replyMsg)}`;

  const itemsHtml = (orderData.items || []).map((item: any) => {
    let options = [];
    if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
    if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
    if (item.selectedDynamicFilters) {
      Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
    }
    const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
    return `
      <tr style="border-bottom: 1px solid #f1f1f1;">
        <td style="padding: 14px 10px; font-weight: 600; color: #1e293b;">
          ${item.name}
          ${optionsStr ? `<br/><span style="font-size: 12px; color: #64748b; font-weight: normal;">${optionsStr}</span>` : ''}
        </td>
        <td style="padding: 14px 10px; text-align: center; color: #475569; font-weight: bold;">x${item.quantity}</td>
        <td style="padding: 14px 10px; text-align: right; font-weight: 700; color: #0f172a;">$${(Number(item.price || 0) * Number(item.quantity || 1)).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><title>Confirmación de Pedido - Sorella Indumentaria</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #faf6f0; margin: 0; padding: 24px; color: #2d2d2d;">
      <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #f0e6dc;">
        <div style="background-color: #242220; padding: 34px 24px; text-align: center;">
          <h1 style="color: #F8D9C8; margin: 0; font-size: 26px; letter-spacing: 2px; font-weight: 800;">SORELLA INDUMENTARIA</h1>
          <p style="color: #ffffff; margin: 8px 0 0; font-size: 13px; letter-spacing: 0.5px; opacity: 0.9; text-transform: uppercase;">Confirmación Oficial de Compra</p>
        </div>
        
        <div style="padding: 32px 24px;">
          <h2 style="color: #15803d; margin-top: 0; font-size: 22px;">¡Gracias por tu compra, ${orderData.customer_name || 'Cliente'}!</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #475569;">
            Tu compra ha sido registrada con éxito y estamos listos para dar inicio a la preparación de tu paquete.
          </p>
          
          <div style="background: #fdfaf6; border: 1px solid #fae3d9; border-radius: 16px; padding: 18px; margin: 20px 0;">
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Número de Pedido:</strong> <span style="color: #ea580c; font-weight: 800; font-size: 15px;">#${orderData.order_number}</span></p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Estado:</strong> <span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 8px; font-weight: 800; font-size: 12px; text-transform: uppercase;">${(orderData.status || 'PAGADO').toUpperCase()}</span></p>
            ${paymentId ? `<p style="margin: 0; font-size: 13px; color: #64748b;">ID de Pago Mercado Pago: <strong>${paymentId}</strong></p>` : ''}
          </div>

          <!-- Highlighted First Contact Step via WhatsApp -->
          <div style="margin: 26px 0; padding: 22px; background: #FFF7ED; border: 2px solid #FDBA74; border-radius: 18px; text-align: center;">
            <span style="background: #EA580C; color: #FFFFFF; font-size: 11px; font-weight: 800; padding: 4px 14px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block; margin-bottom: 12px;">
              Paso Fundamental para el Envío
            </span>
            <h3 style="margin: 0 0 10px; color: #9A3412; font-size: 18px; font-weight: 800;">
              ¿Cómo coordinamos la entrega de tu pedido?
            </h3>
            <p style="margin: 0 0 16px; font-size: 14px; color: #7C2D12; line-height: 1.6;">
              Para que nuestro equipo comience de inmediato con el embalaje y la coordinación del despacho o retiro, <strong>por favor responde a nuestro WhatsApp oficial confirmando tus datos</strong> haciendo clic en el siguiente botón:
            </p>
            <div style="margin-bottom: 16px;">
              <a href="${whatsappUrl}" style="display: inline-block; padding: 15px 30px; background-color: #25D366; color: #ffffff; text-decoration: none; border-radius: 50px; font-weight: 800; font-size: 15px; box-shadow: 0 6px 18px rgba(37,211,102,0.35);">
                💬 Responder por WhatsApp para Coordinar Envío
              </a>
            </div>
            <div style="background: #ffffff; padding: 10px 16px; border-radius: 12px; display: inline-block; border: 1px solid #fed7aa; font-size: 13px; color: #334155;">
              📞 WhatsApp de Atención: <strong style="color: #15803d;">${storePhone}</strong> &nbsp;|&nbsp; ✉️ ${storeEmail}
            </div>
          </div>

          <h3 style="font-size: 16px; margin: 26px 0 12px; border-bottom: 2px solid #F8D9C8; padding-bottom: 8px; color: #242220; text-transform: uppercase; letter-spacing: 0.5px;">Detalle de Productos</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f8fafc; text-align: left; font-size: 12px; color: #64748b; text-transform: uppercase;">
                <th style="padding: 10px 8px;">Producto</th>
                <th style="padding: 10px 8px; text-align: center;">Cant.</th>
                <th style="padding: 10px 8px; text-align: right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding: 16px 8px 8px; text-align: right; font-weight: bold; font-size: 16px; color: #333;">Total Abonado:</td>
                <td style="padding: 16px 8px 8px; text-align: right; font-weight: 800; font-size: 20px; color: #ea580c;">$${Number(orderData.total || 0).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          <div style="margin-top: 24px; padding: 18px; background: #fdfaf6; border-radius: 14px; border: 1px solid #f2ece6; font-size: 14px; line-height: 1.6;">
            <p style="margin: 0 0 6px;"><strong>Método de Entrega:</strong> ${orderData.shipping_method || 'A convenir'}</p>
            ${orderData.shipping_method === 'Envio a domicilio' ? `<p style="margin: 0 0 6px;"><strong>Dirección de Envío:</strong> ${orderData.shipping_address || 'No especificada'}</p>` : '<p style="margin: 0 0 6px;"><strong>Modalidad:</strong> Retiro en sucursal / taller</p>'}
            ${orderData.receiver_dni ? `<p style="margin: 0;"><strong>Quien retira/recibe:</strong> ${orderData.receiver_first_name || ''} ${orderData.receiver_last_name || ''} (DNI: ${orderData.receiver_dni})</p>` : ''}
          </div>

          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; line-height: 1.5;">
            Guarda este correo como comprobante de tu pedido.<br/>
            © Sorella Indumentaria. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Unified Payment Success Processor (Updates DB, sends Emails & WhatsApp, deducts stock)
async function processPaymentSuccess(orderIdentifier: string, paymentId?: string) {
  console.log(`[PROCESS_PAYMENT_SUCCESS] Processing order: ${orderIdentifier}, paymentId: ${paymentId}`);
  const order = await updateOrderStatusOnServer(orderIdentifier, 'Pagado', paymentId);
  if (!order) {
    console.warn(`[PROCESS_PAYMENT_SUCCESS] Order not found for identifier: ${orderIdentifier}`);
    return null;
  }

  const orderData = order.data;

  // Deduct stock if db is available
  if (db && orderData.items && Array.isArray(orderData.items)) {
    for (const item of orderData.items) {
      try {
        const productRef = db.collection('products').doc(String(item.id));
        await db.runTransaction(async (transaction: any) => {
          const productDoc = await transaction.get(productRef);
          if (productDoc.exists) {
            const currentStock = productDoc.data().stock || 0;
            transaction.update(productRef, { stock: Math.max(0, currentStock - item.quantity) });
          }
        });
      } catch (stockErr) {
        console.warn("[STOCK] Could not deduct stock:", stockErr);
      }
    }
  }

  const config = await getServerSettings();
  const adminEmail = process.env.ADMIN_EMAIL || config.smtp_user || 'dgmvolpi@gmail.com';
  const adminWhatsApp = process.env.ADMIN_WHATSAPP || config.whatsapp_number;
  const storePhone = config.whatsapp_number || '+54 9 11 3509 2612';
  const cleanPhone = storePhone.replace(/[^0-9]/g, '');
  const whatsappLink = config.whatsapp_link || `https://wa.me/${cleanPhone}`;

  const customerHtml = buildCustomerOrderEmail(orderData, paymentId, config);

  const itemsText = (orderData.items || []).map((item: any) => {
    let options = [];
    if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
    if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
    if (item.selectedDynamicFilters) {
      Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
    }
    const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
    return `- ${item.name}${optionsStr} x ${item.quantity} ($${item.price * item.quantity})`;
  }).join('\n');

  const adminHtml = `
    <div style="font-family: sans-serif; color: #333; max-width: 600px;">
      <h1 style="color: #22C55E;">✅ Venta Pagada #${orderData.order_number}</h1>
      <p>Pedido: <strong>#${orderData.order_number}</strong></p>
      <p>Cliente: <strong>${orderData.customer_name}</strong> (${orderData.customer_email})</p>
      <p>Teléfono: <strong>${orderData.customer_phone}</strong></p>
      <p>Total Abonado: <strong>$${orderData.total}</strong></p>
      <p>Método de Envío: <strong>${orderData.shipping_method}</strong></p>
      <p>Dirección: <strong>${orderData.shipping_address || 'Retiro en local'}</strong></p>
      ${orderData.receiver_dni ? `<p>DNI Receptor: <strong>${orderData.receiver_dni}</strong> (${orderData.receiver_first_name} ${orderData.receiver_last_name})</p>` : ''}
      <p>ID de Pago MP: <strong>${paymentId || orderData.payment_id || 'N/A'}</strong></p>
      <h3>Productos:</h3>
      <pre style="background: #f4f4f4; padding: 12px; border-radius: 8px;">${itemsText}</pre>
    </div>
  `;

  const whatsappMessage = `✅ *PAGO CONFIRMADO #${orderData.order_number}*\n\n💰 *Total:* $${orderData.total}\n👤 *Cliente:* ${orderData.customer_name}\n📧 *Email:* ${orderData.customer_email}\n📞 *Tel:* ${orderData.customer_phone}\n\n📦 *Productos:*\n${itemsText}\n\n🚚 *Envío:* ${orderData.shipping_method}\n📍 *Dirección:* ${orderData.shipping_address || 'Retiro en local'}\n💳 *ID Pago MP:* ${paymentId || 'N/A'}`;

  // Fire emails and WhatsApp without blocking response
  try {
    if (orderData.customer_email) {
      console.log(`[PROCESS_PAYMENT_SUCCESS] Sending confirmation email to buyer: ${orderData.customer_email}`);
      await sendEmail(orderData.customer_email, `Sorella - Pago Confirmado y Detalle de Pedido #${orderData.order_number}`, customerHtml);
    }
  } catch (err: any) {
    console.error("[PROCESS_PAYMENT_SUCCESS] Customer email failed:", err?.message);
  }

  try {
    if (adminEmail) {
      console.log(`[PROCESS_PAYMENT_SUCCESS] Sending notification email to admin: ${adminEmail}`);
      await sendEmail(adminEmail, `✅ NUEVA VENTA PAGADA - Pedido #${orderData.order_number}`, adminHtml);
    }
  } catch (err: any) {
    console.error("[PROCESS_PAYMENT_SUCCESS] Admin email failed:", err?.message);
  }

  try {
    await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
  } catch (err: any) {
    console.error("[PROCESS_PAYMENT_SUCCESS] WhatsApp failed:", err?.message);
  }

  return order;
}

// GET Success redirect from Mercado Pago
app.get("/api/checkout/success", async (req, res) => {
  try {
    const order_id = (req.query.order_id || req.query.external_reference) as string;
    const payment_id = (req.query.payment_id || req.query.collection_id) as string;
    console.log(`[CHECKOUT_SUCCESS] Redirect received with order_id=${order_id}, payment_id=${payment_id}`);

    if (order_id) {
      await processPaymentSuccess(order_id, payment_id);
    }

    res.redirect(`/success?order_id=${encodeURIComponent(order_id || '')}&payment_id=${encodeURIComponent(payment_id || '')}&status=approved`);
  } catch (err) {
    console.error("[CHECKOUT_SUCCESS] Error:", err);
    res.redirect("/success");
  }
});

// POST to confirm payment from Client (e.g. SuccessPage or Admin panel)
app.post("/api/checkout/confirm-order", async (req, res) => {
  try {
    const { order_number, payment_id } = req.body;
    if (!order_number) {
      return res.status(400).json({ error: "order_number is required" });
    }
    const order = await processPaymentSuccess(order_number, payment_id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json({ success: true, order: order.data });
  } catch (err: any) {
    console.error("[CONFIRM_ORDER] Error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// POST to send/resend email directly from Admin Sales panel
app.post("/api/admin/send-order-email", async (req, res) => {
  try {
    const { order_number, customer_email, type, custom_message, id, order_id, order_data } = req.body;
    const identifier = order_number || order_id || id || order_data?.order_number || order_data?.id;
    if (!identifier && !order_data) {
      return res.status(400).json({ error: "order_number is required" });
    }

    let order = identifier ? await findOrderByNumber(identifier) : null;
    let orderData = order?.data;

    if (!orderData && order_data && (order_data.order_number || order_data.items)) {
      console.log("[ADMIN_SEND_ORDER_EMAIL] Using provided order_data fallback for:", order_data.order_number);
      orderData = order_data;
    }

    if (!orderData) {
      return res.status(404).json({ error: "Order not found" });
    }

    const targetEmail = (customer_email || orderData.customer_email || '').trim();
    if (!targetEmail) {
      return res.status(400).json({ error: "Customer email is missing" });
    }

    const config = await getServerSettings();
    const storePhone = config.whatsapp_number || '+54 9 11 3509 2612';
    const storeEmail = config.smtp_user || 'info@sorella.com';

    let html = '';
    let subject = '';

    if (type === 'delivery') {
      subject = `Sorella - Remito de Entrega - Pedido #${orderData.order_number}`;
      html = `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 12px;">
          <h2 style="color: #242220; margin-top: 0;">SORELLA INDUMENTARIA - REMITO DE ENTREGA</h2>
          <p><strong>Pedido:</strong> #${orderData.order_number}</p>
          <p><strong>Destinatario:</strong> ${orderData.receiver_first_name || ''} ${orderData.receiver_last_name || ''} (${orderData.customer_name})</p>
          <p><strong>DNI:</strong> ${orderData.receiver_dni || 'N/A'}</p>
          <p><strong>Dirección:</strong> ${orderData.shipping_address || 'Retiro en sucursal'}</p>
          <p><strong>Método de Envío:</strong> ${orderData.shipping_method}</p>
          <p><strong>Teléfono:</strong> ${orderData.customer_phone}</p>
          <p><strong>Estado:</strong> ${orderData.status || 'Pagado'}</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
          <p><strong>Contacto de la tienda:</strong> WhatsApp: ${storePhone} | Email: ${storeEmail}</p>
          ${custom_message ? `<div style="background: #f9f9f9; padding: 12px; border-radius: 8px; margin-top: 15px;"><strong>Mensaje adicional:</strong><br/>${custom_message}</div>` : ''}
        </div>
      `;
    } else {
      subject = `Sorella Indumentaria - Confirmación y Gestión de Pedido #${orderData.order_number}`;
      html = buildCustomerOrderEmail(orderData, orderData.payment_id, config);
      if (custom_message) {
        html = html.replace('</h2>', `</h2><div style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #ffeeba; color: #856404;"><strong>Nota de la tienda:</strong> ${custom_message}</div>`);
      }
    }

    const emailResult = await sendEmail(targetEmail, subject, html);
    if (!emailResult.success) {
      console.warn("[ADMIN_SEND_ORDER_EMAIL] SMTP Error:", emailResult.error);
      return res.status(500).json({ 
        success: false, 
        smtp_failed: true,
        error: `No se pudo enviar por SMTP: ${emailResult.error || 'Error al conectar con el servidor de correo'}. Puedes usar el botón de abrir cliente de correo para enviarlo directamente.`, 
        emailResult 
      });
    }

    res.json({ success: true, emailResult, message: `Correo enviado exitosamente a ${targetEmail}` });
  } catch (err: any) {
    console.error("[ADMIN_SEND_ORDER_EMAIL] Error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// POST to test SMTP settings from Admin Config
app.post("/api/admin/test-email", async (req, res) => {
  try {
    const config = await getServerSettings(true);
    const smtpUser = (req.body?.smtp_user || config.smtp_user || '').trim();
    const smtpPass = (req.body?.smtp_pass || config.smtp_pass || '').trim().replace(/\s+/g, '');
    const toEmail = (req.body?.to_email || req.body?.email || smtpUser || 'dgmvolpi@gmail.com').trim();

    if (!smtpUser || !smtpPass) {
      return res.status(400).json({ error: "Faltan las credenciales SMTP (usuario o contraseña de aplicación)" });
    }

    console.log(`[TEST_EMAIL] Testing SMTP for user: ${smtpUser} to: ${toEmail}...`);

    let transporter;
    try {
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false }
      });
      await transporter.verify();
    } catch (e465: any) {
      console.warn("[TEST_EMAIL] Port 465 failed, trying 587:", e465?.message);
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false }
      });
      await transporter.verify();
    }

    const testHtml = `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #22C55E;">✅ Prueba de Correo Exitosa</h2>
        <p>Tu configuración de correo SMTP en Sorella Indumentaria está funcionando correctamente.</p>
        <p>Fecha y Hora: ${new Date().toLocaleString()}</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"Sorella Indumentaria" <${smtpUser}>`,
      to: toEmail,
      subject: "Sorella - Prueba de Configuración de Correo Exitosa",
      html: testHtml
    });

    res.json({ success: true, message: `Correo de prueba enviado con éxito a ${toEmail}`, messageId: info.messageId });
  } catch (err: any) {
    console.error("[TEST_EMAIL] Error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/checkout/failure", async (req, res) => {
  try {
    const { order_id } = req.query;
    if (order_id) {
      const order = await updateOrderStatusOnServer(order_id as string, 'Pago fallido');
      if (order) {
        const orderData = order.data;
        const adminEmail = process.env.ADMIN_EMAIL || 'dgmvolpi@gmail.com';
        const adminWhatsApp = process.env.ADMIN_WHATSAPP;

        const config = await getServerSettings();
        const whatsappLink = config.whatsapp_link || `https://wa.me/${process.env.ADMIN_WHATSAPP || '5491122334455'}`;
        
        const whatsappButton = `
          <div style="margin-top: 30px; text-align: center;">
            <a href="${whatsappLink}" style="display: inline-block; padding: 15px 30px; background-color: #25D366; color: white; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: sans-serif;">
              Contactar por WhatsApp
            </a>
          </div>
        `;

        const customerHtml = `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #EF4444;">Hubo un problema con tu pago</h1>
            <p>Hola ${orderData.customer_name},</p>
            <p>Tu pedido <strong>#${orderData.order_number}</strong> no pudo ser procesado correctamente.</p>
            <p>Puedes intentar realizar el pago nuevamente haciendo clic en el siguiente enlace:</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${req.headers.origin || ''}/api/checkout/retry/${orderData.order_number}" style="display: inline-block; padding: 15px 30px; background-color: #F27D26; color: white; text-decoration: none; border-radius: 50px; font-weight: bold;">Reintentar Pago</a>
            </div>
            <p>O puedes ir a tu perfil en la tienda para ver tus pedidos.</p>
            <p>Si crees que esto es un error o necesitas ayuda, contáctanos:</p>
            ${whatsappButton}
          </div>
        `;

        const adminHtml = `
          <h1>❌ Pago Fallido #${orderData.order_number}</h1>
          <p>El cliente ${orderData.customer_name} intentó pagar pero la transacción falló.</p>
          <p>Pedido: <strong>#${orderData.order_number}</strong></p>
          <p>Total: $${orderData.total}</p>
          <p>Email: ${orderData.customer_email}</p>
        `;

        const whatsappMessage = `❌ *PAGO FALLIDO #${orderData.order_number}*\n\n👤 *Cliente:* ${orderData.customer_name}\n💰 *Total:* $${orderData.total}\n⚠️ El pago no pudo completarse.`;

        await sendEmail(orderData.customer_email, `Sorella - Problema con el pago #${orderData.order_number}`, customerHtml);
        await sendEmail(adminEmail, `❌ PAGO FALLIDO - Pedido #${orderData.order_number}`, adminHtml);
        await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
      }
    }
    res.redirect("/cart?error=payment_failed");
  } catch (err) {
    console.error(err);
    res.redirect("/cart");
  }
});

app.get("/api/checkout/pending", async (req, res) => {
  try {
    const { order_id } = req.query;
    if (order_id) {
      const order = await updateOrderStatusOnServer(order_id as string, 'Pendiente de pago');
      if (order) {
        const orderData = order.data;
        const adminEmail = process.env.ADMIN_EMAIL || 'dgmvolpi@gmail.com';
        const adminWhatsApp = process.env.ADMIN_WHATSAPP;

        const config = await getServerSettings();
        const whatsappLink = config.whatsapp_link || `https://wa.me/${process.env.ADMIN_WHATSAPP || '5491122334455'}`;
        
        const whatsappButton = `
          <div style="margin-top: 30px; text-align: center;">
            <a href="${whatsappLink}" style="display: inline-block; padding: 15px 30px; background-color: #25D366; color: white; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: sans-serif;">
              Contactar por WhatsApp
            </a>
          </div>
        `;

        const customerHtml = `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #FBBF24;">Tu pago está pendiente</h1>
            <p>Hola ${orderData.customer_name}, tu pedido <strong>#${orderData.order_number}</strong> está a la espera de confirmación de pago.</p>
            <p>Te avisaremos en cuanto el pago sea procesado. Si tienes dudas, contáctanos:</p>
            ${whatsappButton}
          </div>
        `;

        const whatsappMessage = `⏳ *PAGO PENDIENTE #${orderData.order_number}*\n\n👤 *Cliente:* ${orderData.customer_name}\n💰 *Total:* $${orderData.total}\nEl pago está siendo procesado por Mercado Pago.`;

        await sendEmail(orderData.customer_email, `Sorella - Pago Pendiente #${orderData.order_number}`, customerHtml);
        await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
      }
    }
    res.redirect("/success?status=pending");
  } catch (err) {
    console.error(err);
    res.redirect("/success");
  }
});

// Order Status Update Notification
app.post("/api/notify-status", async (req, res) => {
  try {
    const { order_number, customer_email, status } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || 'dgmvolpi@gmail.com';
    const adminWhatsApp = process.env.ADMIN_WHATSAPP;
    
    const config = await getServerSettings();
    const whatsappLink = config.whatsapp_link || `https://wa.me/${process.env.ADMIN_WHATSAPP || '5491122334455'}`;
    
    const whatsappButton = `
      <div style="margin-top: 30px; text-align: center;">
        <a href="${whatsappLink}" style="display: inline-block; padding: 15px 30px; background-color: #25D366; color: white; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: sans-serif;">
          Contactar por WhatsApp
        </a>
      </div>
    `;

    const statusHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #F27D26;">Actualización de tu pedido #${order_number}</h1>
        <p>Hola, el estado de tu pedido ha cambiado a: <strong>${status}</strong></p>
        <p>¡Gracias por elegir Sorella! Si tienes alguna duda sobre tu pedido, puedes contactarnos:</p>
        ${whatsappButton}
      </div>
    `;

    const adminStatusHtml = `
      <div style="font-family: sans-serif; color: #333;">
        <h1>🔄 Estado Actualizado #${order_number}</h1>
        <p>El pedido <strong>#${order_number}</strong> del cliente <strong>${customer_email}</strong> ha cambiado a: <strong>${status}</strong></p>
      </div>
    `;
    
    const whatsappMessage = `🔄 *ESTADO ACTUALIZADO #${order_number}*\n\nEl pedido ahora está: *${status}*`;
    
    await sendEmail(customer_email, `Sorella - Actualización de Pedido #${order_number}`, statusHtml);
    await sendEmail(adminEmail, `ACTUALIZACIÓN ESTADO - Pedido #${order_number}`, adminStatusHtml);
    await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// User Registration Notification
app.post("/api/notify-registration", async (req, res) => {
  try {
    const { displayName, email, phone, city, address } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || 'dgmvolpi@gmail.com';

    const userHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #F27D26;">¡Bienvenida a Sorella, ${displayName}!</h1>
        <p>Tu cuenta ha sido creada con éxito.</p>
        <p>Ahora puedes acceder a tu perfil, ver tus pedidos y disfrutar de nuestras colecciones.</p>
        <p>Tu email de acceso: <strong>${email}</strong></p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.APP_URL || '#'}" style="display: inline-block; padding: 15px 30px; background-color: #F27D26; color: white; text-decoration: none; border-radius: 50px; font-weight: bold;">Ir a la Tienda</a>
        </div>
        <p>¡Esperamos que disfrutes tu experiencia!</p>
      </div>
    `;

    const adminHtml = `
      <div style="font-family: sans-serif; color: #333;">
        <h1>👤 Nuevo Usuario Registrado</h1>
        <p>Nombre: <strong>${displayName}</strong></p>
        <p>Email: <strong>${email}</strong></p>
        <p>Teléfono: ${phone || 'N/A'}</p>
        <p>Ciudad: ${city || 'N/A'}</p>
        <p>Dirección: ${address || 'N/A'}</p>
      </div>
    `;

    await sendEmail(email, "¡Bienvenida a Sorella!", userHtml);
    await sendEmail(adminEmail, `NUEVO REGISTRO - ${displayName}`, adminHtml);

    res.json({ success: true });
  } catch (err: any) {
    console.error("Registration Notify Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Test Email Route
app.post("/api/admin/test-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requerido" });

    await sendEmail(email, "Prueba de Correo - Sorella", `
      <h1>Prueba de Funcionamiento</h1>
      <p>Este es un correo de prueba enviado desde el panel de administración de Sorella.</p>
      <p>Si estás viendo esto, la configuración de correo está funcionando correctamente.</p>
    `);
    
    res.json({ success: true, message: "Correo de prueba enviado" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  const PORT = 3000;

  // Vite Integration
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    console.log("Starting Vite...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite ready.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.url.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  // Test connection to Firestore
  getServerSettings().then(config => {
    console.log("[SERVER] Firestore connection test successful. Settings keys:", Object.keys(config).join(', '));
  }).catch(err => {
    console.error("[SERVER] Firestore connection test failed:", err);
  });

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`APP_URL: ${process.env.APP_URL}`);
    });
  }
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});

export default app;
