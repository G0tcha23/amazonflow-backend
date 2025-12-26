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

// Lista de vendedores (configura aquí tus vendedores reales)
const VENDEDORES = [
  // Ejemplos (elimina y añade los tuyos):
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

// Mapeo de estados a colores
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
    text: { red: 1, green: 1, blue: 1 },
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
    
    // Verificar si existe columna PAGADO, si no, crearla
    if (!sheet.headerValues.includes('PAGADO')) {
      console.log('➕ Añadiendo columna PAGADO...');
      await añadirColumnaPagado(sheet);
    }
    
    console.log('✅ Encabezados:', sheet.headerValues);
    
    await formatearEncabezados();
    
    if (VENDEDORES.length > 0) {
      await crearHojasVendedores();
    } else {
      console.log('ℹ️ No hay vendedores configurados (array vacío)');
    }
    
    // Iniciar sincronización periódica (cada 30 segundos)
    iniciarSincronizacionPeriodica();
    
    console.log('🤖 Bot iniciado exitosamente');
  } catch (error) {
    console.error('❌ Error al iniciar:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Añadir columna PAGADO con validación de checkbox
async function añadirColumnaPagado(sheet) {
  try {
    // Actualizar encabezados manualmente
    await sheet.setHeaderRow([
      'FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 
      'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'
    ]);
    
    console.log('✅ Columna PAGADO añadida');
  } catch (error) {
    console.error('❌ Error añadiendo columna PAGADO:', error);
  }
}

// Formatear encabezados con estilo (ahora incluye PAGADO)
async function formatearEncabezados() {
  const sheet = doc.sheetsByIndex[1];
  await sheet.loadCells('A1:M1'); // Ahora son 13 columnas (A-M)
  
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
        await hojaVendedor.setHeaderRow([
          'FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 
          'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'
        ]);
        await formatearEncabezadosVendedor(hojaVendedor);
        console.log(`✨ Hoja creada: ${vendedor}`);
      } else {
        // Verificar si tiene columna PAGADO
        await hojaVendedor.loadHeaderRow();
        if (!hojaVendedor.headerValues.includes('PAGADO')) {
          await hojaVendedor.setHeaderRow([
            'FECHA', 'ARTICULO', 'IMAGEN', 'DESCRIPCION', 'NUMERO', 
            'PAYPAL', 'PERFIL AMZ', 'REVIEW', 'NICK', 'COMISION', 'ESTADO', 'VENDEDOR', 'PAGADO'
          ]);
          await formatearEncabezadosVendedor(hojaVendedor);
          console.log(`✅ Columna PAGADO añadida a hoja: ${vendedor}`);
        }
      }
    } catch (error) {
      console.error(`Error creando hoja ${vendedor}:`, error.message);
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

// Aplicar color según estado
async function aplicarColorEstado(sheet, rowIndex, estado) {
  const colorConfig = ESTADOS_COLORES[estado] || ESTADOS_COLORES['Pendiente'];
  
  await sheet.loadCells(`A${rowIndex}:M${rowIndex}`); // Ahora son 13 columnas
  
  for (let i = 0; i < 13; i++) {
    const cell = sheet.getCell(rowIndex - 1, i);
    cell.backgroundColor = colorConfig.bg;
    cell.textFormat = { foregroundColor: colorConfig.text };
  }
  
  await sheet.saveUpdatedCells();
}

// Sincronizar estado cuando checkbox PAGADO cambia
async function sincronizarCheckboxPagado(numeroPedido, estaMarcado, hojaOrigen) {
  try {
    const nuevoEstado = estaMarcado ? 'Completado' : 'Review Pagada';
    console.log(`🔄 Sincronizando checkbox PAGADO: ${numeroPedido} → ${estaMarcado ? 'Marcado' : 'Desmarcado'}`);
    
    // Actualizar Hoja 2 (si no es el origen)
    if (hojaOrigen !== 'Hoja 2') {
      const sheetPrincipal = doc.sheetsByIndex[1];
      const rows = await sheetPrincipal.getRows();
      const row = rows.find(r => r.get('NUMERO') === numeroPedido);
      
      if (row) {
        row.set('ESTADO', nuevoEstado);
        row.set('PAGADO', estaMarcado);
        await row.save();
        await aplicarColorEstado(sheetPrincipal, row.rowNumber, nuevoEstado);
        console.log(`✅ Hoja 2 sincronizada: ${numeroPedido} → ${nuevoEstado}`);
      }
    }
    
    // Actualizar hojas de vendedores (si no son el origen)
    if (VENDEDORES.length > 0) {
      for (const vendedor of VENDEDORES) {
        if (hojaOrigen === vendedor) continue;
        
        const hojaVendedor = doc.sheetsByTitle[vendedor];
        if (hojaVendedor) {
          const rows = await hojaVendedor.getRows();
          const row = rows.find(r => r.get('NUMERO') === numeroPedido);
          
          if (row) {
            row.set('ESTADO', nuevoEstado);
            row.set('PAGADO', estaMarcado);
            await row.save();
            await aplicarColorEstado(hojaVendedor, row.rowNumber, nuevoEstado);
            console.log(`✅ Hoja ${vendedor} sincronizada: ${numeroPedido} → ${nuevoEstado}`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error sincronizando checkbox PAGADO:', error);
  }
}

// Detectar cambios en checkbox PAGADO y sincronizar
async function detectarCambiosCheckbox() {
  try {
    // Verificar cambios en Hoja 2
    const sheetPrincipal = doc.sheetsByIndex[1];
    const rowsPrincipal = await sheetPrincipal.getRows();
    
    for (const row of rowsPrincipal) {
      const numero = row.get('NUMERO');
      const pagado = row.get('PAGADO');
      const estadoActual = row.get('ESTADO');
      
      if (!numero) continue;
      
      const deberiaSer = pagado === true || pagado === 'TRUE' || pagado === 'true';
      const estadoEsperado = deberiaSer ? 'Completado' : (estadoActual === 'Completado' ? 'Review Pagada' : estadoActual);
      
      // Si el checkbox cambió, sincronizar
      if ((deberiaSer && estadoActual !== 'Completado') || (!deberiaSer && estadoActual === 'Completado')) {
        console.log(`🔄 Cambio detectado en Hoja 2: ${numero} → Pagado: ${deberiaSer}`);
        await sincronizarCheckboxPagado(numero, deberiaSer, 'Hoja 2');
      }
    }
    
    // Verificar cambios en hojas de vendedores
    for (const vendedor of VENDEDORES) {
      const hojaVendedor = doc.sheetsByTitle[vendedor];
      if (hojaVendedor) {
        const rowsVendedor = await hojaVendedor.getRows();
        
        for (const rowVendedor of rowsVendedor) {
          const numero = rowVendedor.get('NUMERO');
          const pagadoVendedor = rowVendedor.get('PAGADO');
          const estadoVendedor = rowVendedor.get('ESTADO');
          
          if (!numero) continue;
          
          const deberiaSer = pagadoVendedor === true || pagadoVendedor === 'TRUE' || pagadoVendedor === 'true';
          const estadoEsperado = deberiaSer ? 'Completado' : (estadoVendedor === 'Completado' ? 'Review Pagada' : estadoVendedor);
          
          // Verificar si es diferente a Hoja 2
          const rowPrincipal = rowsPrincipal.find(r => r.get('NUMERO') === numero);
          if (rowPrincipal) {
            const pagadoPrincipal = rowPrincipal.get('PAGADO');
            const deberiaPrincipal = pagadoPrincipal === true || pagadoPrincipal === 'TRUE' || pagadoPrincipal === 'true';
            
            if (deberiaSer !== deberiaPrincipal) {
              console.log(`🔄 Cambio detectado en ${vendedor}: ${numero} → Pagado: ${deberiaSer}`);
              await sincronizarCheckboxPagado(numero, deberiaSer, vendedor);
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error detectando cambios en checkbox:', error);
  }
}

// Iniciar sincronización periódica (cada 30 segundos)
function iniciarSincronizacionPeriodica() {
  console.log('🔄 Sincronización automática iniciada (cada 30 segundos)');
  
  setInterval(async () => {
    await detectarCambiosCheckbox();
  }, 30000); // 30 segundos
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

// Botones de control (CANCELAR y MENÚ)
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
  
  if (esAdmin) {
    console.log('👑 Admin conectado:', chatId);
  }
  
  mostrarMenuPrincipal(chatId, esAdmin);
});

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
  }
});

// Mostrar reviews pendientes
async function mostrarReviewsPendientes(chatId) {
  console.log('🔍 Iniciando mostrarReviewsPendientes para chatId:', chatId);
  
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
    
    bot.sendMessage(chatId, `✅ Review del pedido *${numeroPedido}* marcada como enviada al seller.\n\n🔵 Cambió a color azul celeste.`, {
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
        INTERMEDIARIOS: intermediarios
      });
      
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
        state.step = 'awaiting_paypal_pedido';
        
        bot.sendMessage(chatId, `✅ Imagen recibida correctamente\n\n💰 Ahora envía tu PayPal:`, {
          reply_markup: getBotonesControl()
        });
      } else {
        bot.sendMessage(chatId, '⚠️ Por favor envía una imagen válida.\n\n📌 Puedes:\n• Copiar y pegar desde portapapeles\n• Enviar una foto\n• Adjuntar un archivo\n• Hacer captura de pantalla', {
          reply_markup: getBotonesControl()
        });
      }
      
    } else if (state.step === 'awaiting_paypal_pedido') {
      const paypal = text;
      
      try {
        const sheetRegistro = doc.sheetsByIndex[0];
        const rowsRegistro = await sheetRegistro.getRows();
        const userRegistro = rowsRegistro.find(r => r.get('PAYPAL') === paypal);
        const perfilAmz = userRegistro ? userRegistro.get('PERFIL') : 'N/A';
        
        const sheetPedidos = doc.sheetsByIndex[1];
        const nuevaFila = await sheetPedidos.addRow({
          FECHA: new Date().toLocaleDateString('es-ES'),
          ARTICULO: '',
          IMAGEN: state.imagenUrl,
          DESCRIPCION: '',
          NUMERO: state.numeroPedido,
          PAYPAL: paypal,
          'PERFIL AMZ': perfilAmz,
          REVIEW: '',
          NICK: msg.from.username || msg.from.first_name,
          COMISION: '',
          ESTADO: 'Pendiente',
          VENDEDOR: '',
          PAGADO: false
        });
        
        console.log('✅ Pedido guardado en Hoja 2:', state.numeroPedido);
        
        try {
          if (state.tipoImagen === 'photo' || state.tipoImagen === 'document') {
            await bot.sendPhoto(chatId, state.fileId, {
              caption: '✅ Imagen guardada correctamente',
              reply_markup: removerTeclado()
            });
          }
        } catch (error) {
          console.log('Error al reenviar imagen (no crítico):', error.message);
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
        console.error('❌ Error al guardar pedido:', error);
        bot.sendMessage(chatId, '❌ Error al guardar el pedido. Por favor intenta de nuevo.', {
          reply_markup: getBotonesControl()
        });
      }
      
    // SUBIR REVIEW
    } else if (state.step === 'awaiting_review_link') {
      state.reviewLink = text;
      state.step = 'awaiting_numero_review';
      bot.sendMessage(chatId, '🔢 Envía el número de pedido:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_numero_review') {
      state.numeroPedido = text;
      state.step = 'awaiting_paypal_review';
      bot.sendMessage(chatId, '💰 Envía tu PayPal:', {
        reply_markup: getBotonesControl()
      });
      
    } else if (state.step === 'awaiting_paypal_review') {
      const paypal = text;
      
      const sheet = doc.sheetsByIndex[1];
      const rows = await sheet.getRows();
      const row = rows.find(r => r.get('NUMERO') === state.numeroPedido && r.get('PAYPAL') === paypal);
      
      if (row) {
        row.set('REVIEW', state.reviewLink);
        row.set('ESTADO', 'Review Subida');
        await row.save();
        
        const rowIndex = row.rowNumber;
        await aplicarColorEstado(sheet, rowIndex, 'Review Subida');
        
        bot.sendMessage(chatId, '✅ Review subida correctamente.\n\nTu pedido está siendo procesado.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
          }
        });
        
        await notificarNuevaReview({
          numero: state.numeroPedido,
          review: state.reviewLink,
          paypal: paypal,
          nick: msg.from.username || msg.from.first_name
        });
        
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido. Verifica el número y PayPal.', {
          reply_markup: getBotonesControl()
        });
      }
      
      limpiarEstadoUsuario(chatId);
      
    // MARCAR PAGADO (ADMIN)
    } else if (state.step === 'awaiting_numero_pagar') {
      const numeroPedido = text;
      
      const sheet = doc.sheetsByIndex[1];
      const rows = await sheet.getRows();
      const row = rows.find(r => r.get('NUMERO') === numeroPedido);
      
      if (row) {
        row.set('ESTADO', 'Review Pagada');
        await row.save();
        
        const rowIndex = row.rowNumber;
        await aplicarColorEstado(sheet, rowIndex, 'Review Pagada');
        
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
        
        bot.sendMessage(chatId, `✅ Pedido *${numeroPedido}* marcado como pagado.\n\n🔵 Cambió a color azul oscuro.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'menu_principal' }]]
          }
        });
        
      } else {
        bot.sendMessage(chatId, '❌ No se encontró el pedido.', {
          reply_markup: getBotonesControl()
        });
      }
      
      limpiarEstadoUsuario(chatId);
    }
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error al procesar tu solicitud.\n\nUsa /start para comenzar de nuevo.', {
      reply_markup: removerTeclado()
    });
    console.error('Error en manejador:', error);
    limpiarEstadoUsuario(chatId);
  }
});

// Servidor Express
app.get('/', (req, res) => {
  res.send('Bot AmazonFlow funcionando correctamente - Con sincronización de checkbox PAGADO');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
});

// Iniciar
console.log('🔍 Verificando conexión con Google Sheets...');
initSheet();
