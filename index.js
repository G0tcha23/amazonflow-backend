require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// Configuración
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 10000;

// IDs de administradores
const ADMIN_CHAT_IDS = [8167109];

// Lista de vendedores
const VENDEDORES = [
  // Ejemplos (añade los tuyos):
  // 'Vendedor1',
  // 'Vendedor2',
];

// Autenticación Google Sheets
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
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

// Mapeo de estados a colores (TEXTO SIEMPRE NEGRO)
const ESTADOS_COLORES = {
  'Pendiente': {
    bg: { red: 1, green: 1, blue: 1 },
    text: { red: 0, green: 0, blue: 0 },
    emoji: '⚪'
  },
  'Review Subida': {
    bg: { red: 1, green: 0.647, blue: 0 },
    text: { red: 0, green: 0, blue: 0 },
    emoji: '🟠'
  },
  'Review Enviada': {
    bg: { red: 0.682, green: 0.851, blue: 0.902 },
    text: { red: 0, green: 0, blue: 0 },
    emoji: '💙'
  },
  'Review Pagada': {
    bg: { red: 0.259, green: 0.522, blue: 0.957 },
    text: { red: 0, green: 0, blue: 0 },
    emoji: '🔵'
  },
  'Completado': {
    bg: { red: 1, green: 1, blue: 0 },
    text: { red: 0, green: 0, blue: 0 },
    emoji: '🟡'
  }
};

// Inicializar Google Sheets
async function initSheet() {
  try {
    await doc.loadInfo();
    console.log('✅ Autenticación con Google exitosa');
    console.log('📊 Documento:', doc.title);
    
    const sheet = doc.sheetsByIndex[1];
    if (!sheet) {
      throw new Error('No se encuentra la Hoja 2 (Pedidos)');
    }
    
    console.log('📄 Hoja 2 encontrada:', sheet.title);
    await sheet.loadHeaderRow();
    
    // Verificar y crear columna PAGADO en Hoja 2
    if (!sheet.headerValues.includes('PAGADO')) {
      console.log('➕ Añadiendo columna PAGADO a Hoja 2...');
      await añadirColumnaPagado(sheet);
    }
    
    console.log('✅ Encabezados Hoja 2:', sheet.headerValues);
    
    await formatearEncabezados();
    
    if (VENDEDORES.length > 0) {
      await crearHojasVendedores();
    } else {
      console.log('ℹ️ No hay vendedores configurados (array vacío)');
    }
    
    // Cargar usuarios registrados en cache
    await cargarUsuariosRegistrados();
    
    // Iniciar sincronización periódica de colores amarillos (cada 30 segundos)
    iniciarSincronizacionColores();
    
    console.log('🤖 Bot iniciado exitosamente');
  } catch (error) {
    console.error('❌ Error al iniciar:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Cargar usuarios registrados en memoria
async function cargarUsuariosRegistrados() {
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const rows = await sheetRegistro.getRows();
    
    registeredUsers.clear();
    userChatIds.clear();
    
    for (const row of rows) {
      const perfil = row.get('PERFIL');
      const paypal = row.get('PAYPAL');
      const usuario = row.get('USUARIO');
      const chatId = row.get('CHAT_ID');
      
      if (perfil && paypal) {
        registeredUsers.set(perfil.toLowerCase(), {
          perfil: perfil,
          paypal: paypal,
          usuario: usuario
        });
        
        if (chatId && paypal) {
          userChatIds.set(paypal, parseInt(chatId));
        }
      }
    }
    
    console.log(`✅ Cargados ${registeredUsers.size} usuarios registrados en cache`);
    console.log(`✅ Cargados ${userChatIds.size} chat_ids de usuarios`);
  } catch (error) {
    console.error('❌ Error cargando usuarios:', error);
  }
}

// Buscar PayPal por perfil Amazon
function buscarPayPalPorPerfil(perfilAmazon) {
  const userData = registeredUsers.get(perfilAmazon.toLowerCase());
  return userData ? userData.paypal : null;
}

// Añadir columna PAGADO
async function añadirColumnaPagado(sheet) {
  try {
    await sheet.setHeaderRow([
      'FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 
      'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'
    ]);
    console.log('✅ Columna PAGADO añadida');
  } catch (error) {
    console.error('❌ Error añadiendo columna PAGADO:', error);
  }
}

// Formatear encabezados con estilo
async function formatearEncabezados() {
  const sheet = doc.sheetsByIndex[1];
  await sheet.loadCells('A1:M1');
  
  for (let i = 0; i < 13; i++) {
    const cell = sheet.getCell(0, i);
    cell.textFormat = { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } };
    cell.backgroundColor = { red: 0.1, green: 0.137, blue: 0.494 };
    cell.horizontalAlignment = 'CENTER';
  }
  
  await sheet.saveUpdatedCells();
}

// Crear hojas automáticas por vendedor
async function crearHojasVendedores() {
  for (const vendedor of VENDEDORES) {
    try {
      let hojaVendedor = doc.sheetsByTitle[vendedor];
      if (!hojaVendedor) {
        hojaVendedor = await doc.addSheet({ title: vendedor });
        console.log(`✨ Hoja creada: ${vendedor}`);
      }
      
      await hojaVendedor.setHeaderRow([
        'FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 
        'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'
      ]);
      
      await formatearEncabezadosVendedor(hojaVendedor);
      console.log(`✅ Hoja ${vendedor} actualizada con columna PAGADO`);
      
    } catch (error) {
      console.error(`Error con hoja ${vendedor}:`, error.message);
    }
  }
}

// Formatear encabezados de hojas de vendedores
async function formatearEncabezadosVendedor(sheet) {
  await sheet.loadCells('A1:M1');
  
  for (let i = 0; i < 13; i++) {
    const cell = sheet.getCell(0, i);
    cell.textFormat = { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } };
    cell.backgroundColor = { red: 0.1, green: 0.137, blue: 0.494 };
    cell.horizontalAlignment = 'CENTER';
  }
  
  await sheet.saveUpdatedCells();
}

