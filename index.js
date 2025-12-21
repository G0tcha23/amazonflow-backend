require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const token = process.env.TELEGRAM_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Conexión a MongoDB
let db;
let usersCollection;
let ordersCollection;

async function connectDB() {
  try {
    const client = await MongoClient.connect(mongoUri);
    
    db = client.db('amazonflow');
    usersCollection = db.collection('users');
    ordersCollection = db.collection('orders');
    
    // Crear índices
    await usersCollection.createIndex({ chatId: 1 }, { unique: true });
    await ordersCollection.createIndex({ orderId: 1 });
    
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

// Estados de usuario en memoria
const userStates = {};

// Keyboard principal
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['👤 Registrarme', '🛍️ Nuevo Pedido'],
      ['📝 Enviar Review', '📊 Mi Estado'],
      ['❌ Cancelar']
    ],
    resize_keyboard: true
  }
};

// Comando /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? '@' + msg.from.username : msg.from.first_name;
  
  await bot.sendMessage(
    chatId,
    `¡Hola ${username}! 👋\n\n` +
    `Bienvenido al bot de AmazonFlow.\n\n` +
    `Usa los botones para:\n` +
    `👤 Registrarte\n` +
    `🛍️ Crear pedidos\n` +
    `📝 Enviar reviews\n` +
    `📊 Ver tu estado`,
    mainKeyboard
  );
});

// Validaciones
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidOrderId(orderId) {
  return /^\d{3}-\d{7}-\d{7}$/.test(orderId);
}

function isValidAmazonUrl(url) {
  return url.includes('amazon.com') || url.includes('amazon.es');
}

