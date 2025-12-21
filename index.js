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
  const username = msg.from.username || msg.from.first_name;
  
  await bot.sendMessage(
    chatId,
    `¡Hola ${username}! 👋\n\nBienvenido al bot de AmazonFlow.\n\n` +
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
  const username = msg.from.username || msg.from.first_name;

  if (!text) return;

  // Comandos principales
  if (text === '❌ Cancelar') {
    delete userStates[chatId];
    await bot.sendMessage(chatId, '❌ Operación cancelada', mainKeyboard);
    return;
  }

  if (text === '👤 Registrarme') {
    const existingUser = await usersCollection.findOne({ chatId });
    
    if (existingUser) {
      await bot.sendMessage(chatId, '✅ Ya estás registrado', mainKeyboard);
      return;
    }

    userStates[chatId] = { step: 'awaiting_paypal', data: { username, chatId } };
    await bot.sendMessage(
      chatId,
      '📧 Por favor, envía tu email de PayPal:',
      { reply_markup: { keyboard: [['❌ Cancelar']], resize_keyboard: true } }
    );
    return;
  }

  if (text === '🛍️ Nuevo Pedido') {
    const user = await usersCollection.findOne({ chatId });
    
    if (!user) {
      await bot.sendMessage(chatId, '⚠️ Primero debes registrarte usando "👤 Registrarme"', mainKeyboard);
      return;
    }

    userStates[chatId] = { 
      step: 'awaiting_order_id', 
      data: { 
        username: user.username,
        chatId,
        paypal: user.paypal,
        amazonProfile: user.amazonProfile,
        intermediaries: user.intermediaries
      } 
    };
    
    await bot.sendMessage(
      chatId,
      '🆔 Envía el Order ID de Amazon (formato: 111-2233445-6677889):',
      { reply_markup: { keyboard: [['❌ Cancelar']], resize_keyboard: true } }
    );
    return;
  }

  if (text === '📝 Enviar Review') {
    const orders = await ordersCollection.find({ 
      chatId, 
      reviewSubmitted: false 
    }).toArray();
    
    if (orders.length === 0) {
      await bot.sendMessage(chatId, '⚠️ No tienes pedidos pendientes de review', mainKeyboard);
      return;
    }

    userStates[chatId] = { step: 'awaiting_review_link', data: { orders } };
    
    let ordersList = '📦 Pedidos pendientes de review:\n\n';
    orders.forEach((order, index) => {
      ordersList += `${index + 1}. Order ID: ${order.orderId}\n`;
    });
    
    await bot.sendMessage(
      chatId,
      ordersList + '\n🔗 Envía el link de tu review de Amazon:',
      { reply_markup: { keyboard: [['❌ Cancelar']], resize_keyboard: true } }
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
      reviewed: orders.filter(o => o.reviewSubmitted && o.status === 'reviewed').length,
      paid: orders.filter(o => o.status === 'paid').length,
      totalEarned: orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + (o.amount || 15), 0)
    };

    await bot.sendMessage(
      chatId,
      `📊 *Tu Estado*\n\n` +
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
      case 'awaiting_paypal':
        if (!isValidEmail(text)) {
          await bot.sendMessage(chatId, '❌ Email inválido. Por favor envía un email válido:');
          return;
        }
        state.data.paypal = text;
        state.step = 'awaiting_amazon_profile';
        await bot.sendMessage(chatId, '🔗 Envía tu perfil de Amazon (URL):');
        break;

      case 'awaiting_amazon_profile':
        if (!isValidAmazonUrl(text)) {
          await bot.sendMessage(chatId, '❌ URL inválida. Debe ser un link de Amazon:');
          return;
        }
        state.data.amazonProfile = text;
        state.step = 'awaiting_intermediaries';
        await bot.sendMessage(chatId, '👥 Envía los nicks de tus intermediarios (separados por espacios):');
        break;

      case 'awaiting_intermediaries':
        state.data.intermediaries = text.trim().split(/\s+/);
        state.data.registeredAt = new Date().toISOString();
        
        await usersCollection.insertOne(state.data);
        
        await bot.sendMessage(
          chatId,
          '✅ ¡Registro completado con éxito!\n\n' +
          `📧 PayPal: ${state.data.paypal}\n` +
          `🔗 Amazon: ${state.data.amazonProfile}\n` +
          `👥 Intermediarios: ${state.data.intermediaries.join(', ')}`,
          mainKeyboard
        );
        
        delete userStates[chatId];
        break;

      case 'awaiting_order_id':
        if (!isValidOrderId(text)) {
          await bot.sendMessage(chatId, '❌ Order ID inválido. Formato correcto: 111-2233445-6677889');
          return;
        }
        state.data.orderId = text;
        state.step = 'awaiting_screenshot';
        await bot.sendMessage(chatId, '📸 Envía una captura de pantalla del pedido:');
        break;

      case 'awaiting_screenshot':
        if (!msg.photo) {
          await bot.sendMessage(chatId, '❌ Por favor envía una imagen');
          return;
        }
        
        state.data.screenshotId = msg.photo[msg.photo.length - 1].file_id;
        
        const newOrder = {
          id: `order_${Date.now()}`,
          chatId: state.data.chatId,
          username: state.data.username,
          paypal: state.data.paypal,
          amazonProfile: state.data.amazonProfile,
          intermediaries: state.data.intermediaries,
          orderId: state.data.orderId,
          screenshotId: state.data.screenshotId,
          timestamp: new Date().toISOString(),
          status: 'pending',
          orderStatus: 'new',
          orderDate: new Date().toISOString().split('T')[0],
          productType: '',
          amount: 15,
          reviewSubmitted: false,
          reviewLink: ''
        };
        
        await ordersCollection.insertOne(newOrder);
        
        await bot.sendMessage(
          chatId,
          '✅ ¡Pedido creado con éxito!\n\n' +
          `🆔 Order ID: ${newOrder.orderId}\n` +
          `💰 Monto: $${newOrder.amount}\n\n` +
          `Recuerda enviar tu review cuando esté listo usando "📝 Enviar Review"`,
          mainKeyboard
        );
        
        delete userStates[chatId];
        break;

      case 'awaiting_review_link':
        if (!isValidAmazonUrl(text)) {
          await bot.sendMessage(chatId, '❌ Link inválido. Debe ser un link de Amazon:');
          return;
        }
        
        const orderToUpdate = state.data.orders[0];
        
        await ordersCollection.updateOne(
          { id: orderToUpdate.id },
          { 
            $set: { 
              reviewSubmitted: true,
              reviewLink: text,
              status: 'reviewed'
            } 
          }
        );
        
        await bot.sendMessage(
          chatId,
          '✅ ¡Review enviado con éxito!\n\n' +
          `Tu pedido está ahora en estado "reviewed".\n` +
          `Recibirás el pago pronto.`,
          mainKeyboard
        );
        
        delete userStates[chatId];
        break;
    }
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    await bot.sendMessage(chatId, '❌ Error procesando tu solicitud. Intenta de nuevo.', mainKeyboard);
    delete userStates[chatId];
  }
});

