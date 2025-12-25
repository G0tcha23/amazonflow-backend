require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { google } = require('googleapis');

// Variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Configurar bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Configurar Express
const app = express();
const PORT = process.env.PORT || 10000;

// IDs de administradores
const ADMIN_CHAT_IDS = [8167109];

// Configurar Google Sheets API
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

let HOJA_REGISTRO = ''; // Hoja 1 para registro de usuarios
let HOJA_PEDIDOS = ''; // Hoja 2 para pedidos
let SHEET_PEDIDOS_ID = 0; // ID numérico de la hoja de pedidos para aplicar formatos

// Estado de usuarios
const userStates = {};

// Verificar conexión al iniciar y formatear hoja
(async () => {
  try {
    console.log('🔍 Verificando conexión con Google Sheets...');
    
    const authClient = await auth.getClient();
    console.log('✅ Autenticación con Google exitosa');
    
    // Obtener información del spreadsheet
    const info = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const hojasDisponibles = info.data.sheets;
    
    // Configurar ambas hojas
    if (hojasDisponibles.length >= 2) {
      HOJA_REGISTRO = hojasDisponibles[0].properties.title; // Primera hoja
      HOJA_PEDIDOS = hojasDisponibles[1].properties.title; // Segunda hoja
      SHEET_PEDIDOS_ID = hojasDisponibles[1].properties.sheetId;
    } else {
      // Si solo hay una hoja, usar la misma para todo
      HOJA_REGISTRO = hojasDisponibles[0].properties.title;
      HOJA_PEDIDOS = hojasDisponibles[0].properties.title;
      SHEET_PEDIDOS_ID = hojasDisponibles[0].properties.sheetId;
    }
    
    console.log(`✅ Hoja de registro: "${HOJA_REGISTRO}"`);
    console.log(`✅ Hoja de pedidos: "${HOJA_PEDIDOS}" (ID: ${SHEET_PEDIDOS_ID})`);
    
    // Aplicar formato bonito a la hoja
    await formatearHoja();
    
    console.log('🤖 Bot iniciado exitosamente');
  } catch (error) {
    console.error('❌ Error al iniciar:', error.message);
    console.error('Verifica tus variables de entorno de Google Sheets');
    process.exit(1);
  }
})();

// Función para formatear la hoja de pedidos de forma bonita
async function formatearHoja() {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      resource: {
        requests: [
          // Formato de encabezados (fila 1) en HOJA DE PEDIDOS
          {
            repeatCell: {
              range: {
                sheetId: SHEET_PEDIDOS_ID,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.3, blue: 0.5 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    fontSize: 11,
                    bold: true
                  },
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
            }
          },
          // Bordes en toda la tabla
          {
            updateBorders: {
              range: {
                sheetId: SHEET_PEDIDOS_ID,
                startRowIndex: 0,
                endRowIndex: 1000,
                startColumnIndex: 0,
                endColumnIndex: 12
              },
              top: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
              bottom: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
              left: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
              right: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
              innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.9, green: 0.9, blue: 0.9 } },
              innerVertical: { style: 'SOLID', width: 1, color: { red: 0.9, green: 0.9, blue: 0.9 } }
            }
          },
          // Congelar primera fila
          {
            updateSheetProperties: {
              properties: {
                sheetId: SHEET_PEDIDOS_ID,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });
    console.log('✨ Formato bonito aplicado a la hoja de pedidos');
  } catch (error) {
    console.error('⚠️ No se pudo aplicar formato:', error.message);
  }
}

// Función para aplicar colores a las filas DE LA HOJA DE PEDIDOS
async function applyColor(rowIndex, color) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      resource: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: SHEET_PEDIDOS_ID,
              startRowIndex: rowIndex - 1,
              endRowIndex: rowIndex,
              startColumnIndex: 0,
              endColumnIndex: 12
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: color
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        }]
      }
    });
    console.log(`✅ Color aplicado a fila ${rowIndex} en hoja de pedidos`);
  } catch (error) {
    console.error('❌ Error al aplicar color:', error.message);
  }
}

