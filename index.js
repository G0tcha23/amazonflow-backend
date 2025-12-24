require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

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

// Almacenamiento temporal de datos del pedido
const userOrders = {};

// Estados del flujo
const STATES = {
  ARTICLE: 'article',
  IMAGE: 'image',
  NUMBER: 'number',
  PAYPAL: 'paypal',
  PROFILE: 'profile',
  REVIEW: 'review',
  NICK: 'nick',
  COMMISSION: 'commission'
};

// Función para añadir pedido a Google Sheets
async function addOrderToSheet(order) {
  try {
    const fecha = new Date().toLocaleString('es-ES');
    const row = [
      fecha,
      order.articulo,
      order.imagen,
      order.number,
      order.paypal,
      order.perfil,
      order.review,
      order.nick,
      order.comision,
      'PENDIENTE',
      '' // vendedor vacío
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
    '¡Bienvenido al Bot de Gestión de Pedidos! 📦\n\n' +
    'Comandos disponibles:\n' +
    '/nuevo - Crear nuevo pedido\n' +
    '/ver - Ver pedidos pendientes\n' +
    '/ayuda - Mostrar esta ayuda'
  );
});

bot.onText(/\/nuevo/, (msg) => {
  const chatId = msg.chat.id;
  userOrders[chatId] = { state: STATES.ARTICLE };
  bot.sendMessage(chatId, '📝 Paso 1/8: Envía el nombre del artículo');
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
    mensaje += `📦 Artículo: ${pedido[1]}\n`;
    mensaje += `🔢 Number: ${pedido[3]}\n`;
    mensaje += `💰 PayPal: ${pedido[4]}\n`;
    mensaje += `👤 Perfil AMZ: ${pedido[5]}\n`;
    mensaje += `👤 Nick: ${pedido[7]}\n`;
    mensaje += `💵 Comisión: ${pedido[8]}\n\n`;
  });

  bot.sendMessage(chatId, mensaje);
});

bot.onText(/\/ayuda/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '📖 AYUDA:\n\n' +
    '/nuevo - Iniciar un nuevo pedido\n' +
    '/ver - Ver todos los pedidos pendientes\n' +
    '/cancelar - Cancelar el pedido actual\n' +
    '/ayuda - Mostrar esta ayuda'
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

// Manejador de mensajes
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignorar comandos
  if (text && text.startsWith('/')) return;

  const order = userOrders[chatId];
  if (!order) return;

  switch (order.state) {
    case STATES.ARTICLE:
      order.articulo = text;
      order.state = STATES.IMAGE;
      bot.sendMessage(chatId, '📸 Paso 2/8: Envía la imagen o descripción del artículo');
      break;

    case STATES.IMAGE:
      order.imagen = text;
      order.state = STATES.NUMBER;
      bot.sendMessage(chatId, '🔢 Paso 3/8: Envía el NUMBER');
      break;

    case STATES.NUMBER:
      order.number = text;
      order.state = STATES.PAYPAL;
      bot.sendMessage(chatId, '💳 Paso 4/8: Envía el PayPal');
      break;

    case STATES.PAYPAL:
      order.paypal = text;
      order.state = STATES.PROFILE;
      bot.sendMessage(chatId, '👤 Paso 5/8: Envía el Perfil de Amazon');
      break;

    case STATES.PROFILE:
      order.perfil = text;
      order.state = STATES.REVIEW;
      bot.sendMessage(chatId, '⭐ Paso 6/8: Envía la Review');
      break;

    case STATES.REVIEW:
      order.review = text;
      order.state = STATES.NICK;
      bot.sendMessage(chatId, '🏷️ Paso 7/8: Envía el Nick');
      break;

    case STATES.NICK:
      order.nick = text;
      order.state = STATES.COMMISSION;
      bot.sendMessage(chatId, '💵 Paso 8/8: Envía la Comisión');
      break;

    case STATES.COMMISSION:
      order.comision = text;
      
      bot.sendMessage(chatId, '⏳ Guardando pedido...');
      
      const success = await addOrderToSheet(order);
      
      if (success) {
        bot.sendMessage(chatId, 
          '✅ ¡Pedido creado correctamente!\n\n' +
          '📦 Resumen:\n' +
          `Artículo: ${order.articulo}\n` +
          `Number: ${order.number}\n` +
          `PayPal: ${order.paypal}\n` +
          `Perfil: ${order.perfil}\n` +
          `Nick: ${order.nick}\n` +
          `Comisión: ${order.comision}`
        );
      } else {
        bot.sendMessage(chatId, '❌ Error al guardar el pedido. Intenta de nuevo más tarde.');
      }
      
      delete userOrders[chatId];
      break;
  }
});

console.log('🤖 Bot iniciado con Google Sheets...');
