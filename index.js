require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const token = process.env.TELEGRAM_TOKEN;
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// ========== CONFIGURACIÓN DE GOOGLE SHEETS ==========
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const bot = new TelegramBot(token, { polling: true });

// Estados de usuario en memoria
const userStates = {};
const userPhotos = {}; // Almacenar fotos temporalmente

// ========== FUNCIONES DE GOOGLE SHEETS ==========
async function addToSheet(sheetName, values) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] }
    });
    return true;
  } catch (error) {
    console.error('Error escribiendo en Google Sheets:', error);
    return false;
  }
}

async function findOrderInSheet(numeroPedido) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Pedidos!A:Z'
    });
    
    const rows = response.data.values;
    if (!rows) return null;
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][2] === numeroPedido) {
        return { row: i + 1, data: rows[i] };
      }
    }
    return null;
  } catch (error) {
    console.error('Error buscando en Google Sheets:', error);
    return null;
  }
}

async function updateOrderInSheet(numeroPedido, reviewLink) {
  try {
    const order = await findOrderInSheet(numeroPedido);
    if (!order) return false;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Pedidos!E${order.row}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[reviewLink]] }
    });
    
    return true;
  } catch (error) {
    console.error('Error actualizando Google Sheets:', error);
    return false;
  }
}

// ========== VALIDACIONES ==========
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOrderId(orderId) {
  return /^\d{3}-\d{7}-\d{7}$/.test(orderId);
}

function isValidAmazonUrl(url) {
  return url.includes('amazon.com') || url.includes('amazon.es') || 
         url.includes('/review/') || url.includes('/product-reviews/');
}