// Función para añadir REGISTRO a la Hoja 1
async function addRegistro(fecha, usuario, perfilAmazon, paypal, intermediarios) {
  try {
    const values = [[
      fecha,           // A: FECHA
      usuario,         // B: USUARIO
      perfilAmazon,    // C: PERFIL
      paypal,          // D: PAYPAL
      intermediarios   // E: INTERMEDIARIOS
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_REGISTRO}!A:E`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    console.log('✅ Registro añadido a Hoja 1');
    return true;
  } catch (error) {
    console.error('❌ Error al añadir registro:', error.message);
    return false;
  }
}

// Función para añadir PEDIDO a la Hoja 2
async function addPedido(fecha, usuario, numeroPedido, paypal, perfilAmazon, imageUrl) {
  try {
    const values = [[
      fecha,           // A: FECHA
      '',              // B: ARTICULO (vacío)
      imageUrl || '',  // C: IMAGEN (URL de la imagen de Telegram)
      '',              // D: DESCRIPCION (vacío)
      numeroPedido,    // E: NUMERO
      paypal,          // F: PAYPAL
      perfilAmazon || '', // G: PERFIL AMZ
      '',              // H: REVIEW (vacío)
      usuario,         // I: NICK
      '',              // J: COMISION (vacío)
      'Pendiente',     // K: ESTADO
      ''               // L: VENDEDOR (vacío)
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!A:L`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    console.log('✅ Pedido añadido a Hoja 2');
    return true;
  } catch (error) {
    console.error('❌ Error al añadir pedido:', error.message);
    return false;
  }
}

// Función para buscar pedido y actualizar review
async function updateReview(numeroPedido, reviewLink) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!A:L`
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Buscar el pedido en la columna E (NUMERO)
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][4] === numeroPedido) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      return false;
    }

    // Actualizar columna H (REVIEW)
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[reviewLink]] }
    });

    // Actualizar columna K (ESTADO)
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!K${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Review Enviada']] }
    });

    // Aplicar color azul celeste
    await applyColor(rowIndex, { red: 0.68, green: 0.85, blue: 0.9 });

    console.log('✅ Review actualizada con color azul celeste');
    return true;
  } catch (error) {
    console.error('❌ Error al actualizar review:', error.message);
    return false;
  }
}

// Función para actualizar estado como "Review Pagada" (ADMIN)
async function markAsPaid(numeroPedido) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!A:L`
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Buscar el pedido en la columna E (NUMERO)
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][4] === numeroPedido) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      return false;
    }

    // Actualizar columna K (ESTADO)
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${HOJA_PEDIDOS}!K${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Review Pagada']] }
    });

    // Aplicar color azul oscuro
    await applyColor(rowIndex, { red: 0.26, green: 0.52, blue: 0.96 });

    console.log('✅ Pedido marcado como pagado con color azul oscuro');
    return true;
  } catch (error) {
    console.error('❌ Error al marcar como pagado:', error.message);
    return false;
  }
}

// Teclado principal
function getMainKeyboard(chatId) {
  const isAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  const keyboard = [
    [{ text: '📝 REGISTRARSE', callback_data: 'registrarse' }],
    [{ text: '🛍️ HACER PEDIDO', callback_data: 'hacer_pedido' }],
    [{ text: '⭐ SUBIR REVIEW', callback_data: 'subir_review' }]
  ];
  
  if (isAdmin) {
    keyboard.push([{ text: '💰 MARCAR PAGADO', callback_data: 'marcar_pagado' }]);
  }
  
  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const isAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  if (isAdmin) {
    console.log(`👑 Admin conectado - Chat ID: ${chatId}`);
  }
  
  bot.sendMessage(
    chatId,
    `¡Hola ${username}! 👋\n\nBienvenido al bot de gestión de pedidos de Amazon.\n\nSelecciona una opción:`,
    getMainKeyboard(chatId)
  );
});

