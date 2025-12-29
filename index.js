import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import express from 'express';
import { createRequire } from 'module';

// Compatibilidad para librerías que requieran require explícito
const require = createRequire(import.meta.url);

// Configuración
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 10000;

// IDs de administradores
const ADMIN_CHAT_IDS = [8167109];

// Lista de vendedores (AÑADE AQUÍ LOS NOMBRES EXACTOS DE LAS HOJAS DE TUS VENDEDORES)
const VENDEDORES = [
  // 'Vendedor1',
  // 'Vendedor2',
];

// CONSTANTE GLOBAL PARA TEXTO NEGRO
const TEXTO_NEGRO_FORMATO = { red: 0, green: 0, blue: 0 };

// Autenticación Google Sheets
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// Estados de usuario
const userStates = {};
const userTimeouts = {};

// Cache de usuarios registrados
const registeredUsers = new Map();

// Cache de chat_ids de usuarios
const userChatIds = new Map();

// Mapeo de estados a colores
const ESTADOS_COLORES = {
  'Pendiente': {
    bg: { red: 1, green: 1, blue: 1 }, // Blanco
    emoji: '⚪'
  },
  'Review Subida': {
    bg: { red: 1, green: 0.647, blue: 0 }, // Naranja
    emoji: '🟠'
  },
  'Review Enviada': {
    bg: { red: 0.682, green: 0.851, blue: 0.902 }, // Azul Celeste
    emoji: '💙'
  },
  'Review Pagada': {
    bg: { red: 0.259, green: 0.522, blue: 0.957 }, // Azul Oscuro
    emoji: '🔵'
  },
  'Completado': {
    bg: { red: 1, green: 1, blue: 0 }, // Amarillo
    emoji: '🟡'
  }
};

// --- INICIALIZACIÓN ---

async function initSheet() {
  try {
    await doc.loadInfo();
    console.log('✅ Autenticación con Google exitosa');
    console.log('📊 Documento:', doc.title);
    
    const sheet = doc.sheetsByIndex[1];
    if (!sheet) throw new Error('No se encuentra la Hoja 2 (Pedidos)');
    
    console.log('📄 Hoja 2 encontrada:', sheet.title);
    await sheet.loadHeaderRow();
    
    if (!sheet.headerValues.includes('PAGADO')) {
      await añadirColumnaPagado(sheet);
    }
    
    await formatearEncabezados(sheet); // Formatear principal
    
    if (VENDEDORES.length > 0) {
      await crearHojasVendedores();
    } else {
      console.log('ℹ️ No hay vendedores configurados en la lista VENDEDORES.');
    }
    
    await cargarUsuariosRegistrados();
    
    // Iniciar sincronización periódica
    iniciarSincronizacionColores();
    
    console.log('🤖 Bot iniciado exitosamente');
  } catch (error) {
    console.error('❌ Error al iniciar:', error.message);
    process.exit(1);
  }
}

// Cargar usuarios
async function cargarUsuariosRegistrados() {
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const rows = await sheetRegistro.getRows();
    registeredUsers.clear();
    userChatIds.clear();
    
    for (const row of rows) {
      const perfil = row.get('PERFIL');
      const paypal = row.get('PAYPAL');
      const chatId = row.get('CHAT_ID');
      
      if (perfil && paypal) {
        registeredUsers.set(perfil.toLowerCase(), { 
          perfil, 
          paypal, 
          usuario: row.get('USUARIO') 
        });
        
        if (chatId) {
          userChatIds.set(paypal, parseInt(chatId));
        }
      }
    }
    console.log(`✅ Usuarios cargados: ${registeredUsers.size}`);
  } catch (error) {
    console.error('❌ Error cargando usuarios:', error);
  }
}

async function añadirColumnaPagado(sheet) {
  try {
    const headers = ['FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'];
    await sheet.setHeaderRow(headers);
    console.log('✅ Columna PAGADO añadida');
  } catch (error) {
    console.error('❌ Error añadiendo columna:', error);
  }
}

// --- FUNCIONES DE FORMATO Y COLOR (SIEMPRE TEXTO NEGRO) ---