// FUNCIÓN CRÍTICA: Aplicar color con texto SIEMPRE negro
async function aplicarColorEstado(sheet, rowIndex, estado) {
  try {
    const colorConfig = ESTADOS_COLORES[estado];
    if (!colorConfig) {
      console.error(`Estado desconocido: ${estado}`);
      return;
    }
    
    await sheet.loadCells(`A${rowIndex}:M${rowIndex}`);
    
    // FORZAR color de fondo Y texto negro en TODAS las celdas
    for (let i = 0; i < 13; i++) {
      const cell = sheet.getCell(rowIndex - 1, i);
      
      // Aplicar color de fondo
      cell.backgroundColor = colorConfig.bg;
      
      // CRÍTICO: SIEMPRE forzar texto negro
      cell.textFormat = cell.textFormat || {};
      cell.textFormat.foregroundColor = { red: 0, green: 0, blue: 0 };
    }
    
    await sheet.saveUpdatedCells();
    console.log(`🎨 Color aplicado en ${sheet.title}, fila ${rowIndex}: ${estado} ${colorConfig.emoji} [TEXTO NEGRO]`);
  } catch (error) {
    console.error(`❌ Error aplicando color en fila ${rowIndex}:`, error.message);
  }
}

// FUNCIÓN NUEVA: Aplicar color personalizado (amarillo u otro) con texto negro
async function aplicarColorPersonalizado(sheet, rowIndex, bgColor) {
  try {
    await sheet.loadCells(`A${rowIndex}:M${rowIndex}`);
    
    for (let i = 0; i < 13; i++) {
      const cell = sheet.getCell(rowIndex - 1, i);
      
      // Aplicar color de fondo personalizado
      cell.backgroundColor = bgColor;
      
      // CRÍTICO: SIEMPRE texto negro
      cell.textFormat = cell.textFormat || {};
      cell.textFormat.foregroundColor = { red: 0, green: 0, blue: 0 };
    }
    
    await sheet.saveUpdatedCells();
    console.log(`🎨 Color personalizado aplicado en ${sheet.title}, fila ${rowIndex} [TEXTO NEGRO]`);
  } catch (error) {
    console.error(`❌ Error aplicando color personalizado:`, error.message);
  }
}

// Detectar si una celda es amarilla
function esColorAmarillo(bgColor) {
  if (!bgColor) return false;
  // Amarillo: rojo alto, verde alto, azul bajo
  return bgColor.red > 0.9 && bgColor.green > 0.9 && bgColor.blue < 0.3;
}

