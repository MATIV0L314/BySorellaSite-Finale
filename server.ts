import express from "express";
console.log("SERVER STARTING AT " + new Date().toISOString());
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference } from 'mercadopago';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
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

// Helper to get settings
async function getServerSettings() {
  if (!db) {
    console.error("[SERVER] Firestore not initialized");
    return {};
  }
  try {
    const settingsSnap = await db.collection('settings').get();
    const config: any = {};
    settingsSnap.forEach(doc => {
      config[doc.id] = doc.data().value;
    });
    return config;
  } catch (e: any) {
    // If we get a NOT_FOUND error (code 5), it might be because the named database doesn't exist
    if (e.code === 5 || (e.message && e.message.includes('NOT_FOUND'))) {
      console.warn("[SERVER] Firestore database or collection not found. Attempting fallback to default database.");
      try {
        const fallbackDb = getFirestore('(default)');
        const settingsSnap = await fallbackDb.collection('settings').get();
        const config: any = {};
        settingsSnap.forEach(doc => {
          config[doc.id] = doc.data().value;
        });
        // If successful, update the global db instance to use the fallback
        db = fallbackDb;
        return config;
      } catch (fallbackError) {
        console.error("[SERVER] Fallback also failed:", fallbackError);
      }
    }
    console.error("[SERVER] Error fetching settings:", e);
    return {};
  }
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

    const smtpUser = process.env.SMTP_USER || config.smtp_user;
    const smtpPass = process.env.SMTP_PASS || config.smtp_pass;

    if (!smtpUser || !smtpPass) {
      console.log("[EMAIL] SMTP credentials not set. Skipping email send.");
      console.log(`[EMAIL] To: ${to}\nSubject: ${subject}`);
      return;
    }

    console.log(`[EMAIL] Attempting to send email to ${to} using ${smtpUser}...`);

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // use SSL
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

    console.log(`[EMAIL] Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error: any) {
    console.error("[EMAIL] Error sending email:", error);
    throw error;
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

// Mercado Pago Preference Creation
app.get("/api/admin/test-mercadopago", async (req, res) => {
  try {
    const config = await getServerSettings();
    const accessToken = (config.mercadopago_access_token || '').trim();
    
    if (!accessToken) {
      return res.status(400).json({ status: 'error', message: 'Access Token no configurado' });
    }

    const response = await fetch('https://api.mercadopago.com/users/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await response.json();
    if (response.ok) {
      res.json({ status: 'ok', message: 'Conexión exitosa', user: data.nickname });
    } else {
      res.status(response.status).json({ status: 'error', message: data.message || 'Error de conexión' });
    }
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get("/api/checkout/retry/:order_number", async (req, res) => {
  const { order_number } = req.params;
  console.log(`[RETRY] Request received for order: ${order_number}`);
  
  try {
    if (!db) throw new Error("Database not initialized");

    const snapshot = await db.collection('orders').where('order_number', '==', order_number).get();
    
    if (snapshot.empty) {
      console.error(`[RETRY] Order not found: ${order_number}`);
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: "Pedido no encontrado" });
      }
      return res.status(404).send("Pedido no encontrado");
    }
    
    const orderData = snapshot.docs[0].data();
    console.log(`[RETRY] Order found. Status: ${orderData.status}, Total: ${orderData.total}`);
    
    const config = await getServerSettings();
    const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || config.mercadopago_access_token || '').trim();
    
    if (!accessToken) {
      console.error("[RETRY] Mercado Pago access token missing");
      const errorMsg = "Mercado Pago no está configurado. Por favor configure el Access Token en las variables de entorno o en el panel.";
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
        items: orderData.items.map((item: any) => ({
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
    const { items, orderData } = req.body;
    
    const config = await getServerSettings();
    const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || config.mercadopago_access_token || '').trim();
    
    if (!accessToken) {
      console.error("[MP] Mercado Pago access token missing");
      return res.status(400).json({ error: "Mercado Pago no está configurado. Verifique el Access Token en las variables de entorno." });
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

    const customerHtml = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #F27D26;">¡Gracias por tu compra, ${customer_name}!</h1>
        <p>Tu pedido <strong>#${order_number}</strong> ha sido recibido correctamente.</p>
        <p>Estado actual: <strong>Pendiente de pago</strong></p>
        <div style="background: #f9f9f9; padding: 20px; rounded: 10px;">
          <h3>Detalles del Pedido:</h3>
          <ul>${itemsHtml}</ul>
          <p><strong>Total: $${total}</strong></p>
        </div>
        <p>Método de envío: ${shipping_method}</p>
        ${shipping_method === 'Envio a domicilio' ? `<p>Dirección: ${shipping_address}</p>` : '<p>Retiro por local.</p>'}
        <p>Te avisaremos cuando el estado de tu pago cambie. Si tienes alguna duda, puedes contactarnos directamente:</p>
        ${whatsappButton}
      </div>
    `;
    
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

    await sendEmail(customer_email, `Sorella - Confirmación de Pedido #${order_number}`, customerHtml);
    await sendEmail(adminEmail, `NUEVA VENTA - Pedido #${order_number}`, adminHtml);
    await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Notify Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/checkout/success", async (req, res) => {
  try {
    const { order_id, payment_id } = req.query;
    if (order_id && db) {
      const snapshot = await db.collection('orders').where('order_number', '==', order_id).get();
      if (!snapshot.empty) {
        const orderDoc = snapshot.docs[0];
        await orderDoc.ref.update({ 
          status: 'Pagado', 
          payment_id: payment_id as string 
        });
        
        const orderData = orderDoc.data();
        
        // Deduct stock
        for (const item of orderData.items) {
          const productRef = db.collection('products').doc(String(item.id));
          await db.runTransaction(async (transaction: any) => {
            const productDoc = await transaction.get(productRef);
            if (productDoc.exists) {
              const currentStock = productDoc.data().stock || 0;
              transaction.update(productRef, { stock: Math.max(0, currentStock - item.quantity) });
            }
          });
        }
        
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

        const itemsHtml = orderData.items.map((item: any) => {
          let options = [];
          if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
          if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
          if (item.selectedDynamicFilters) {
            Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
          }
          const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
          return `<li>${item.name}${optionsStr} x ${item.quantity} - $${item.price * item.quantity}</li>`;
        }).join('');
        
        const itemsText = orderData.items.map((item: any) => {
          let options = [];
          if (item.selectedSize) options.push(`Talle: ${item.selectedSize}`);
          if (item.selectedColor) options.push(`Color: ${item.selectedColor}`);
          if (item.selectedDynamicFilters) {
            Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
          }
          const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
          return `- ${item.name}${optionsStr} x ${item.quantity} ($${item.price * item.quantity})`;
        }).join('\n');

        const customerHtml = `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #22C55E;">¡Gracias por tu compra, ${orderData.customer_name}!</h1>
            <p>Tu pedido <strong>#${orderData.order_number}</strong> ha sido pagado correctamente.</p>
            <div style="background: #f9f9f9; padding: 20px; rounded: 10px;">
              <h3>Detalles del Pedido:</h3>
              <ul>${itemsHtml}</ul>
              <p><strong>Total: $${orderData.total}</strong></p>
            </div>
            <p>Método de envío: ${orderData.shipping_method}</p>
            ${orderData.shipping_method === 'Envio a domicilio' ? `<p>Dirección: ${orderData.shipping_address}</p>` : '<p>Retiro por local.</p>'}
            <p>Nos contactaremos pronto para coordinar la entrega. Si tienes alguna duda, puedes contactarnos directamente:</p>
            ${whatsappButton}
          </div>
        `;
        
        const adminHtml = `
          <div style="font-family: sans-serif; color: #333;">
            <h1>✅ Venta Pagada #${orderData.order_number}</h1>
            <p>Pedido: <strong>#${orderData.order_number}</strong></p>
            <p>Cliente: ${orderData.customer_name} (${orderData.customer_email})</p>
            <p>Teléfono: ${orderData.customer_phone}</p>
            <h3>Productos:</h3>
            <ul>${itemsHtml}</ul>
            <p><strong>Total: $${orderData.total}</strong></p>
            <p>Método de envío: ${orderData.shipping_method}</p>
            <p>Dirección: ${orderData.shipping_address}</p>
            <p>ID de Pago MP: ${payment_id}</p>
          </div>
        `;

        const whatsappMessage = `✅ *PAGO CONFIRMADO #${orderData.order_number}*\n\n💰 *Total:* $${orderData.total}\n👤 *Cliente:* ${orderData.customer_name}\n📧 *Email:* ${orderData.customer_email}\n📞 *Tel:* ${orderData.customer_phone}\n\n📦 *Productos:*\n${itemsText}\n\n🚚 *Envío:* ${orderData.shipping_method}\n📍 *Dirección:* ${orderData.shipping_address}\n💳 *ID Pago:* ${payment_id}`;

        await sendEmail(orderData.customer_email, `Sorella - Pago Confirmado #${orderData.order_number}`, customerHtml);
        await sendEmail(adminEmail, `✅ NUEVA VENTA PAGADA - Pedido #${orderData.order_number}`, adminHtml);
        await sendWhatsApp(adminWhatsApp || '', whatsappMessage);
      }
    }
    res.redirect("/success");
  } catch (err) {
    console.error(err);
    res.redirect("/success");
  }
});

app.get("/api/checkout/failure", async (req, res) => {
  try {
    const { order_id } = req.query;
    if (order_id && db) {
      const snapshot = await db.collection('orders').where('order_number', '==', order_id).get();
      if (!snapshot.empty) {
        const orderDoc = snapshot.docs[0];
        await orderDoc.ref.update({ status: 'Pago fallido' });
        
        const orderData = orderDoc.data();
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
              <a href="${req.headers.origin}/api/checkout/retry/${orderData.order_number}" style="display: inline-block; padding: 15px 30px; background-color: #F27D26; color: white; text-decoration: none; border-radius: 50px; font-weight: bold;">Reintentar Pago</a>
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
    if (order_id && db) {
      const snapshot = await db.collection('orders').where('order_number', '==', order_id).get();
      if (!snapshot.empty) {
        const orderDoc = snapshot.docs[0];
        await orderDoc.ref.update({ status: 'Pendiente de pago' });
        
        const orderData = orderDoc.data();
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