// Manejo de mensajes
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username ? '@' + msg.from.username : msg.from.first_name;

  if (!text) {
    // Si no hay texto, puede ser una foto
    const state = userStates[chatId];
    if (state && state.step === 'awaiting_screenshot') {
      await handleScreenshot(msg, chatId, state);
    }
    return;
  }

  // Comandos principales
  if (text === '❌ Cancelar') {
    delete userStates[chatId];
    await bot.sendMessage(chatId, '❌ Operación cancelada', mainKeyboard);
    return;
  }

  if (text === '👤 Registrarme') {
    const existingUser = await usersCollection.findOne({ chatId });
    
    if (existingUser) {
      await bot.sendMessage(
        chatId, 
        `✅ Ya estás registrado\n\n` +
        `📱 Telegram: ${existingUser.nombreTelegram}\n` +
        `💰 PayPal: ${existingUser.paypal}\n` +
        `👥 Intermediarios: ${existingUser.intermediarios}`,
        mainKeyboard
      );
      return;
    }

    userStates[chatId] = { 
      step: 'awaiting_nombre_telegram', 
      data: { chatId } 
    };
    
    await bot.sendMessage(
      chatId,
      `📝 *REGISTRO DE NUEVO USUARIO*\n\n` +
      `Por favor, envía tu nombre o nick de Telegram (con @):\n\n` +
      `Ejemplo: @tunombre`,
      { 
        parse_mode: 'Markdown',
        reply_markup: { 
          keyboard: [['❌ Cancelar']], 
          resize_keyboard: true 
        } 
      }
    );
    return;
  }

  if (text === '🛍️ Nuevo Pedido') {
    const user = await usersCollection.findOne({ chatId });
    
    if (!user) {
      await bot.sendMessage(
        chatId, 
        '⚠️ *DEBES REGISTRARTE PRIMERO*\n\n' +
        'Por favor usa el botón "👤 Registrarme" antes de crear un pedido.',
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
      return;
    }

    userStates[chatId] = { 
      step: 'awaiting_numero_pedido', 
      data: { 
        chatId,
        nombreTelegram: user.nombreTelegram,
        paypalGuardado: user.paypal,
        intermediarios: user.intermediarios
      } 
    };
    
    await bot.sendMessage(
      chatId,
      `📦 *NUEVO PEDIDO*\n\n` +
      `Envía el número de pedido de Amazon:\n` +
      `Formato: 111-2233445-6677889`,
      { 
        parse_mode: 'Markdown',
        reply_markup: { 
          keyboard: [['❌ Cancelar']], 
          resize_keyboard: true 
        } 
      }
    );
    return;
  }

  if (text === '📝 Enviar Review') {
    const orders = await ordersCollection.find({ 
      chatId, 
      reviewSubmitted: false 
    }).toArray();
    
    if (orders.length === 0) {
      await bot.sendMessage(
        chatId, 
        '⚠️ No tienes pedidos pendientes de review', 
        mainKeyboard
      );
      return;
    }

    userStates[chatId] = { step: 'awaiting_review_link', data: { orders } };
    
    let ordersList = '📦 *PEDIDOS PENDIENTES DE REVIEW:*\n\n';
    orders.forEach((order, index) => {
      ordersList += `${index + 1}. Order ID: \`${order.numeroPedido}\`\n`;
    });
    
    await bot.sendMessage(
      chatId,
      ordersList + '\n🔗 Envía el link de tu review de Amazon:',
      { 
        parse_mode: 'Markdown',
        reply_markup: { 
          keyboard: [['❌ Cancelar']], 
          resize_keyboard: true 
        } 
      }
    );
    return;
  }

  if (text === '📊 Mi Estado') {
    const orders = await ordersCollection.find({ chatId }).toArray();
    
    if (orders.length === 0) {
      await bot.sendMessage(chatId, '📊 Aún no tienes pedidos', mainKeyboard);
      return;
    }

    const stats = {
      total: orders.length,
      pending: orders.filter(o => !o.reviewSubmitted).length,
      reviewed: orders.filter(o => o.reviewSubmitted && o.estado === 'reviewed').length,
      paid: orders.filter(o => o.estado === 'paid').length,
      totalEarned: orders.filter(o => o.estado === 'paid').reduce((sum, o) => sum + (o.amount || 15), 0)
    };

    await bot.sendMessage(
      chatId,
      `📊 *TU ESTADO*\n\n` +
      `📦 Total de pedidos: ${stats.total}\n` +
      `⏳ Pendientes de review: ${stats.pending}\n` +
      `✅ Reviews enviados: ${stats.reviewed}\n` +
      `💰 Pagados: ${stats.paid}\n` +
      `💵 Total ganado: $${stats.totalEarned}`,
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
    return;
  }

  // Manejo de estados
  const state = userStates[chatId];
  if (!state) return;

  try {
    switch (state.step) {
      // ============= FLUJO DE REGISTRO =============
      case 'awaiting_nombre_telegram':
        if (!text.startsWith('@')) {
          await bot.sendMessage(
            chatId, 
            '❌ El nombre debe empezar con @\n\nEjemplo: @tunombre'
          );
          return;
        }
        state.data.nombreTelegram = text;
        state.step = 'awaiting_paypal_registro';
        await bot.sendMessage(
          chatId, 
          '💰 Ahora envía tu email de PayPal:'
        );
        break;

      case 'awaiting_paypal_registro':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Por favor envía un email válido:');
          return;
        }
        state.data.paypal = text;
        state.step = 'awaiting_intermediarios';
        await bot.sendMessage(
          chatId, 
          '👥 Envía los nombres de tus intermediarios (para referencias):\n\n' +
          'Puedes enviar uno o varios separados por comas.\n' +
          'Ejemplo: Juan, María, Pedro'
        );
        break;

      case 'awaiting_intermediarios':
        state.data.intermediarios = text.trim();
        state.data.fechaRegistro = new Date();
        
        await usersCollection.insertOne(state.data);
        
        await bot.sendMessage(
          chatId,
          `✅ *¡REGISTRO COMPLETADO!*\n\n` +
          `📱 Telegram: ${state.data.nombreTelegram}\n` +
          `💰 PayPal: ${state.data.paypal}\n` +
          `👥 Intermediarios: ${state.data.intermediarios}\n\n` +
          `Ya puedes crear pedidos usando "🛍️ Nuevo Pedido"`,
          { parse_mode: 'Markdown', ...mainKeyboard }
        );
        
        delete userStates[chatId];
        break;

      // ============= FLUJO DE PEDIDO =============
      case 'awaiting_numero_pedido':
        if (!isValidOrderId(text)) {
          await bot.sendMessage(
            chatId, 
            '❌ Número de pedido inválido.\n\n' +
            'Formato correcto: 111-2233445-6677889'
          );
          return;
        }
        state.data.numeroPedido = text;
        state.step = 'awaiting_screenshot';
        await bot.sendMessage(
          chatId, 
          '📸 Ahora envía una captura de pantalla del pedido:'
        );
        break;

      case 'awaiting_screenshot':
        // Este caso se maneja en handleScreenshot cuando llega una foto
        await bot.sendMessage(
          chatId, 
          '❌ Por favor envía una imagen (captura de pantalla).'
        );
        break;

      case 'awaiting_paypal_confirmacion':
        // Este caso se maneja con botones inline (callback_query)
        break;

      case 'awaiting_nuevo_paypal':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Por favor envía un email válido:');
          return;
        }
        
        // Actualizar PayPal en el perfil del usuario
        await usersCollection.updateOne(
          { chatId },
          { $set: { paypal: text } }
        );
        
        state.data.paypalUsado = text;
        
        // Crear el pedido
        await crearPedido(chatId, state.data);
        delete userStates[chatId];
        break;

      // ============= FLUJO DE REVIEW =============
      case 'awaiting_review_link':
        if (!isValidAmazonUrl(text)) {
          await bot.sendMessage(chatId, '❌ Link inválido. Debe ser un link de Amazon:');
          return;
        }
        
        const orderToUpdate = state.data.orders[0];
        
        await ordersCollection.updateOne(
          { orderId: orderToUpdate.orderId },
          { 
            $set: { 
              reviewSubmitted: true,
              reviewLink: text,
              estado: 'reviewed'
            } 
          }
        );
        
        await bot.sendMessage(
          chatId,
          `✅ *¡REVIEW ENVIADO!*\n\n` +
          `Order ID: \`${orderToUpdate.numeroPedido}\`\n` +
          `Estado: reviewed\n\n` +
          `Recibirás el pago pronto.`,
          { parse_mode: 'Markdown', ...mainKeyboard }
        );
        
        delete userStates[chatId];
        break;
    }
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    await bot.sendMessage(
      chatId, 
      '❌ Error procesando tu solicitud. Intenta de nuevo.', 
      mainKeyboard
    );
    delete userStates[chatId];
  }
});