// FUNCIÓN PRINCIPAL: Sincronizar colores de vendedores a Hoja 2
async function sincronizarColoresVendedores() {
  try {
    const sheetPrincipal = doc.sheetsByIndex[1];
    if (!sheetPrincipal) {
      console.error('❌ No se encontró Hoja 2');
      return;
    }
    
    const rowsPrincipal = await sheetPrincipal.getRows();
    
    // Recorrer cada hoja de vendedor
    for (const vendedor of VENDEDORES) {
      try {
        const hojaVendedor = doc.sheetsByTitle[vendedor];
        if (!hojaVendedor) continue;
        
        const rowsVendedor = await hojaVendedor.getRows();
        
        for (const rowVendedor of rowsVendedor) {
          const numero = rowVendedor.get('NUMERO');
          if (!numero) continue;
          
          // Cargar celdas de la fila en hoja vendedor
          const filaVendedor = rowVendedor.rowNumber;
          await hojaVendedor.loadCells(`A${filaVendedor}:M${filaVendedor}`);
          
          // Verificar el color de la primera celda (columna A)
          const primeracelda = hojaVendedor.getCell(filaVendedor - 1, 0);
          const colorVendedor = primeracelda.backgroundColor;
          
          // Si hay algún color aplicado en la hoja del vendedor
          if (colorVendedor) {
            // Buscar la fila correspondiente en Hoja 2
            const rowPrincipal = rowsPrincipal.find(r => r.get('NUMERO') === numero);
            
            if (rowPrincipal) {
              const filaPrincipal = rowPrincipal.rowNumber;
              await sheetPrincipal.loadCells(`A${filaPrincipal}:M${filaPrincipal}`);
              
              // Verificar si Hoja 2 ya tiene el mismo color
              const celdaPrincipal = sheetPrincipal.getCell(filaPrincipal - 1, 0);
              const colorActualPrincipal = celdaPrincipal.backgroundColor;
              
              // Comparar colores (con tolerancia de 0.05)
              const colorDiferente = !colorActualPrincipal ||
                Math.abs((colorVendedor.red || 0) - (colorActualPrincipal.red || 0)) > 0.05 ||
                Math.abs((colorVendedor.green || 0) - (colorActualPrincipal.green || 0)) > 0.05 ||
                Math.abs((colorVendedor.blue || 0) - (colorActualPrincipal.blue || 0)) > 0.05;
              
              if (colorDiferente) {
                console.log(`🔄 Sincronizando color de ${vendedor} a Hoja 2: ${numero}`);
                
                // Copiar el color exacto de la hoja del vendedor a Hoja 2
                await aplicarColorPersonalizado(sheetPrincipal, filaPrincipal, colorVendedor);
                
                // Detectar si es amarillo para actualizar estado
                if (esColorAmarillo(colorVendedor)) {
                  const estadoActual = rowPrincipal.get('ESTADO');
                  if (estadoActual !== 'Completado') {
                    rowPrincipal.set('ESTADO', 'Completado');
                    rowPrincipal.set('PAGADO', 'PAGADO');
                    await rowPrincipal.save();
                    console.log(`🟡 Estado actualizado a Completado: ${numero}`);
                  }
                }
                
                console.log(`✅ Color sincronizado en Hoja 2: ${numero}`);
              }
            }
          }
        }
      } catch (vendorError) {
        console.error(`❌ Error procesando ${vendedor}:`, vendorError.message);
      }
    }
  } catch (error) {
    console.error('❌ Error en sincronizarColoresVendedores:', error.message);
  }
}

// Iniciar sincronización automática
function iniciarSincronizacionColores() {
  console.log('🔄 Sincronización de colores iniciada (cada 30 segundos)');
  
  setInterval(async () => {
    await sincronizarColoresVendedores();
  }, 30000);
}

// Limpiar estado del usuario
function limpiarEstadoUsuario(chatId) {
  delete userStates[chatId];
  if (userTimeouts[chatId]) {
    clearTimeout(userTimeouts[chatId]);
    delete userTimeouts[chatId];
  }
}

// Establecer timeout para estado
function establecerTimeout(chatId) {
  if (userTimeouts[chatId]) {
    clearTimeout(userTimeouts[chatId]);
  }
  
  userTimeouts[chatId] = setTimeout(() => {
    if (userStates[chatId]) {
      delete userStates[chatId];
      bot.sendMessage(chatId, '⏱️ Sesión expirada por inactividad.\n\nUsa /start para comenzar de nuevo.');
    }
    delete userTimeouts[chatId];
  }, 5 * 60 * 1000);
}

