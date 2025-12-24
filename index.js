require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Configuración de Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Hoja 1';

// Función para leer datos del Sheet
async function leerSheet() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:K`
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Error leyendo Sheet:', error);
    return [];
  }
}

// Función para agregar nueva fila
async function agregarFila(datos) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [datos] }
    });
    return true;
  } catch (error) {
    console.error('Error agregando fila:', error);
    return false;
  }
}

// Función para actualizar una fila
async function actualizarFila(numeroFila, datos) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${numeroFila}:K${numeroFila}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [datos] }
    });
    return true;
  } catch (error) {
    console.error('Error actualizando fila:', error);
    return false;
  }
}

// Función para buscar pedido por número
async function buscarPedidoPorNumero(numero) {
  const datos = await leerSheet();
  for (let i = 0; i < datos.length; i++) {
    if (datos[i][3] === numero) { // Columna NUMBER (índice 3)
      return { fila: i + 2, datos: datos[i] }; // +2 porque: +1 por encabezado, +1 por índice 0
    }
  }
  return null;
}

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '🤖 *Bot AmazonFlow activo*\n\n' +
    '*Comandos disponibles:*\n' +
    '/nuevo - Crear nuevo pedido\n' +
    '/ver - Ver pedidos pendientes\n' +
    '/actualizar - Actualizar estado\n' +
    '/buscar - Buscar por número',
    { parse_mode: 'Markdown' }
  );
});

// Comando /nuevo
const estadoUsuario = {};

bot.onText(/\/nuevo/, (msg) => {
  const chatId = msg.chat.id;
  estadoUsuario[chatId] = { paso: 1, datos: {} };
  bot.sendMessage(chatId, '📝 *Paso 1/8:* Envía el nombre del *ARTÍCULO*', { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text;

  if (!estadoUsuario[chatId] || texto?.startsWith('/')) return;

  const estado = estadoUsuario[chatId];

  switch (estado.paso) {
    case 1: // ARTÍCULO
      estado.datos.articulo = texto;
      estado.paso = 2;
      bot.sendMessage(chatId, '📝 *Paso 2/8:* Envía la *DESCRIPCIÓN* del producto', { parse_mode: 'Markdown' });
      break;

    case 2: // DESCRIPCIÓN
      estado.datos.descripcion = texto;
      estado.paso = 3;
      bot.sendMessage(chatId, '📝 *Paso 3/8:* Envía el *NÚMERO DE PEDIDO*', { parse_mode: 'Markdown' });
      break;

    case 3: // NUMBER
      estado.datos.number = texto;
      estado.paso = 4;
      bot.sendMessage(chatId, '📝 *Paso 4/8:* Envía el correo de *PAYPAL*', { parse_mode: 'Markdown' });
      break;

    case 4: // PAYPAL
      estado.datos.paypal = texto;
      estado.paso = 5;
      bot.sendMessage(chatId, '📝 *Paso 5/8:* Envía el *PERFIL DE AMAZON*', { parse_mode: 'Markdown' });
      break;

    case 5: // PERFIL AMZ
      estado.datos.perfilAmz = texto;
      estado.paso = 6;
      bot.sendMessage(chatId, '📝 *Paso 6/8:* Envía el enlace de la *REVIEW*', { parse_mode: 'Markdown' });
      break;

    case 6: // REVIEW
      estado.datos.review = texto;
      estado.paso = 7;
      bot.sendMessage(chatId, '📝 *Paso 7/8:* Envía el *NICK del comprador*', { parse_mode: 'Markdown' });
      break;

    case 7: // NICK
      estado.datos.nick = texto;
      estado.paso = 8;
      bot.sendMessage(chatId, '📝 *Paso 8/8:* Envía la *COMISIÓN* (ejemplo: 15)', { parse_mode: 'Markdown' });
      break;

    case 8: // COMISIÓN
      estado.datos.comision = texto;
      
      // Crear fila para Google Sheet
      const nuevaFila = [
        new Date().toLocaleDateString('es-ES'),
        estado.datos.articulo,
        estado.datos.descripcion,
        estado.datos.number,
        estado.datos.paypal,
        estado.datos.perfilAmz,
        estado.datos.review,
        estado.datos.nick,
        estado.datos.comision,
        'PENDIENTE',
        msg.from.username || msg.from.first_name
      ];

      const resultado = await agregarFila(nuevaFila);

      if (resultado) {
        bot.sendMessage(chatId, 
          '✅ *Pedido creado exitosamente*\n\n' +
          `📦 Artículo: ${estado.datos.articulo}\n` +
          `🔢 Número: ${estado.datos.number}\n` +
          `👤 Nick: ${estado.datos.nick}\n` +
          `💰 Comisión: ${estado.datos.comision}€`,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(chatId, '❌ Error al crear el pedido. Intenta de nuevo.');
      }

      delete estadoUsuario[chatId];
      break;
  }
});

// Comando /ver
bot.onText(/\/ver/, async (msg) => {
  const chatId = msg.chat.id;
  
  const datos = await leerSheet();
  const pendientes = datos.filter(fila => fila[9] === 'PENDIENTE'); // Columna ESTADO

  if (pendientes.length === 0) {
    bot.sendMessage(chatId, '📋 No hay pedidos pendientes.');
    return;
  }

  let mensaje = '📋 *PEDIDOS PENDIENTES:*\n\n';
  pendientes.forEach(fila => {
    mensaje += `🔢 ${fila[3]}\n`; // NUMBER
    mensaje += `📦 ${fila[1]}\n`; // ARTÍCULO
    mensaje += `👤 ${fila[7]}\n`; // NICK
    mensaje += `💰 ${fila[8]}€\n\n`; // COMISIÓN
  });

  bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

// Comando /actualizar
bot.onText(/\/actualizar (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numero = match[1];
  const nuevoEstado = match[2].toUpperCase();

  const pedido = await buscarPedidoPorNumero(numero);

  if (!pedido) {
    bot.sendMessage(chatId, `❌ No se encontró pedido con número: ${numero}`);
    return;
  }

  const datosActualizados = [...pedido.datos];
  datosActualizados[9] = nuevoEstado; // Actualizar columna ESTADO

  const resultado = await actualizarFila(pedido.fila, datosActualizados);

  if (resultado) {
    bot.sendMessage(chatId, 
      `✅ Pedido actualizado\n\n` +
      `🔢 Número: ${numero}\n` +
      `📊 Estado: ${nuevoEstado}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(chatId, '❌ Error al actualizar el pedido.');
  }
});

// Comando /buscar
bot.onText(/\/buscar (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numero = match[1];

  const pedido = await buscarPedidoPorNumero(numero);

  if (!pedido) {
    bot.sendMessage(chatId, `❌ No se encontró pedido con número: ${numero}`);
    return;
  }

  const [fecha, articulo, descripcion, number, paypal, perfilAmz, review, nick, comision, estado] = pedido.datos;

  bot.sendMessage(chatId,
    `📦 *PEDIDO ENCONTRADO*\n\n` +
    `📅 Fecha: ${fecha}\n` +
    `📦 Artículo: ${articulo}\n` +
    `📝 Descripción: ${descripcion}\n` +
    `🔢 Número: ${number}\n` +
    `💳 PayPal: ${paypal}\n` +
    `🛒 Perfil AMZ: ${perfilAmz}\n` +
    `⭐ Review: ${review}\n` +
    `👤 Nick: ${nick}\n` +
    `💰 Comisión: ${comision}€\n` +
    `📊 Estado: ${estado}`,
    { parse_mode: 'Markdown' }
  );
});

console.log('🤖 Bot iniciado con Google Sheets...');