// Manejo de fotos (captura de pantalla)
async function handleScreenshot(msg, chatId, state) {
  if (!msg.photo) {
    await bot.sendMessage(chatId, '❌ Por favor envía una imagen.');
    return;
  }

  try {
    const photo = msg.photo[msg.photo.length - 1]; // La foto de mayor calidad
    const fileId = photo.file_id;
    
    // Obtener información del archivo para construir la URL
    const file = await bot.getFile(fileId);
    const capturaUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    
    state.data.capturaUrl = capturaUrl;
    state.data.fileId = fileId;
    
    // Mostrar PayPal guardado y preguntar si quiere cambiarlo
    const paypalGuardado = state.data.paypalGuardado;
    
    state.step = 'awaiting_paypal_confirmacion';
    
    await bot.sendMessage(
      chatId,
      `✅ Captura recibida\n\n` +
      `💰 *PayPal guardado:* ${paypalGuardado}\n\n` +
      `¿Quieres usar este PayPal o cambiarlo?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Usar este', callback_data: 'paypal_usar' },
              { text: '✏️ Cambiar PayPal', callback_data: 'paypal_cambiar' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error procesando captura:', error);
    await bot.sendMessage(chatId, '❌ Error procesando la captura. Intenta de nuevo.');
  }
}

// Manejo de botones inline (callback_query)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = userStates[chatId];

  try {
    await bot.answerCallbackQuery(query.id);

    if (!state) return;

    if (data === 'paypal_usar') {
      // Usar el PayPal guardado
      state.data.paypalUsado = state.data.paypalGuardado;
      
      await bot.editMessageText(
        `✅ Usando PayPal guardado: ${state.data.paypalGuardado}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id
        }
      );
      
      // Crear el pedido
      await crearPedido(chatId, state.data);
      delete userStates[chatId];
      
    } else if (data === 'paypal_cambiar') {
      // Pedir nuevo PayPal
      state.step = 'awaiting_nuevo_paypal';
      
      await bot.editMessageText(
        '✏️ Cambiar PayPal',
        {
          chat_id: chatId,
          message_id: query.message.message_id
        }
      );
      
      await bot.sendMessage(
        chatId,
        '💰 Envía tu nuevo email de PayPal:',
        {
          reply_markup: {
            keyboard: [['❌ Cancelar']],
            resize_keyboard: true
          }
        }
      );
    }
  } catch (error) {
    console.error('Error en callback_query:', error);
  }
});