// Botones de control
function getBotonesControl() {
  return {
    keyboard: [
      [{ text: '❌ CANCELAR' }, { text: '🏠 MENÚ PRINCIPAL' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

// Remover teclado personalizado
function removerTeclado() {
  return { remove_keyboard: true };
}

// Menú principal
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
  
  bot.sendMessage(chatId, '¡Hola! 👋\n\nBienvenido al bot de gestión de pedidos de Amazon.\n\nSelecciona una opción:', {
    reply_markup: { 
      inline_keyboard: opciones,
      remove_keyboard: true
    }
  });
}

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  limpiarEstadoUsuario(chatId);
  
  // Guardar o actualizar chat_id cuando el usuario inicia el bot
  if (msg.from.username) {
    cargarYActualizarChatId(msg.from.username, chatId);
  }
  
  if (esAdmin) {
    console.log('👑 Admin conectado:', chatId);
  }
  
  mostrarMenuPrincipal(chatId, esAdmin);
});

// Actualizar chat_id en cache cuando usuario usa el bot
async function cargarYActualizarChatId(username, chatId) {
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const rows = await sheetRegistro.getRows();
    
    for (const row of rows) {
      const usuario = row.get('USUARIO');
      const paypal = row.get('PAYPAL');
      
      if (usuario && usuario.toLowerCase() === username.toLowerCase()) {
        // Actualizar en Google Sheets
        row.set('CHAT_ID', chatId.toString());
        await row.save();
        
        // Actualizar en cache
        if (paypal) {
          userChatIds.set(paypal, chatId);
          console.log(`✅ Chat ID actualizado para ${username}: ${chatId}`);
        }
        break;
      }
    }
  } catch (error) {
    console.error('Error actualizando chat_id:', error);
  }
}

// Comando /cancelar
bot.onText(/\/cancelar/, (msg) => {
  const chatId = msg.chat.id;
  limpiarEstadoUsuario(chatId);
  bot.sendMessage(chatId, '❌ Operación cancelada.\n\nUsa /start para comenzar de nuevo.', {
    reply_markup: removerTeclado()
  });
});

// Callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  bot.answerCallbackQuery(query.id);
  
  if (data === 'registrarse') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_perfil_amazon' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '📝 *REGISTRO*\n\nEnvía tu perfil de Amazon:', { 
      parse_mode: 'Markdown',
      reply_markup: getBotonesControl()
    });
    
  } else if (data === 'hacer_pedido') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_numero_pedido' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '🛍️ *NUEVO PEDIDO*\n\nEnvía el número de pedido:', { 
      parse_mode: 'Markdown',
      reply_markup: getBotonesControl()
    });
    
  } else if (data === 'subir_review') {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_review_link' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '⭐ *SUBIR REVIEW*\n\nEnvía el link de tu review:', { 
      parse_mode: 'Markdown',
      reply_markup: getBotonesControl()
    });
    
  } else if (data === 'reviews_pendientes' && esAdmin) {
    await mostrarReviewsPendientes(chatId);
    
  } else if (data === 'marcar_pagado' && esAdmin) {
    limpiarEstadoUsuario(chatId);
    userStates[chatId] = { step: 'awaiting_numero_pagar' };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '💰 *MARCAR COMO PAGADO*\n\nEnvía el número de pedido:', { 
      parse_mode: 'Markdown',
      reply_markup: getBotonesControl()
    });
    
  } else if (data.startsWith('enviar_review_')) {
    const numeroPedido = data.replace('enviar_review_', '');
    await marcarReviewEnviada(chatId, numeroPedido);
    
  } else if (data === 'menu_principal') {
    limpiarEstadoUsuario(chatId);
    mostrarMenuPrincipal(chatId, esAdmin);
    
  } else if (data.startsWith('confirmar_review_')) {
    const paypal = data.replace('confirmar_review_', '');
    const state = userStates[chatId];
    if (state) {
      await procesarReviewSubida(chatId, state.numeroPedido, state.reviewLink, paypal, state.nick);
      limpiarEstadoUsuario(chatId);
    }
    
  } else if (data === 'modificar_paypal_review') {
    const state = userStates[chatId];
    if (state) {
      state.step = 'awaiting_paypal_review';
      bot.sendMessage(chatId, '💰 Envía tu nuevo PayPal:', {
        reply_markup: getBotonesControl()
      });
    }
    
  } else if (data.startsWith('confirmar_paypal_')) {
    const paypal = data.replace('confirmar_paypal_', '');
    await confirmarPedidoConPayPal(chatId, paypal);
    
  } else if (data === 'modificar_paypal') {
    const state = userStates[chatId];
    if (state) {
      state.step = 'awaiting_nuevo_paypal';
      bot.sendMessage(chatId, '💰 Envía tu nuevo PayPal:', {
        reply_markup: getBotonesControl()
      });
    }
    
  } else if (data.startsWith('enviar_comprobante_')) {
    const numeroPedido = data.replace('enviar_comprobante_', '');
    userStates[chatId] = { 
      step: 'awaiting_comprobante_pago',
      numeroPedido: numeroPedido
    };
    establecerTimeout(chatId);
    bot.sendMessage(chatId, '📸 *ENVIAR COMPROBANTE*\n\nEnvía la captura del pago realizado:', {
      parse_mode: 'Markdown',
      reply_markup: getBotonesControl()
    });
    
  } else if (data.startsWith('no_comprobante_')) {
    const numeroPedido = data.replace('no_comprobante_', '');
    await finalizarPagoSinComprobante(chatId, numeroPedido);
  }
});

// Confirmar pedido con PayPal existente
async function confirmarPedidoConPayPal(chatId, paypal) {
  const state = userStates[chatId];
  if (!state) return;
  
  try {
    const sheetRegistro = doc.sheetsByIndex[0];
    const rowsRegistro = await sheetRegistro.getRows();
    const userRegistro = rowsRegistro.find(r => r.get('PAYPAL') === paypal);
    const perfilAmz = userRegistro ? userRegistro.get('PERFIL') : 'N/A';
    
    const sheetPedidos = doc.sheetsByIndex[1];
    const newRow = await sheetPedidos.addRow({
      FECHA: new Date().toLocaleDateString('es-ES'),
      ARTICULO: '',
      IMAGEN: state.imagenUrl,
      DESCRIPCION: '',
      NUMERO: state.numeroPedido,
      PAYPAL: paypal,
      'PERFIL AMZ': perfilAmz,
      REVIEW: '',
      NICK: state.nick,
      COMISION: '',
      ESTADO: 'Pendiente',
      VENDEDOR: '',
      PAGADO: ''
    });
    
    // Aplicar color blanco (Pendiente) con texto negro
    await aplicarColorEstado(sheetPedidos, newRow.rowNumber, 'Pendiente');
    
    try {
      if (state.tipoImagen === 'photo' || state.tipoImagen === 'document') {
        await bot.sendPhoto(chatId, state.fileId, {
          caption: '✅ Imagen guardada correctamente',
          reply_markup: removerTeclado()
        });
      }
    } catch (error) {
      console.log('Error al reenviar imagen (no crítico)');
    }
    
    const resumen = `📦 *PEDIDO REGISTRADO*\n\n` +
      `🔢 Número: ${state.numeroPedido}\n` +
      `💰 PayPal: ${paypal}\n` +
      `📸 Imagen: Guardada\n\n` +
      `✅ Pedido guardado correctamente`;
    
    bot.sendMessage(chatId, resumen, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
      }
    });
    
    limpiarEstadoUsuario(chatId);
    
  } catch (error) {
    console.error('❌ Error al confirmar pedido:', error);
    bot.sendMessage(chatId, '❌ Error al guardar el pedido.', {
      reply_markup: getBotonesControl()
    });
  }
}