// API Routes
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'AmazonFlow Bot Server' });
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await ordersCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/intermediaries', async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    const intermediariesMap = {};
    
    users.forEach(user => {
      if (user.intermediaries) {
        user.intermediaries.forEach(nick => {
          intermediariesMap[nick] = (intermediariesMap[nick] || 0) + 1;
        });
      }
    });
    
    const intermediaries = Object.entries(intermediariesMap).map(([nick, count]) => ({
      nick,
      count
    }));
    
    res.json(intermediaries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const result = await ordersCollection.updateOne(
      { id },
      { $set: updates }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const updatedOrder = await ordersCollection.findOne({ id });
    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await ordersCollection.deleteOne({ id });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ success: true });
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
      'Username': user.username,
      'PayPal': user.paypal,
      'Perfil Amazon': user.amazonProfile,
      'Intermediarios': (user.intermediaries || []).join(', '),
      'Fecha Registro': user.registeredAt
    }));
    
    // Preparar datos de pedidos
    const ordersData = orders.map(order => ({
      'ID': order.id,
      'Username': order.username,
      'Order ID Amazon': order.orderId,
      'PayPal': order.paypal,
      'Estado': order.status,
      'Review Enviado': order.reviewSubmitted ? 'Sí' : 'No',
      'Link Review': order.reviewLink || '',
      'Monto': order.amount,
      'Fecha': order.orderDate,
      'Intermediarios': (order.intermediaries || []).join(', ')
    }));
    
    // Crear libro de Excel
    const wb = XLSX.utils.book_new();
    
    const wsUsers = XLSX.utils.json_to_sheet(usersData);
    XLSX.utils.book_append_sheet(wb, wsUsers, 'Usuarios');
    
    const wsOrders = XLSX.utils.json_to_sheet(ordersData);
    XLSX.utils.book_append_sheet(wb, wsOrders, 'Pedidos');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename=amazonflow_backup_${new Date().toISOString().split('T')[0]}.xlsx`);
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
    console.log('🤖 Bot activo');
    console.log('💾 MongoDB conectado');
  });
}

start().catch(console.error);