// ========== COMANDO /START Y MENSAJES ==========
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? '@' + msg.from.username : msg.from.first_name;
  
  await bot.sendMessage(
    chatId,
    `🎯 *¡Bienvenido a AmazonFlow!* 🎯\n\n` +
    `Hola ${username}, presiona el botón para comenzar 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '🚀 EMPEZAR 🚀' }]
        ],
        resize_keyboard: true
      }
    }
  );
});

// ========== MANEJO DE FOTOS ==========
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state || state.step !== 'awaiting_screenshot') {
    return;
  }

  try {
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    const file = await bot.getFile(fileId);
    const capturaUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    
    state.data.capturaUrl = capturaUrl;
    state.data.fileId = fileId;
    state.step = 'awaiting_paypal_pedido';
    
    await bot.sendMessage(
      chatId,
      `✅ *Captura recibida*\n\n` +
      `💰 Ahora envía tu correo de *PayPal*:`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error procesando captura:', error);
    await bot.sendMessage(chatId, '❌ Error procesando la captura. Intenta de nuevo.');
  }
});

// ========== MANEJO DE MENSAJES ==========
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username ? '@' + msg.from.username : msg.from.first_name;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId];

  // ========== BOTÓN EMPEZAR ==========
  if (text === '🚀 EMPEZAR 🚀') {
    await bot.sendMessage(
      chatId,
      `📋 *MENÚ PRINCIPAL*\n\n` +
      `Selecciona una opción:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [{ text: '👤 REGISTRARSE' }],
            [{ text: '🛍️ HACER PEDIDO' }],
            [{ text: '⭐ SUBIR REVIEW' }],
            [{ text: '❌ Cancelar' }]
          ],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  // ========== CANCELAR ==========
  if (text === '❌ Cancelar') {
    delete userStates[chatId];
    delete userPhotos[chatId];
    await bot.sendMessage(
      chatId,
      '❌ Operación cancelada',
      {
        reply_markup: {
          keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  // ========== REGISTRARSE ==========
  if (text === '👤 REGISTRARSE') {
    userStates[chatId] = { 
      step: 'awaiting_amazon_profile', 
      data: { username } 
    };
    
    await bot.sendMessage(
      chatId,
      `📝 *REGISTRO*\n\n` +
      `Por favor, envía tu *perfil de Amazon*:\n` +
      `(Puede ser el link a tu perfil o tu nombre de usuario)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancelar' }]],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  // ========== HACER PEDIDO ==========
  if (text === '🛍️ HACER PEDIDO') {
    userStates[chatId] = { 
      step: 'awaiting_numero_pedido', 
      data: { username } 
    };
    
    await bot.sendMessage(
      chatId,
      `📦 *NUEVO PEDIDO*\n\n` +
      `Envía el *número de pedido* de Amazon:\n\n` +
      `Formato: \`111-2233445-6677889\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancelar' }]],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  // ========== SUBIR REVIEW ==========
  if (text === '⭐ SUBIR REVIEW') {
    userStates[chatId] = { 
      step: 'awaiting_review_link', 
      data: { username } 
    };
    
    await bot.sendMessage(
      chatId,
      `⭐ *SUBIR REVIEW*\n\n` +
      `Envía el *link de tu review* en Amazon:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancelar' }]],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  // ========== MANEJO DE ESTADOS ==========
  if (!state) {
    await bot.sendMessage(
      chatId,
      `👋 Hola, presiona el botón para comenzar:`,
      {
        reply_markup: {
          keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
          resize_keyboard: true
        }
      }
    );
    return;
  }

  try {
    switch (state.step) {
      // ========== FLUJO DE REGISTRO ==========
      case 'awaiting_amazon_profile':
        state.data.amazonProfile = text;
        state.step = 'awaiting_paypal_registro';
        await bot.sendMessage(
          chatId,
          `💰 Ahora envía tu *correo de PayPal*:`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_paypal_registro':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Envía un email válido:');
          return;
        }
        state.data.paypal = text;
        state.step = 'awaiting_intermediarios';
        await bot.sendMessage(
          chatId,
          `👥 Envía los nombres de tus *intermediarios para referencias*:\n\n` +
          `Puedes enviar 2 o 3 nombres/nicks (con @ si quieres) separados por comas.\n\n` +
          `Ejemplo: Juan, @maria, Pedro`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_intermediarios':
        state.data.intermediarios = text.trim();
        
        const registroExitoso = await addToSheet('Usuarios', [
          new Date().toLocaleDateString('es-ES'),
          state.data.username,
          state.data.amazonProfile,
          state.data.paypal,
          state.data.intermediarios
        ]);
        
        if (registroExitoso) {
          await bot.sendMessage(
            chatId,
            `✅ *¡REGISTRO COMPLETADO!*\n\n` +
            `✓ Usuario: ${state.data.username}\n` +
            `✓ Amazon: ${state.data.amazonProfile}\n` +
            `✓ PayPal: ${state.data.paypal}\n` +
            `✓ Intermediarios: ${state.data.intermediarios}\n\n` +
            `Ya puedes hacer pedidos 🛍️`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
                resize_keyboard: true
              }
            }
          );
        } else {
          await bot.sendMessage(chatId, '❌ Error al registrar. Intenta de nuevo.');
        }
        
        delete userStates[chatId];
        break;

      // ========== FLUJO DE PEDIDO ==========
      case 'awaiting_numero_pedido':
        if (!isValidOrderId(text)) {
          await bot.sendMessage(
            chatId,
            '❌ Número de pedido inválido.\n\n' +
            'Formato correcto: `111-2233445-6677889`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
        state.data.numeroPedido = text;
        state.step = 'awaiting_screenshot';
        await bot.sendMessage(
          chatId,
          `📸 Perfecto. Ahora envía una *captura de pantalla* del pedido:`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_paypal_pedido':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Envía un email válido:');
          return;
        }
        state.data.paypal = text;
        
        const pedidoExitoso = await addToSheet('Pedidos', [
          new Date().toLocaleDateString('es-ES'),
          state.data.username,
          state.data.numeroPedido,
          state.data.paypal,
          '' // Review link vacío por ahora
        ]);
        
        if (pedidoExitoso) {
          // ========== RESUMEN PARA COMPARTIR CON SELLER ==========
          const resumenSeller = 
            `📦 *NUEVO PEDIDO*\n\n` +
            `📅 Fecha: ${new Date().toLocaleDateString('es-ES')}\n` +
            `👤 Usuario: ${state.data.username}\n` +
            `🆔 Número de pedido: \`${state.data.numeroPedido}\`\n` +
            `💰 PayPal: ${state.data.paypal}\n` +
            `📸 Captura: ${state.data.capturaUrl}`;
          
          await bot.sendMessage(
            chatId,
            `✅ *¡PEDIDO REGISTRADO!*\n\n` +
            `📋 *COPIA ESTO PARA EL SELLER:*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            resumenSeller + `\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Recuerda enviar tu review cuando la hagas usando "⭐ SUBIR REVIEW"`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
                resize_keyboard: true
              }
            }
          );
        } else {
          await bot.sendMessage(chatId, '❌ Error al registrar el pedido. Intenta de nuevo.');
        }
        
        delete userStates[chatId];
        break;

      // ========== FLUJO DE REVIEW ==========
      case 'awaiting_review_link':
        if (!isValidAmazonUrl(text)) {
          await bot.sendMessage(chatId, '❌ Link inválido. Debe ser un link de Amazon:');
          return;
        }
        
        state.data.reviewLink = text;
        state.step = 'awaiting_review_numero_pedido';
        
        await bot.sendMessage(
          chatId,
          `🔢 Ahora envía el *número de pedido* asociado a esta review:\n\n` +
          `Formato: \`111-2233445-6677889\``,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_review_numero_pedido':
        if (!isValidOrderId(text)) {
          await bot.sendMessage(
            chatId,
            '❌ Número de pedido inválido.\n\n' +
            'Formato correcto: `111-2233445-6677889`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
        
        state.data.numeroPedido = text;
        state.step = 'awaiting_review_paypal';
        
        await bot.sendMessage(
          chatId,
          `💰 Por último, envía tu correo de *PayPal*:`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_review_paypal':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Envía un email válido:');
          return;
        }
        
        state.data.paypal = text;
        
        // Actualizar el pedido en Google Sheets con la review
        const actualizado = await updateOrderInSheet(
          state.data.numeroPedido, 
          state.data.reviewLink
        );
        
        if (actualizado) {
          // ========== RESUMEN PARA COMPARTIR CON SELLER ==========
          const resumenReview = 
            `⭐ *REVIEW COMPLETADO*\n\n` +
            `👤 Usuario: ${state.data.username}\n` +
            `🆔 Número de pedido: \`${state.data.numeroPedido}\`\n` +
            `🔗 Review: ${state.data.reviewLink}\n` +
            `💰 PayPal: ${state.data.paypal}`;
          
          await bot.sendMessage(
            chatId,
            `✅ *¡REVIEW REGISTRADO!*\n\n` +
            `📋 *COPIA ESTO PARA EL SELLER:*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            resumenReview + `\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `¡Gracias! Recibirás tu pago pronto 💰`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
                resize_keyboard: true
              }
            }
          );
        } else {
          await bot.sendMessage(
            chatId,
            '⚠️ No se encontró el pedido en el sistema.\n' +
            'Verifica el número de pedido e intenta de nuevo.',
            {
              reply_markup: {
                keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
                resize_keyboard: true
              }
            }
          );
        }
        
        delete userStates[chatId];
        break;
    }
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    await bot.sendMessage(
      chatId,
      '❌ Error procesando tu solicitud. Intenta de nuevo.',
      {
        reply_markup: {
          keyboard: [[{ text: '🚀 EMPEZAR 🚀' }]],
          resize_keyboard: true
        }
      }
    );
    delete userStates[chatId];
  }
});

// ========== API ROUTES ==========
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'AmazonFlow Bot Server - Google Sheets',
    version: '3.0'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log('🤖 Bot activo en modo polling');
  console.log('📊 Google Sheets conectado');
  console.log('✅ Sistema listo');
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Promesa rechazada:', error);
});