// Finalizar pago sin comprobante
async function finalizarPagoSinComprobante(chatId, numeroPedido) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('NUMERO') === numeroPedido);
    
    if (!row) {
      bot.sendMessage(chatId, '❌ No se encontró el pedido.');
      return;
    }
    
    // Actualizar estado
    row.set('ESTADO', 'Review Pagada');
    await row.save();
    
    // Aplicar color azul oscuro con texto negro
    await aplicarColorEstado(sheet, row.rowNumber, 'Review Pagada');
    
    // Sincronizar con hojas de vendedores
    for (const vendedor of VENDEDORES) {
      const hojaVendedor = doc.sheetsByTitle[vendedor];
      if (hojaVendedor) {
        const rowsVendedor = await hojaVendedor.getRows();
        const rowVendedor = rowsVendedor.find(r => r.get('NUMERO') === numeroPedido);
        
        if (rowVendedor) {
          rowVendedor.set('ESTADO', 'Review Pagada');
          await rowVendedor.save();
          await aplicarColorEstado(hojaVendedor, rowVendedor.rowNumber, 'Review Pagada');
        }
      }
    }
    
    bot.sendMessage(chatId, `✅ Pedido *${numeroPedido}* marcado como pagado (sin comprobante).\n\n🔵 Cambió a color azul oscuro.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
      }
    });
    
    limpiarEstadoUsuario(chatId);
    
  } catch (error) {
    console.error('❌ Error finalizando pago:', error);
    bot.sendMessage(chatId, '❌ Error al procesar el pago.');
  }
}

// Mostrar reviews pendientes
async function mostrarReviewsPendientes(chatId) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const rows = await sheet.getRows();
    
    if (!rows || rows.length === 0) {
      bot.sendMessage(chatId, '✅ No hay reviews pendientes de enviar al seller.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
        }
      });
      return;
    }
    
    const reviewsPendientes = rows.filter(row => {
      const estado = row.get('ESTADO');
      return estado && estado.trim() === 'Review Subida';
    });
    
    if (reviewsPendientes.length === 0) {
      bot.sendMessage(chatId, '✅ No hay reviews pendientes de enviar al seller.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
        }
      });
      return;
    }
    
    let mensaje = `🔔 *REVIEWS PENDIENTES DE ENVIAR* (${reviewsPendientes.length})\n\n`;
    const botones = [];
    
    reviewsPendientes.forEach((row, index) => {
      const numero = row.get('NUMERO') || 'N/A';
      const review = row.get('REVIEW') || 'N/A';
      const nick = row.get('NICK') || 'N/A';
      const paypal = row.get('PAYPAL') || 'N/A';
      
      mensaje += `${index + 1}️⃣ *Pedido:* ${numero}\n`;
      mensaje += `   👤 Usuario: ${nick}\n`;
      mensaje += `   ⭐ Review: ${review}\n`;
      mensaje += `   💰 PayPal: ${paypal}\n\n`;
      
      botones.push([{ text: `📤 Enviar #${numero}`, callback_data: `enviar_review_${numero}` }]);
    });
    
    botones.push([{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]);
    
    bot.sendMessage(chatId, mensaje, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: botones }
    });
    
  } catch (error) {
    console.error('❌ Error en mostrarReviewsPendientes:', error);
    bot.sendMessage(chatId, '❌ Error al obtener reviews pendientes: ' + error.message);
  }
}

// Procesar review subida
async function procesarReviewSubida(chatId, numeroPedido, reviewLink, paypal, nick) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('NUMERO') === numeroPedido && r.get('PAYPAL') === paypal);
    
    if (row) {
      row.set('REVIEW', reviewLink);
      row.set('ESTADO', 'Review Subida');
      await row.save();
      
      await aplicarColorEstado(sheet, row.rowNumber, 'Review Subida');
      
      // Sincronizar con hojas de vendedores
      for (const vendedor of VENDEDORES) {
        const hojaVendedor = doc.sheetsByTitle[vendedor];
        if (hojaVendedor) {
          const rowsVendedor = await hojaVendedor.getRows();
          const rowVendedor = rowsVendedor.find(r => r.get('NUMERO') === numeroPedido);
          
          if (rowVendedor) {
            rowVendedor.set('REVIEW', reviewLink);
            rowVendedor.set('ESTADO', 'Review Subida');
            await rowVendedor.save();
            await aplicarColorEstado(hojaVendedor, rowVendedor.rowNumber, 'Review Subida');
          }
        }
      }
      
      bot.sendMessage(chatId, '✅ Review subida correctamente.\n\nTu pedido está siendo procesado.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
        }
      });
      
      await notificarNuevaReview({
        numero: numeroPedido,
        review: reviewLink,
        paypal: paypal,
        nick: nick
      });
      
    } else {
      bot.sendMessage(chatId, '❌ No se encontró el pedido.', {
        reply_markup: getBotonesControl()
      });
    }
  } catch (error) {
    console.error('Error procesando review:', error);
    bot.sendMessage(chatId, '❌ Error al procesar la review.');
  }
}