async function formatearEncabezados(sheet) {
  try {
    await sheet.loadCells('A1:M1');
    for (let i = 0; i < 13; i++) {
      const cell = sheet.getCell(0, i);
      if (!cell.textFormat) cell.textFormat = {};
      
      cell.textFormat.bold = true;
      cell.textFormat.foregroundColor = TEXTO_NEGRO_FORMATO; // SIEMPRE NEGRO
      cell.backgroundColor = { red: 0.1, green: 0.137, blue: 0.494 }; // Azul fondo
      cell.horizontalAlignment = 'CENTER';
    }
    await sheet.saveUpdatedCells();
  } catch (error) {
    console.error(`❌ Error formateando encabezados ${sheet.title}:`, error);
  }
}

async function crearHojasVendedores() {
  for (const vendedor of VENDEDORES) {
    try {
      let hojaVendedor = doc.sheetsByTitle[vendedor];
      if (!hojaVendedor) {
        hojaVendedor = await doc.addSheet({ title: vendedor });
        console.log(`✨ Hoja creada: ${vendedor}`);
      }
      
      const headers = ['FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'];
      await hojaVendedor.setHeaderRow(headers);
      
      await formatearEncabezados(hojaVendedor); // Reusamos la función que pone texto negro
      console.log(`✅ Hoja ${vendedor} actualizada`);
      
    } catch (error) {
      console.error(`Error con hoja ${vendedor}:`, error.message);
    }
  }
}

// Aplicar color de estado estándar
async function aplicarColorEstado(sheet, rowIndex, estado) {
  try {
    const colorConfig = ESTADOS_COLORES[estado];
    if (!colorConfig) return;
    
    await sheet.loadCells(`A${rowIndex}:M${rowIndex}`);
    
    for (let i = 0; i < 13; i++) {
      const cell = sheet.getCell(rowIndex - 1, i);
      cell.backgroundColor = colorConfig.bg;
      
      // CRÍTICO: SIEMPRE TEXTO NEGRO
      if (!cell.textFormat) cell.textFormat = {};
      cell.textFormat.foregroundColor = TEXTO_NEGRO_FORMATO;
    }
    
    await sheet.saveUpdatedCells();
  } catch (error) {
    console.error(`❌ Error color fila ${rowIndex}:`, error.message);
  }
}

// Aplicar color personalizado (para sincronización)
async function aplicarColorPersonalizado(sheet, rowIndex, bgColor) {
  try {
    await sheet.loadCells(`A${rowIndex}:M${rowIndex}`);
    
    for (let i = 0; i < 13; i++) {
      const cell = sheet.getCell(rowIndex - 1, i);
      cell.backgroundColor = bgColor;
      
      // CRÍTICO: SIEMPRE TEXTO NEGRO
      if (!cell.textFormat) cell.textFormat = {};
      cell.textFormat.foregroundColor = TEXTO_NEGRO_FORMATO;
    }
    
    await sheet.saveUpdatedCells();
    console.log(`🎨 Color sincronizado en fila ${rowIndex} con TEXTO NEGRO`);
  } catch (error) {
    console.error(`❌ Error color personalizado:`, error.message);
  }
}

// --- SINCRONIZACIÓN DE COLORES ---

// Detectar si una celda es amarilla (para cambiar estado a Completado si se desea)
function esColorAmarillo(bgColor) {
  if (!bgColor) return false;
  // Amarillo aprox: rojo alto, verde alto, azul bajo
  return (bgColor.red || 0) > 0.9 && (bgColor.green || 0) > 0.9 && (bgColor.blue || 0) < 0.3;
}

