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
    console.log(`📝 Intentando escribir en ${sheetName}:`, values);
    
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] }
    });
    
    console.log(`✅ Escrito exitosamente en ${sheetName}`);
    return true;
  } catch (error) {
    console.error(`❌ Error escribiendo en Google Sheets (${sheetName}):`, error.message);
    if (error.response) {
      console.error('Detalles del error:', error.response.data);
    }
    return false;
  }
}

// Función específica para añadir pedido respetando las columnas existentes
async function addPedido(fecha, numeroPedido, paypal, nick) {
  // Columnas: FECHA | ARTICULO | IMAGEN | DESCRIPCION | NUMERO | PAYPAL | PERFIL AMZ | REVIEW | NICK | COMISION | ESTADO | VENDEDOR
  const values = [
    fecha,           // A: FECHA
    '',              // B: ARTICULO (vacío)
    '',              // C: IMAGEN (vacío)
    '',              // D: DESCRIPCION (vacío)
    numeroPedido,    // E: NUMERO
    paypal,          // F: PAYPAL
    '',              // G: PERFIL AMZ (vacío)
    '',              // H: REVIEW (vacío)
    nick,            // I: NICK
    '',              // J: COMISION (vacío)
    'Pendiente',     // K: ESTADO
    ''               // L: VENDEDOR (vacío)
  ];
  
  return await addToSheet('Pedidos', values);
}

async function findOrderInSheet(numeroPedido) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Pedidos!A:L'
    });
    
    const rows = response.data.values;
    if (!rows) return null;
    
    // Buscar en columna E (índice 4) que es NUMERO
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][4] === numeroPedido) { // Columna E (NUMERO)
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
    
    // Actualizar columna H (REVIEW) y K (ESTADO)
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `Pedidos!H${order.row}`, // Columna H: REVIEW
            values: [[reviewLink]]
          },
          {
            range: `Pedidos!K${order.row}`, // Columna K: ESTADO
            values: [['Review Enviado']]
          }
        ]
      }
    });
    
    console.log(`✅ Review actualizado en fila ${order.row}`);
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
          `👥 Envía 2 o 3 *intermediarios* (nombres o nicks):`,
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
          await bot.sendMessage(
            chatId,
            '❌ Error al guardar en Google Sheets.\n\n' +
            'Verifica que la hoja "Usuarios" exista.\n' +
            'Contacta al administrador si el error persiste.',
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
        
        const pedidoExitoso = await addPedido(
          new Date().toLocaleDateString('es-ES'),
          state.data.numeroPedido,
          state.data.paypal,
          state.data.username
        );
        
        if (pedidoExitoso) {
          // ========== RESUMEN PARA COMPARTIR CON SELLER ==========
          const resumenSeller = 
            `📦 *NUEVO PEDIDO*\n\n` +
            `📅 Fecha: ${new Date().toLocaleDateString('es-ES')}\n` +
            `👤 Usuario: ${state.data.username}\n` +
            `🆔 Pedido: \`${state.data.numeroPedido}\`\n` +
            `💰 PayPal: ${state.data.paypal}\n` +
            `📸 Captura: ${state.data.capturaUrl}`;
          
          await bot.sendMessage(
            chatId,
            `✅ *¡PEDIDO REGISTRADO!*\n\n` +
            `📋 Copia esto para el seller:\n` +
            `━━━━━━━━━━━━━\n` +
            resumenSeller + `\n` +
            `━━━━━━━━━━━━━\n\n` +
            `Recuerda subir tu review después 🌟`,
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
            `🆔 Pedido: \`${state.data.numeroPedido}\`\n` +
            `🔗 Review: ${state.data.reviewLink}\n` +
            `💰 PayPal: ${state.data.paypal}`;
          
          await bot.sendMessage(
            chatId,
            `✅ *¡REVIEW REGISTRADO!*\n\n` +
            `📋 Copia esto para el seller:\n` +
            `━━━━━━━━━━━━━\n` +
            resumenReview + `\n` +
            `━━━━━━━━━━━━━\n\n` +
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
            '⚠️ No se encontró el pedido.\n' +
            'Verifica el número e intenta de nuevo.',
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
async function startServer() {
  try {
    // Verificar conexión con Google Sheets
    console.log('🔍 Verificando conexión con Google Sheets...');
    const authClient = await auth.getClient();
    console.log('✅ Autenticación con Google exitosa');
    
    // Verificar que el spreadsheet existe
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      auth: authClient
    });
    console.log(`✅ Google Sheet encontrado: "${spreadsheet.data.properties.title}"`);
    
    app.listen(PORT, () => {
      console.log(`🚀 Servidor en http://localhost:${PORT}`);
      console.log('🤖 Bot activo en modo polling');
      console.log('📊 Google Sheets conectado');
      console.log('✅ Sistema listo');
    });
  } catch (error) {
    console.error('❌ Error al iniciar:', error.message);
    console.error('Verifica tus variables de entorno de Google Sheets');
    process.exit(1);
  }
}

startServer();

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Promesa rechazada:', error);
});