// Marcar review como enviada al seller
async function marcarReviewEnviada(chatId, numeroPedido) {
  try {
    const sheet = doc.sheetsByIndex[1];
    const rows = await sheet.getRows();
    
    const row = rows.find(r => r.get('NUMERO') === numeroPedido);
    
    if (!row) {
      bot.sendMessage(chatId, '❌ No se encontró el pedido.');
      return;
    }
    
    row.set('ESTADO', 'Review Enviada');
    await row.save();
    
    const rowIndex = row.rowNumber;
    await aplicarColorEstado(sheet, rowIndex, 'Review Enviada');
    
    // Sincronizar con hojas de vendedores
    for (const vendedor of VENDEDORES) {
      const hojaVendedor = doc.sheetsByTitle[vendedor];
      if (hojaVendedor) {
        const rowsVendedor = await hojaVendedor.getRows();
        const rowVendedor = rowsVendedor.find(r => r.get('NUMERO') === numeroPedido);
        
        if (rowVendedor) {
          rowVendedor.set('ESTADO', 'Review Enviada');
          await rowVendedor.save();
          await aplicarColorEstado(hojaVendedor, rowVendedor.rowNumber, 'Review Enviada');
        }
      }
    }
    
    bot.sendMessage(chatId, `✅ Review del pedido *${numeroPedido}* marcada como enviada al seller.\n\n💙 Cambió a color azul celeste.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔔 Ver Pendientes', callback_data: 'reviews_pendientes' }],
          [{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]
        ]
      }
    });
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error al actualizar el estado.');
    console.error(error);
  }
}

// Notificar admins sobre nueva review
async function notificarNuevaReview(datosReview) {
  const mensaje = `🔔 *NUEVA REVIEW RECIBIDA*\n\n` +
    `📦 *Pedido:* ${datosReview.numero}\n` +
    `⭐ *Review:* ${datosReview.review}\n` +
    `💰 *PayPal:* ${datosReview.paypal}\n` +
    `👤 *Usuario:* ${datosReview.nick}\n\n` +
    `⚠️ *Pendiente de enviar al seller*`;
  
  for (const adminId of ADMIN_CHAT_IDS) {
    bot.sendMessage(adminId, mensaje, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Marcar como Enviada', callback_data: `enviar_review_${datosReview.numero}` }],
          [{ text: '🔔 Ver Todas Pendientes', callback_data: 'reviews_pendientes' }]
        ]
      }
    });
  }
}

// Manejador de mensajes
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const esAdmin = ADMIN_CHAT_IDS.includes(chatId);
  
  if (text === '❌ CANCELAR') {
    limpiarEstadoUsuario(chatId);
    bot.sendMessage(chatId, '❌ Operación cancelada.', {
      reply_markup: removerTeclado()
    });
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
    // REGISTRO
    if (state.step === 'awaiting_perfil_amazon') {
      state.perfilAmazon = text;
      state.step = 'awaiting_paypal_registro';
      bot.sendMessage(chatId, '💰 Ahora envía tu PayPal:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_paypal_registro') {
      state.paypal = text;
      state.step = 'awaiting_intermediarios';
      bot.sendMessage(chatId, '🤝 Envía 2-3 intermediarios con los que trabajas:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_intermediarios') {
      const intermediarios = text;
      
      const sheetRegistro = doc.sheetsByIndex[0];
      await sheetRegistro.addRow({
        FECHA: new Date().toLocaleDateString('es-ES'),
        USUARIO: msg.from.username || msg.from.first_name,
        PERFIL: state.perfilAmazon,
        PAYPAL: state.paypal,
        INTERMEDIARIOS: intermediarios,
        CHAT_ID: chatId.toString()
      });
      
      // Actualizar cache
      registeredUsers.set(state.perfilAmazon.toLowerCase(), {
        perfil: state.perfilAmazon,
        paypal: state.paypal,
        usuario: msg.from.username || msg.from.first_name
      });
      
      // Guardar chat_id
      userChatIds.set(state.paypal, chatId);
      
      bot.sendMessage(chatId, '✅ Registro completado correctamente.\n\nYa puedes hacer pedidos.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
        }
      });
      
      limpiarEstadoUsuario(chatId);
      
    // HACER PEDIDO
    } else if (state.step === 'awaiting_numero_pedido') {
      state.numeroPedido = text;
      state.step = 'awaiting_captura';
      bot.sendMessage(chatId, '📸 Envía la captura del pedido:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_captura') {
      let fileId = null;
      let imagenUrl = null;
      let tipoImagen = null;
      
      if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        tipoImagen = 'photo';
      } else if (msg.document) {
        const mimeType = msg.document.mime_type || '';
        const fileName = msg.document.file_name || '';
        
        const esImagen = mimeType.startsWith('image/') || 
                        /\.(jpg|jpeg|png|gif|bmp|webp|heic|heif|tiff)$/i.test(fileName);
        
        if (esImagen) {
          fileId = msg.document.file_id;
          tipoImagen = 'document';
        }
      } else if (msg.sticker) {
        fileId = msg.sticker.file_id;
        tipoImagen = 'sticker';
      }
      
      if (fileId) {
        imagenUrl = `https://api.telegram.org/file/bot${token}/${fileId}`;
        state.imagenUrl = imagenUrl;
        state.fileId = fileId;
        state.tipoImagen = tipoImagen;
        state.nick = msg.from.username || msg.from.first_name;
        
        // Buscar PayPal del usuario registrado
        const sheetRegistro = doc.sheetsByIndex[0];
        const rowsRegistro = await sheetRegistro.getRows();
        const userRegistro = rowsRegistro.find(r => {
          const usuario = r.get('USUARIO');
          return usuario && usuario.toLowerCase() === state.nick.toLowerCase();
        });
        
        if (userRegistro && userRegistro.get('PAYPAL')) {
          const paypalRegistrado = userRegistro.get('PAYPAL');
          state.paypalSugerido = paypalRegistrado;
          
          bot.sendMessage(chatId, `✅ Imagen recibida correctamente\n\n💰 ¿Es este tu PayPal?\n\n*${paypalRegistrado}*`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Sí, es correcto', callback_data: `confirmar_paypal_${paypalRegistrado}` },
                  { text: '✏️ Modificar', callback_data: 'modificar_paypal' }
                ],
                [{ text: '❌ Cancelar', callback_data: 'menu_principal' }]
              ]
            }
          });
        } else {
          state.step = 'awaiting_paypal_pedido';
          bot.sendMessage(chatId, `✅ Imagen recibida correctamente\n\n💰 Envía tu PayPal:`, {
            reply_markup: getBotonesControl()
          });
        }
      } else {
        bot.sendMessage(chatId, '⚠️ Por favor envía una imagen válida.', {
          reply_markup: getBotonesControl()
        });
      }
      
    } else if (state.step === 'awaiting_nuevo_paypal' || state.step === 'awaiting_paypal_pedido') {
      const paypal = text;
      await confirmarPedidoConPayPal(chatId, paypal);
      
    // SUBIR REVIEW
    } else if (state.step === 'awaiting_review_link') {
      state.reviewLink = text;
      state.step = 'awaiting_numero_review';
      bot.sendMessage(chatId, '🔢 Envía el número de pedido:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_numero_review') {
      state.numeroPedido = text;
      state.nick = msg.from.username || msg.from.first_name;
      
      // Buscar PayPal automáticamente
      const sheetRegistro = doc.sheetsByIndex[0];
      const rowsRegistro = await sheetRegistro.getRows();
      const userRegistro = rowsRegistro.find(r => {
        const usuario = r.get('USUARIO');
        return usuario && usuario.toLowerCase() === state.nick.toLowerCase();
      });
      
      if (userRegistro && userRegistro.get('PAYPAL')) {
        const paypalRegistrado = userRegistro.get('PAYPAL');
        state.paypalSugerido = paypalRegistrado;
        
        bot.sendMessage(chatId, `💰 ¿Es este tu PayPal?\n\n*${paypalRegistrado}*`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Sí, es correcto', callback_data: `confirmar_review_${paypalRegistrado}` },
                { text: '✏️ Modificar', callback_data: 'modificar_paypal_review' }
              ],
              [{ text: '❌ Cancelar', callback_data: 'menu_principal' }]
            ]
          }
        });
      } else {
        state.step = 'awaiting_paypal_review';
        bot.sendMessage(chatId, '💰 Envía tu PayPal:', {
          reply_markup: getBotonesControl()
        });
      }
      
    } else if (state.step === 'awaiting_paypal_review') {
      const paypal = text;
      await procesarReviewSubida(chatId, state.numeroPedido, state.reviewLink, paypal, msg.from.username || msg.from.first_name);
      limpiarEstadoUsuario(chatId);
      
    // MARCAR PAGADO (ADMIN)
    } else if (state.step === 'awaiting_numero_pagar') {
      const numeroPedido = text;
      
      const sheet = doc.sheetsByIndex[1];
      const rows = await sheet.getRows();
      const row = rows.find(r => r.get('NUMERO') === numeroPedido);
      
      if (row) {
        state.numeroPedido = numeroPedido;
        state.paypalUsuario = row.get('PAYPAL');
        state.nickUsuario = row.get('NICK');
        
        bot.sendMessage(chatId, `💰 *MARCAR COMO PAGADO*\n\nPedido: *${numeroPedido}*\nUsuario: ${state.nickUsuario}\nPayPal: ${state.paypalUsuario}\n\n¿Deseas enviar comprobante de pago?`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📸 Sí, enviar comprobante', callback_data: `enviar_comprobante_${numeroPedido}` }
              ],
              [
                { text: '❌ No, solo marcar pagado', callback_data: `no_comprobante_${numeroPedido}` }
              ],
              [{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]
            ]
          }
        });
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido.', {
          reply_markup: getBotonesControl()
        });
        limpiarEstadoUsuario(chatId);
      }
      
    // COMPROBANTE DE PAGO
    } else if (state.step === 'awaiting_comprobante_pago') {
      let fileId = null;
      let tipoArchivo = null;
      
      if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        tipoArchivo = 'photo';
      } else if (msg.document) {
        fileId = msg.document.file_id;
        tipoArchivo = 'document';
      }
      
      if (fileId) {
        try {
          // Actualizar estado en Google Sheets
          const sheet = doc.sheetsByIndex[1];
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('NUMERO') === state.numeroPedido);
          
          if (row) {
            row.set('ESTADO', 'Review Pagada');
            await row.save();
            
            // Aplicar color azul oscuro
            await aplicarColorEstado(sheet, row.rowNumber, 'Review Pagada');
            
            // Sincronizar con hojas de vendedores
            for (const vendedor of VENDEDORES) {
              const hojaVendedor = doc.sheetsByTitle[vendedor];
              if (hojaVendedor) {
                const rowsVendedor = await hojaVendedor.getRows();
                const rowVendedor = rowsVendedor.find(r => r.get('NUMERO') === state.numeroPedido);
                
                if (rowVendedor) {
                  rowVendedor.set('ESTADO', 'Review Pagada');
                  await rowVendedor.save();
                  await aplicarColorEstado(hojaVendedor, rowVendedor.rowNumber, 'Review Pagada');
                }
              }
            }
            
            // Buscar chat_id del usuario por su PayPal
            const userChatId = userChatIds.get(state.paypalUsuario);
            
            if (userChatId) {
              try {
                // Enviar comprobante al usuario
                const mensajeUsuario = `💰 *PEDIDO REEMBOLSADO*\n\n📦 Pedido: *${state.numeroPedido}*\n\n✅ Tu pago ha sido procesado.\n\nAquí está el comprobante:`;
                
                if (tipoArchivo === 'photo') {
                  await bot.sendPhoto(userChatId, fileId, {
                    caption: mensajeUsuario,
                    parse_mode: 'Markdown'
                  });
                } else {
                  await bot.sendDocument(userChatId, fileId, {
                    caption: mensajeUsuario,
                    parse_mode: 'Markdown'
                  });
                }
                
                bot.sendMessage(chatId, `✅ Pedido *${state.numeroPedido}* marcado como pagado.\n\n🔵 Cambió a color azul oscuro.\n\n📤 Comprobante enviado exitosamente a @${state.nickUsuario}`, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
                  }
                });
                
              } catch (error) {
                console.error('Error enviando al usuario:', error);
                bot.sendMessage(chatId, `✅ Pedido marcado como pagado.\n\n⚠️ No se pudo enviar automáticamente a @${state.nickUsuario}\n\nReenvía manualmente el comprobante.`, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
                  }
                });
              }
            } else {
              // Si no hay chat_id guardado
              if (tipoArchivo === 'photo') {
                await bot.sendPhoto(chatId, fileId, {
                  caption: `✅ Comprobante guardado.\n\n⚠️ Usuario no ha iniciado el bot.\nReenvía esta imagen manualmente a: @${state.nickUsuario}`
                });
              } else {
                await bot.sendDocument(chatId, fileId, {
                  caption: `✅ Comprobante guardado.\n\n⚠️ Usuario no ha iniciado el bot.\nReenvía este archivo manualmente a: @${state.nickUsuario}`
                });
              }
              
              bot.sendMessage(chatId, `✅ Pedido *${state.numeroPedido}* marcado como pagado.\n\n🔵 Cambió a color azul oscuro.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
                }
              });
            }
          }
          
          limpiarEstadoUsuario(chatId);
          
        } catch (error) {
          console.error('❌ Error procesando comprobante:', error);
          bot.sendMessage(chatId, '❌ Error al procesar el comprobante.');
        }
      } else {
        bot.sendMessage(chatId, '⚠️ Por favor envía una imagen o documento válido.', {
          reply_markup: getBotonesControl()
        });
      }
    }
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error al procesar tu solicitud.', {
      reply_markup: removerTeclado()
    });
    console.error('Error en manejador:', error);
    limpiarEstadoUsuario(chatId);
  }
});

// Servidor Express
app.get('/', (req, res) => {
  res.send('Bot AmazonFlow - Sincronización de colores completa');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
});

// Iniciar
console.log('🔍 Verificando conexión con Google Sheets...');
initSheet();
