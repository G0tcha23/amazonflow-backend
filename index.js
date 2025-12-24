require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const express = require('express');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Servidor HTTP para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('✅ Bot de Telegram activo y funcionando');
});

app.get('/status', (req, res) => {
  res.json({ status: 'online', bot: 'running' });
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP en puerto ${PORT}`);
});

// Configuración de Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: "amazonflow",
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Hoja 1';

// Almacenamiento temporal
const userOrders = {};

// Estados
const STATES = {
  IMAGE: 'image',
  NUMBER: 'number',
  PAYPAL: 'paypal'
};

// Función para añadir pedido a Google Sheets
async function addOrderToSheet(order) {
  try {
    const fecha = new Date().toLocaleString('es-ES');
    const row = [
      fecha,              // fecha (automático)
      '',                 // articulo (vacío)
      order.imagen,       // IMAGEN/descripcion
      order.number,       // NUMBER
      order.paypal,       // PAYPAL
      '',                 // PERFIL AMZ (vacío)
      '',                 // REVIEW (vacío)
      order.nick,         // nick (automático del usuario)
      '',                 // comision (vacío)
      'PENDIENTE',        // ESTADO
      ''                  // vendedor (vacío)
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    });

    return true;
  } catch (error) {
    console.error('Error añadiendo a Google Sheets:', error);
    return false;
  }
}

// Función para obtener pedidos pendientes
async function getPendingOrders() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:K`
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const pendientes = rows.slice(1).filter(row => row[9] === 'PENDIENTE');
    return pendientes;
  } catch (error) {
    console.error('Error obteniendo pedidos:', error);
    return [];
  }
}

// Comandos
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '¡Bienvenido al Bot de Pedidos! 📦\n\n' +
    'Para crear un pedido usa: /nuevo\n\n' +
    'Te pediré:\n' +
    '1️⃣ Captura del pedido\n' +
    '2️⃣ Número de pedido\n' +
    '3️⃣ Tu PayPal\n\n' +
    'Otros comandos:\n' +
    '/ver - Ver pedidos pendientes\n' +
    '/ayuda - Ayuda'
  );
});

bot.onText(/\/nuevo/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'Desconocido';
  userOrders[chatId] = { 
    state: STATES.IMAGE,
    nick: '@' + username
  };
  bot.sendMessage(chatId, '📸 Paso 1/3: Envía la captura de tu pedido (imagen o URL)');
});

bot.onText(/\/ver/, async (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, '🔍 Consultando pedidos pendientes...');
  
  const pedidos = await getPendingOrders();
  
  if (pedidos.length === 0) {
    bot.sendMessage(chatId, '✅ No hay pedidos pendientes');
    return;
  }

  let mensaje = `📋 PEDIDOS PENDIENTES (${pedidos.length}):\n\n`;
  
  pedidos.forEach((pedido, index) => {
    mensaje += `━━━━━━━━━━━━━━━━━\n`;
    mensaje += `#${index + 1}\n`;
    mensaje += `📅 Fecha: ${pedido[0]}\n`;
    mensaje += `🔢 Number: ${pedido[3]}\n`;
    mensaje += `💰 PayPal: ${pedido[4]}\n\n`;
  });

  bot.sendMessage(chatId, mensaje);
});

bot.onText(/\/ayuda/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '📖 AYUDA:\n\n' +
    '/nuevo - Crear nuevo pedido\n' +
    'Solo necesitas enviar 3 cosas:\n' +
    '1. Captura del pedido\n' +
    '2. Número de pedido\n' +
    '3. Tu PayPal\n\n' +
    '/ver - Ver pedidos pendientes\n' +
    '/cancelar - Cancelar pedido actual'
  );
});

bot.onText(/\/cancelar/, (msg) => {
  const chatId = msg.chat.id;
  if (userOrders[chatId]) {
    delete userOrders[chatId];
    bot.sendMessage(chatId, '❌ Pedido cancelado');
  } else {
    bot.sendMessage(chatId, 'No hay ningún pedido en curso');
  }
});

// Manejador de mensajes y fotos
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const photo = msg.photo;

  // Ignorar comandos
  if (text && text.startsWith('/')) return;

  const order = userOrders[chatId];
  if (!order) return;

  switch (order.state) {
    case STATES.IMAGE:
      if (photo) {
        // Si envía foto, guardamos el ID de la foto más grande
        const fileId = photo[photo.length - 1].file_id;
        order.imagen = `[Imagen: ${fileId}]`;
      } else if (text) {
        // Si envía texto (URL o descripción)
        order.imagen = text;
      } else {
        bot.sendMessage(chatId, '❌ Por favor envía una imagen o URL');
        return;
      }
      
      order.state = STATES.NUMBER;
      bot.sendMessage(chatId, '🔢 Paso 2/3: Envía el número de pedido');
      break;

    case STATES.NUMBER:
      order.number = text;
      order.state = STATES.PAYPAL;
      bot.sendMessage(chatId, '💳 Paso 3/3: Envía tu PayPal');
      break;

    case STATES.PAYPAL:
      order.paypal = text;
      
      bot.sendMessage(chatId, '⏳ Guardando pedido...');
      
      const success = await addOrderToSheet(order);
      
      if (success) {
        bot.sendMessage(chatId, 
          '✅ ¡Pedido registrado correctamente!\n\n' +
          '📦 Resumen:\n' +
          `Número: ${order.number}\n` +
          `PayPal: ${order.paypal}\n\n` +
          '⏰ Tu pedido está siendo procesado'
        );
      } else {
        bot.sendMessage(chatId, '❌ Error al guardar el pedido. Intenta de nuevo más tarde.');
      }
      
      delete userOrders[chatId];
      break;
  }
});

console.log('🤖 Bot iniciado con Google Sheets...');