async function sincronizarColoresVendedores() {
  try {
    const sheetPrincipal = doc.sheetsByIndex[1];
    if (!sheetPrincipal) return;
    
    const rowsPrincipal = await sheetPrincipal.getRows();
    
    for (const vendedor of VENDEDORES) {
      try {
        const hojaVendedor = doc.sheetsByTitle[vendedor];
        if (!hojaVendedor) continue;
        
        const rowsVendedor = await hojaVendedor.getRows();
        
        for (const rowVendedor of rowsVendedor) {
          const numero = rowVendedor.get('NUMERO');
          if (!numero) continue;
          
          // Leer color de la fila del vendedor (celda A)
          const filaVendedor = rowVendedor.rowNumber;
          await hojaVendedor.loadCells(`A${filaVendedor}:A${filaVendedor}`);
          const celdaVendedor = hojaVendedor.getCell(filaVendedor - 1, 0);
          const colorVendedor = celdaVendedor.backgroundColor;
          
          if (colorVendedor) {
            // Buscar pedido en hoja principal
            const rowPrincipal = rowsPrincipal.find(r => r.get('NUMERO') === numero);
            
            if (rowPrincipal) {
              const filaPrincipal = rowPrincipal.rowNumber;
              await sheetPrincipal.loadCells(`A${filaPrincipal}:A${filaPrincipal}`);
              const celdaPrincipal = sheetPrincipal.getCell(filaPrincipal - 1, 0);
              const colorPrincipal = celdaPrincipal.backgroundColor;
              
              // Comparar colores con pequeña tolerancia
              const diff = (c1, c2) => Math.abs((c1 || 0) - (c2 || 0));
              const esDiferente = !colorPrincipal || 
                diff(colorVendedor.red, colorPrincipal.red) > 0.05 ||
                diff(colorVendedor.green, colorPrincipal.green) > 0.05 ||
                diff(colorVendedor.blue, colorPrincipal.blue) > 0.05;
              
              if (esDiferente) {
                console.log(`🔄 Sincronizando color de ${vendedor} -> Hoja 2: Pedido ${numero}`);
                // Aplicar el color del vendedor a la hoja principal (MANTENIENDO TEXTO NEGRO)
                await aplicarColorPersonalizado(sheetPrincipal, filaPrincipal, colorVendedor);
                
                // Lógica adicional: Si es amarillo, marcar como completado
                if (esColorAmarillo(colorVendedor)) {
                   const estadoActual = rowPrincipal.get('ESTADO');
                   if (estadoActual !== 'Completado') {
                     rowPrincipal.set('ESTADO', 'Completado');
                     rowPrincipal.set('PAGADO', 'PAGADO');
                     await rowPrincipal.save();
                     console.log(`🟡 Pedido ${numero} marcado como completado automáticamente.`);
                   }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error sincronizando ${vendedor}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Error general en sincronización:', error.message);
  }
}

function iniciarSincronizacionColores() {
  console.log('🔄 Sincronización automática activada (cada 30s)');
  setInterval(() => {
    sincronizarColoresVendedores();
  }, 30000);
}

// --- LÓGICA DEL BOT ---

function limpiarEstadoUsuario(chatId) {
  delete userStates[chatId];
  if (userTimeouts[chatId]) {
    clearTimeout(userTimeouts[chatId]);
    delete userTimeouts[chatId];
  }
}

function establecerTimeout(chatId) {
  if (userTimeouts[chatId]) clearTimeout(userTimeouts[chatId]);
  userTimeouts[chatId] = setTimeout(() => {
    if (userStates[chatId]) {
      delete userStates[chatId];
      bot.sendMessage(chatId, '⏱️ Sesión expirada por inactividad. /start');
    }
    delete userTimeouts[chatId];
  }, 5 * 60 * 1000);
}

function getBotonesControl() {
  return {
    keyboard: [[{ text: '❌ CANCELAR' }, { text: '🏠 MENÚ PRINCIPAL' }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function mostrarMenuPrincipal(chatId, esAdmin = false) {
  const opciones = [
    [{ text: '📝 REGISTRARSE', callback_data: 'registrarse' }],
    [{ text: '🛍️ HACER PEDIDO', callback_data: 'hacer_pedido' }],
    [{ text: '⭐ SUBIR REVIEW', callback_data: 'subir_review' }]
  ];
  
  if (esAdmin) {
    opciones.push(
      [{ text: '🔔 REVIEWS PENDIENTES', callback_data: 'reviews_pendientes' }],
      [{ text: '💰 MARCAR PAGADO', callback_data: 'marcar_pagado' }]
    );
  }
  
  bot.sendMessage(chatId, '¡Hola! 👋\n\nBienvenido al bot de gestión de pedidos.\n\nSelecciona una opción:', {
    reply_markup: { inline_keyboard: opciones, remove_keyboard: true }
  });
}

// --- HANDLERS DEL BOT ---

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  limpiarEstadoUsuario(chatId);
  
  if (msg.from.username) {
    cargarYActualizarChatId(msg.from.username, chatId);
  }
  
  mostrarMenuPrincipal(chatId, esAdmin);
});

async function cargarYActualizarChatId(username, chatId) {
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const rows = await sheetRegistro.getRows();
    for (const row of rows) {
      if (row.get('USUARIO')?.toLowerCase() === username.toLowerCase()) {
        row.set('CHAT_ID', chatId.toString());
        await row.save();
        if (row.get('PAYPAL')) userChatIds.set(row.get('PAYPAL'), chatId);
        break;
      }
    }
  } catch (e) { console.error(e); }
}

bot.onText(/\/cancelar/, (msg) => {
  limpiarEstadoUsuario(msg.chat.id);
  bot.sendMessage(msg.chat.id, '❌ Operación cancelada.', { reply_markup: { remove_keyboard: true } });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  bot.answerCallbackQuery(query.id);
  
  if (data === 'registrarse') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_perfil_amazon' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '📝 *REGISTRO*\n\nEnvía tu perfil de Amazon:', { parse_mode: 'Markdown', reply_markup: getBotonesControl() });
    
  } else if (data === 'hacer_pedido') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_numero_pedido' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '🛍️ *NUEVO PEDIDO*\n\nEnvía el número de pedido:', { parse_mode: 'Markdown', reply_markup: getBotonesControl() });
    
  } else if (data === 'subir_review') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_review_link' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '⭐ *SUBIR REVIEW*\n\nEnvía el link de tu review:', { parse_mode: 'Markdown', reply_markup: getBotonesControl() });
    
  } else if (data === 'menu_principal') {
    limpiarEstadoUsuario(chatId);
    mostrarMenuPrincipal(chatId, esAdmin);
    
  } else if (data === 'reviews_pendientes' && esAdmin) {
    await mostrarReviewsPendientes(chatId);
    
  } else if (data === 'marcar_pagado' && esAdmin) {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_numero_pagar' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '💰 *MARCAR PAGADO*\n\nEnvía número de pedido:', { reply_markup: getBotonesControl() });
    
  } else if (data.startsWith('enviar_review_')) {
    await marcarReviewEnviada(chatId, data.replace('enviar_review_', ''));
    
  } else if (data.startsWith('confirmar_paypal_')) {
    await confirmarPedidoConPayPal(chatId, data.replace('confirmar_paypal_', ''));
    
  } else if (data === 'modificar_paypal') {
    userStates[chatId].step = 'awaiting_nuevo_paypal';
    bot.sendMessage(chatId, '💰 Envía tu nuevo PayPal:', { reply_markup: getBotonesControl() });
    
  } else if (data.startsWith('confirmar_review_')) {
    const s = userStates[chatId];
    if (s) {
      await procesarReviewSubida(chatId, s.numeroPedido, s.reviewLink, data.replace('confirmar_review_', ''), s.nick);
      limpiarEstadoUsuario(chatId);
    }
  } else if (data === 'modificar_paypal_review') {
    userStates[chatId].step = 'awaiting_paypal_review';
    bot.sendMessage(chatId, '💰 Envía tu nuevo PayPal:', { reply_markup: getBotonesControl() });
    
  } else if (data.startsWith('enviar_comprobante_')) {
    userStates[chatId] = { step: 'awaiting_comprobante_pago', numeroPedido: data.replace('enviar_comprobante_', '') };
    bot.sendMessage(chatId, '📸 Envía la captura del pago:', { reply_markup: getBotonesControl() });
    
  } else if (data.startsWith('no_comprobante_')) {
    await finalizarPagoSinComprobante(chatId, data.replace('no_comprobante_', ''));
  }
});

// Manejador de mensajes de texto e imágenes
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  if (text === '❌ CANCELAR') {
    limpiarEstadoUsuario(chatId);
    bot.sendMessage(chatId, '❌ Cancelado.', { reply_markup: { remove_keyboard: true } });
    setTimeout(() => mostrarMenuPrincipal(chatId, esAdmin), 500);
    return;
  }
  if (text === '🏠 MENÚ PRINCIPAL') {
    limpiarEstadoUsuario(chatId);
    mostrarMenuPrincipal(chatId, esAdmin);
    return;
  }
  
  const state = userStates[chatId];
  if (!state) return;
  establecerTimeout(chatId);
  
  try {
    // --- LÓGICA DE REGISTRO ---
    if (state.step === 'awaiting_perfil_amazon') {
      state.perfilAmazon = text;
      state.step = 'awaiting_paypal_registro';
      bot.sendMessage(chatId, '💰 Ahora envía tu PayPal:', { reply_markup: getBotonesControl() });
      
    } else if (state.step === 'awaiting_paypal_registro') {
      state.paypal = text;
      state.step = 'awaiting_intermediarios';
      bot.sendMessage(chatId, '🤝 Envía 2-3 intermediarios:', { reply_markup: getBotonesControl() });
      
    } else if (state.step === 'awaiting_intermediarios') {
      const sheetRegistro = doc.sheetsByIndex[0];
      await sheetRegistro.addRow({
        FECHA: new Date().toLocaleDateString('es-ES'),
        USUARIO: msg.from.username || msg.from.first_name,
        PERFIL: state.perfilAmazon,
        PAYPAL: state.paypal,
        INTERMEDIARIOS: text,
        CHAT_ID: chatId.toString()
      });
      registeredUsers.set(state.perfilAmazon.toLowerCase(), { perfil: state.perfilAmazon, paypal: state.paypal, usuario: msg.from.username });
      userChatIds.set(state.paypal, chatId);
      
      bot.sendMessage(chatId, '✅ Registro completado.', { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]] } });
      limpiarEstadoUsuario(chatId);
      
    // --- LÓGICA DE PEDIDO ---
    } else if (state.step === 'awaiting_numero_pedido') {
      state.numeroPedido = text;
      state.step = 'awaiting_captura';
      bot.sendMessage(chatId, '📸 Envía la captura del pedido:', { reply_markup: getBotonesControl() });
      
    } else if (state.step === 'awaiting_captura') {
      if (msg.photo || msg.document) {
        const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
        state.imagenUrl = `https://api.telegram.org/file/bot${token}/${fileId}`;
        state.fileId = fileId;
        state.tipoImagen = msg.photo ? 'photo' : 'document';
        state.nick = msg.from.username || msg.from.first_name;
        
        // Sugerir PayPal si existe
        const usuarioCache = Array.from(registeredUsers.values()).find(u => u.usuario?.toLowerCase() === state.nick?.toLowerCase());
        
        if (usuarioCache) {
          bot.sendMessage(chatId, `💰 ¿Es este tu PayPal: ${usuarioCache.paypal}?`, {
             reply_markup: { inline_keyboard: [[{ text: '✅ Sí', callback_data: `confirmar_paypal_${usuarioCache.paypal}` }, { text: '✏️ No', callback_data: 'modificar_paypal' }]] }
          });
        } else {
          state.step = 'awaiting_paypal_pedido';
          bot.sendMessage(chatId, '💰 Envía tu PayPal:', { reply_markup: getBotonesControl() });
        }
      } else {
        bot.sendMessage(chatId, '⚠️ Envía una imagen válida.');
      }
      
    } else if (state.step === 'awaiting_nuevo_paypal' || state.step === 'awaiting_paypal_pedido') {
      await confirmarPedidoConPayPal(chatId, text);
      
    // --- LÓGICA DE REVIEW ---
    } else if (state.step === 'awaiting_review_link') {
      state.reviewLink = text;
      state.step = 'awaiting_numero_review';
      bot.sendMessage(chatId, '🔢 Envía el número de pedido:', { reply_markup: getBotonesControl() });
      
    } else if (state.step === 'awaiting_numero_review') {
      state.numeroPedido = text;
      state.nick = msg.from.username || msg.from.first_name;
      const usuarioCache = Array.from(registeredUsers.values()).find(u => u.usuario?.toLowerCase() === state.nick?.toLowerCase());
      
      if (usuarioCache) {
         bot.sendMessage(chatId, `💰 ¿PayPal: ${usuarioCache.paypal}?`, {
             reply_markup: { inline_keyboard: [[{ text: '✅ Sí', callback_data: `confirmar_review_${usuarioCache.paypal}` }, { text: '✏️ No', callback_data: 'modificar_paypal_review' }]] }
          });
      } else {
        state.step = 'awaiting_paypal_review';
        bot.sendMessage(chatId, '💰 Envía tu PayPal:', { reply_markup: getBotonesControl() });
      }
      
    } else if (state.step === 'awaiting_paypal_review') {
      await procesarReviewSubida(chatId, state.numeroPedido, state.reviewLink, text, msg.from.username);
      limpiarEstadoUsuario(chatId);
      
    // --- LÓGICA ADMIN (PAGO) ---
    } else if (state.step === 'awaiting_numero_pagar') {
      const rows = await doc.sheetsByIndex[1].getRows();
      const row = rows.find(r => r.get('NUMERO') === text);
      if (row) {
        state.numeroPedido = text;
        state.paypalUsuario = row.get('PAYPAL');
        state.nickUsuario = row.get('NICK');
        bot.sendMessage(chatId, `Pedido: ${text}\nUsuario: ${state.nickUsuario}\nPayPal: ${state.paypalUsuario}\n\n¿Enviar comprobante?`, {
          reply_markup: { inline_keyboard: [
            [{ text: '📸 Sí', callback_data: `enviar_comprobante_${text}` }],
            [{ text: '❌ No, solo marcar', callback_data: `no_comprobante_${text}` }]
          ]}
        });
      } else {
        bot.sendMessage(chatId, '❌ Pedido no encontrado.');
      }
      
    } else if (state.step === 'awaiting_comprobante_pago') {
      if (msg.photo || msg.document) {
        const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
        await procesarComprobante(chatId, state.numeroPedido, fileId, msg.photo ? 'photo' : 'document', state.paypalUsuario, state.nickUsuario);
        limpiarEstadoUsuario(chatId);
      }
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, '❌ Error procesando solicitud.');
  }
});