// Manejar mensajes de texto
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignorar comandos
  if (text && text.startsWith('/')) return;

  const state = userStates[chatId];

  if (!state) {
    // Mostrar botón EMPEZAR si no hay estado
    bot.sendMessage(
      chatId,
      '👋 ¡Hola! Para comenzar, pulsa el botón:',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 EMPEZAR 🚀', callback_data: 'start' }
          ]]
        }
      }
    );
    return;
  }

  // FLUJO REGISTRO
  if (state.action === 'registro' && state.step === 'perfil') {
    userStates[chatId] = { ...state, step: 'paypal', perfil: text };
    bot.sendMessage(chatId, '💳 Envía tu correo de PayPal:');
  } else if (state.action === 'registro' && state.step === 'paypal') {
    userStates[chatId] = { ...state, step: 'intermediarios', paypal: text };
    bot.sendMessage(chatId, '👥 Envía 2 o 3 intermediarios (nombres o nicks):');
  } else if (state.action === 'registro' && state.step === 'intermediarios') {
    const fecha = new Date().toLocaleDateString('es-ES');
    const usuario = msg.from.username || msg.from.first_name;
    const { perfil, paypal } = state;

    addRegistro(fecha, usuario, perfil, paypal, text).then(success => {
      if (success) {
        bot.sendMessage(chatId, '✅ ¡REGISTRO COMPLETADO! Ya puedes hacer pedidos 🛍️', getMainKeyboard(chatId));
      } else {
        bot.sendMessage(chatId, '❌ Error al registrar. Intenta de nuevo.', getMainKeyboard(chatId));
      }
    });

    delete userStates[chatId];
  }

  // FLUJO HACER PEDIDO
  else if (state.action === 'pedido' && state.step === 'numero') {
    userStates[chatId] = { ...state, step: 'captura', numero: text };
    bot.sendMessage(chatId, '📸 Envía la captura de pantalla del pedido:');
  } else if (state.action === 'pedido' && state.step === 'paypal') {
    const fecha = new Date().toLocaleDateString('es-ES');
    const usuario = msg.from.username || msg.from.first_name;
    const { numero, imageUrl, perfil } = state;

    addPedido(fecha, usuario, numero, text, perfil, imageUrl).then(success => {
      if (success) {
        // Enviar resumen con imagen
        const resumen = `📦 PEDIDO REGISTRADO\n\n🔢 Número: ${numero}\n💳 PayPal: ${text}\n👤 Usuario: ${usuario}\n📅 Fecha: ${fecha}`;
        
        if (imageUrl) {
          bot.sendPhoto(chatId, imageUrl, {
            caption: resumen + '\n\n✅ Pedido guardado'
          }).then(() => {
            bot.sendMessage(chatId, '📋 Menú principal:', getMainKeyboard(chatId));
          });
        } else {
          bot.sendMessage(chatId, resumen + '\n\n✅ Pedido guardado', getMainKeyboard(chatId));
        }
      } else {
        bot.sendMessage(chatId, '❌ Error al guardar. Intenta de nuevo.', getMainKeyboard(chatId));
      }
    });

    delete userStates[chatId];
  }

  // FLUJO SUBIR REVIEW
  else if (state.action === 'review' && state.step === 'link') {
    userStates[chatId] = { ...state, step: 'numero', link: text };
    bot.sendMessage(chatId, '🔢 Envía el número de pedido:');
  } else if (state.action === 'review' && state.step === 'numero') {
    userStates[chatId] = { ...state, step: 'paypal', numero: text };
    bot.sendMessage(chatId, '💳 Envía tu PayPal:');
  } else if (state.action === 'review' && state.step === 'paypal') {
    const { link, numero } = state;

    updateReview(numero, link).then(success => {
      if (success) {
        const resumen = `⭐ REVIEW ENVIADA\n\n🔗 Review: ${link}\n🔢 Pedido: ${numero}\n💳 PayPal: ${text}`;
        bot.sendMessage(chatId, resumen + '\n\n✅ Review registrada', getMainKeyboard(chatId));
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido.', getMainKeyboard(chatId));
      }
    });

    delete userStates[chatId];
  }

  // FLUJO MARCAR COMO PAGADO (ADMIN)
  else if (state.action === 'marcar_pagado') {
    markAsPaid(text).then(success => {
      if (success) {
        bot.sendMessage(chatId, `✅ Pedido ${text} marcado como PAGADO (azul oscuro)`, getMainKeyboard(chatId));
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido.', getMainKeyboard(chatId));
      }
    });

    delete userStates[chatId];
  }
});

// Manejar fotos
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  // Si es admin enviando captura con número en caption
  if (ADMIN_CHAT_IDS.includes(chatId) && msg.caption) {
    const numeroPedido = msg.caption.trim();
    markAsPaid(numeroPedido).then(success => {
      if (success) {
        bot.sendMessage(chatId, `✅ Pedido ${numeroPedido} marcado como PAGADO`, getMainKeyboard(chatId));
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido.', getMainKeyboard(chatId));
      }
    });
    return;
  }

  // Si es un pedido en proceso esperando captura
  if (state && state.action === 'pedido' && state.step === 'captura') {
    try {
      // Obtener el file_id de la foto más grande
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;
      
      // Obtener el link de la foto
      const fileLink = await bot.getFileLink(fileId);
      
      userStates[chatId] = { ...state, step: 'paypal', imageUrl: fileLink };
      bot.sendMessage(chatId, '✅ Captura guardada!\n\n💳 Ahora envía tu PayPal:');
    } catch (error) {
      console.error('Error al obtener imagen:', error);
      bot.sendMessage(chatId, '❌ Error al guardar la imagen. Envía tu PayPal:', getMainKeyboard(chatId));
    }
  } else {
    bot.sendMessage(chatId, '❌ No estoy esperando ninguna foto ahora.', getMainKeyboard(chatId));
  }
});

// Manejar botones
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (data === 'start') {
    bot.sendMessage(chatId, '👋 ¡Perfecto! Selecciona una opción:', getMainKeyboard(chatId));
  } else if (data === 'registrarse') {
    userStates[chatId] = { action: 'registro', step: 'perfil' };
    bot.sendMessage(chatId, '🛒 Envía tu perfil de Amazon:');
  } else if (data === 'hacer_pedido') {
    userStates[chatId] = { action: 'pedido', step: 'numero' };
    bot.sendMessage(chatId, '🔢 Envía el número de pedido:');
  } else if (data === 'subir_review') {
    userStates[chatId] = { action: 'review', step: 'link' };
    bot.sendMessage(chatId, '🔗 Envía el enlace de la review:');
  } else if (data === 'marcar_pagado') {
    if (ADMIN_CHAT_IDS.includes(chatId)) {
      userStates[chatId] = { action: 'marcar_pagado' };
      bot.sendMessage(chatId, '🔢 Envía el número de pedido a marcar como PAGADO:');
    } else {
      bot.sendMessage(chatId, '❌ No tienes permisos para esta acción.');
    }
  }
});

// Iniciar servidor Express
app.get('/', (req, res) => {
  res.send('Bot de AmazonFlow está funcionando ✅');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor Express escuchando en puerto ${PORT}`);
});