// Función para crear pedido
async function crearPedido(chatId, data) {
  try {
    const newOrder = {
      orderId: `order_${Date.now()}`,
      chatId: data.chatId,
      nombreTelegram: data.nombreTelegram,
      numeroPedido: data.numeroPedido,
      capturaUrl: data.capturaUrl,
      fileId: data.fileId,
      paypalUsado: data.paypalUsado,
      intermediarios: data.intermediarios,
      estado: 'pending',
      fecha: new Date(),
      amount: 15,
      reviewSubmitted: false,
      reviewLink: ''
    };
    
    await ordersCollection.insertOne(newOrder);
    
    await bot.sendMessage(
      chatId,
      `✅ *¡PEDIDO CREADO!*\n\n` +
      `🆔 Order ID: \`${newOrder.numeroPedido}\`\n` +
      `💰 PayPal: ${newOrder.paypalUsado}\n` +
      `💵 Monto: $${newOrder.amount}\n` +
      `📅 Estado: ${newOrder.estado}\n\n` +
      `Recuerda enviar tu review cuando esté listo usando "📝 Enviar Review"`,
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  } catch (error) {
    console.error('Error creando pedido:', error);
    await bot.sendMessage(
      chatId,
      '❌ Error al crear el pedido. Por favor intenta de nuevo.',
      mainKeyboard
    );
  }
}

// ============= API ROUTES =============

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'AmazonFlow Bot Server',
    version: '2.0'
  });
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await ordersCollection.find({}).sort({ fecha: -1 }).toArray();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;
    
    const result = await ordersCollection.updateOne(
      { orderId },
      { $set: updates }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const updatedOrder = await ordersCollection.findOne({ orderId });
    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const result = await ordersCollection.deleteOne({ orderId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener la imagen de una captura
app.get('/api/orders/:orderId/image', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await ordersCollection.findOne({ orderId });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (!order.capturaUrl) {
      return res.status(404).json({ error: 'No image found for this order' });
    }
    
    res.json({
      orderId: order.orderId,
      capturaUrl: order.capturaUrl,
      fileId: order.fileId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para descargar Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const XLSX = require('xlsx');
    
    const users = await usersCollection.find({}).toArray();
    const orders = await ordersCollection.find({}).toArray();
    
    // Preparar datos de usuarios
    const usersData = users.map(user => ({
      'Chat ID': user.chatId,
      'Nombre Telegram': user.nombreTelegram,
      'PayPal': user.paypal,
      'Intermediarios': user.intermediarios,
      'Fecha Registro': user.fechaRegistro ? new Date(user.fechaRegistro).toLocaleString('es-ES') : ''
    }));
    
    // Preparar datos de pedidos
    const ordersData = orders.map(order => ({
      'Order ID': order.orderId,
      'Nombre Telegram': order.nombreTelegram,
      'Número Pedido': order.numeroPedido,
      'PayPal Usado': order.paypalUsado,
      'Estado': order.estado,
      'Review Enviado': order.reviewSubmitted ? 'Sí' : 'No',
      'Link Review': order.reviewLink || '',
      'Monto': order.amount,
      'Fecha': order.fecha ? new Date(order.fecha).toLocaleString('es-ES') : '',
      'Intermediarios': order.intermediarios || '',
      'URL Captura': order.capturaUrl || ''
    }));
    
    // Crear libro de Excel
    const wb = XLSX.utils.book_new();
    
    const wsUsers = XLSX.utils.json_to_sheet(usersData);
    XLSX.utils.book_append_sheet(wb, wsUsers, 'Usuarios');
    
    const wsOrders = XLSX.utils.json_to_sheet(ordersData);
    XLSX.utils.book_append_sheet(wb, wsOrders, 'Pedidos');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename=amazonflow_backup_${fecha}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Error generando Excel:', error);
    res.status(500).json({ error: 'Error generando archivo Excel' });
  }
});

// Iniciar servidor
async function start() {
  await connectDB();
  
  app.listen(PORT, () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log('🤖 Bot activo en modo polling');
    console.log('💾 MongoDB conectado');
    console.log('📋 Endpoints disponibles:');
    console.log('   GET  /api/users');
    console.log('   GET  /api/orders');
    console.log('   PUT  /api/orders/:orderId');
    console.log('   DELETE /api/orders/:orderId');
    console.log('   GET  /api/orders/:orderId/image');
    console.log('   GET  /api/export/excel');
  });
}

start().catch(console.error);