// --- FUNCIONES AUXILIARES ---

async function confirmarPedidoConPayPal(chatId, paypal) {
  const state = userStates[chatId];
  if (!state) return;
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const userRow = (await sheetRegistro.getRows()).find(r => r.get('PAYPAL') === paypal);
    const perfil = userRow ? userRow.get('PERFIL') : 'N/A';
    
    const sheetPedidos = doc.sheetsByIndex[1];
    const newRow = await sheetPedidos.addRow({
      FECHA: new Date().toLocaleDateString('es-ES'),
      IMAGEN: state.imagenUrl,
      NUMERO: state.numeroPedido,
      PAYPAL: paypal,
      'PERFIL AMZ': perfil,
      NICK: state.nick,
      ESTADO: 'Pendiente'
    });
    
    await aplicarColorEstado(sheetPedidos, newRow.rowNumber, 'Pendiente');
    
    bot.sendMessage(chatId, `✅ Pedido registrado.\n#️⃣ ${state.numeroPedido}\n💰 ${paypal}`, { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'menu_principal' }]] } });
    limpiarEstadoUsuario(chatId);
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Error guardando pedido.');
  }
}

async function procesarReviewSubida(chatId, numero, review, paypal, nick) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const row = (await sheet.getRows()).find(r => r.get('NUMERO') === numero);
    
    if (row) {
      row.set('REVIEW', review);
      row.set('ESTADO', 'Review Subida');
      await row.save();
      await aplicarColorEstado(sheet, row.rowNumber, 'Review Subida');
      
      // Actualizar en vendedores
      for (const v of VENDEDORES) {
         try {
           const hv = doc.sheetsByTitle[v];
           if (hv) {
             const rv = (await hv.getRows()).find(r => r.get('NUMERO') === numero);
             if (rv) {
               rv.set('REVIEW', review);
               rv.set('ESTADO', 'Review Subida');
               await rv.save();
               await aplicarColorEstado(hv, rv.rowNumber, 'Review Subida');
             }
           }
         } catch (e) {}
      }
      
      bot.sendMessage(chatId, '✅ Review subida.', { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'menu_principal' }]] } });
      
      // Notificar Admin
      const msgAdmin = `🔔 REVIEW: ${numero}\nLink: ${review}\nPayPal: ${paypal}`;
      ADMIN_CHAT_IDS.forEach(id => bot.sendMessage(id, msgAdmin, { reply_markup: { inline_keyboard: [[{ text: '📤 Marcar Enviada', callback_data: `enviar_review_${numero}` }]] } }));
    } else {
      bot.sendMessage(chatId, '❌ Pedido no encontrado.');
    }
  } catch (e) { console.error(e); }
}

async function marcarReviewEnviada(chatId, numero) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const row = (await sheet.getRows()).find(r => r.get('NUMERO') === numero);
    if (row) {
      row.set('ESTADO', 'Review Enviada');
      await row.save();
      await aplicarColorEstado(sheet, row.rowNumber, 'Review Enviada');
      
      // Vendedores
       for (const v of VENDEDORES) {
         try {
           const hv = doc.sheetsByTitle[v];
           if (hv) {
             const rv = (await hv.getRows()).find(r => r.get('NUMERO') === numero);
             if (rv) {
               rv.set('ESTADO', 'Review Enviada');
               await rv.save();
               await aplicarColorEstado(hv, rv.rowNumber, 'Review Enviada');
             }
           }
         } catch (e) {}
      }
      
      bot.sendMessage(chatId, `✅ Review ${numero} marcada como Enviada.`, { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'menu_principal' }]] } });
    }
  } catch (e) { console.error(e); }
}

async function finalizarPagoSinComprobante(chatId, numero) {
  await actualizarPago(chatId, numero, null, null);
}

async function procesarComprobante(chatId, numero, fileId, tipo, paypal, nick) {
  await actualizarPago(chatId, numero, fileId, tipo, nick);
}

async function actualizarPago(chatId, numero, fileId, tipo, nick) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const row = (await sheet.getRows()).find(r => r.get('NUMERO') === numero);
    if (row) {
      row.set('ESTADO', 'Review Pagada');
      await row.save();
      await aplicarColorEstado(sheet, row.rowNumber, 'Review Pagada');
      
      // Vendedores
       for (const v of VENDEDORES) {
         try {
           const hv = doc.sheetsByTitle[v];
           if (hv) {
             const rv = (await hv.getRows()).find(r => r.get('NUMERO') === numero);
             if (rv) {
               rv.set('ESTADO', 'Review Pagada');
               await rv.save();
               await aplicarColorEstado(hv, rv.rowNumber, 'Review Pagada');
             }
           }
         } catch (e) {}
      }

      // Enviar al usuario
      const userChatId = userChatIds.get(row.get('PAYPAL'));
      if (userChatId && fileId) {
        const methods = { 'photo': 'sendPhoto', 'document': 'sendDocument' };
        await bot[methods[tipo]](userChatId, fileId, { caption: `💰 Pedido ${numero} PAGADO.` });
      }
      
      bot.sendMessage(chatId, `✅ Pedido ${numero} marcado como PAGADO.`, { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'menu_principal' }]] } });
    }
  } catch (e) { console.error(e); }
}

async function mostrarReviewsPendientes(chatId) {
  const rows = await doc.sheetsByIndex[1].getRows();
  const pendientes = rows.filter(r => r.get('ESTADO') === 'Review Subida');
  
  if (pendientes.length === 0) {
    return bot.sendMessage(chatId, '✅ No hay reviews pendientes.', { reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'menu_principal' }]] } });
  }
  
  let msg = `🔔 *PENDIENTES* (${pendientes.length})\n\n`;
  const botones = [];
  pendientes.forEach(r => {
    msg += `#️⃣ ${r.get('NUMERO')} - 👤 ${r.get('NICK')}\n`;
    botones.push([{ text: `📤 Enviar ${r.get('NUMERO')}`, callback_data: `enviar_review_${r.get('NUMERO')}` }]);
  });
  botones.push([{ text: '🏠 Menú', callback_data: 'menu_principal' }]);
  
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: botones } });
}

// Servidor
app.get('/', (req, res) => res.send('Bot AmazonFlow Activo 2.0'));
app.listen(PORT, () => console.log(`Puerto ${PORT}`));

// Iniciar
initSheet();
