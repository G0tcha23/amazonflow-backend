require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'database.json');

let db = {
  users: {},
  orders: [],
  reviews: []
};

async function loadDB() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    db = JSON.parse(data);
    console.log(`💾 Base de datos: ${DB_FILE}`);
    console.log(`📊 Pedidos actuales: ${db.orders.length}`);
  } catch (error) {
    await saveDB();
  }
}

async function saveDB() {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

loadDB();

const userStates = {};

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '👤 Registrarme', callback_data: 'register' }],
      [{ text: '🛍️ Nuevo Pedido', callback_data: 'new_order' }],
      [{ text: '⭐ Enviar Review', callback_data: 'send_review' }],
      [{ text: '📊 Mi Estado', callback_data: 'my_status' }]
    ]
  }
};

function showMainMenu(chatId, username) {
  bot.sendMessage(chatId, `👋 ¡Hola @${username}!\n\n¿Qué quieres hacer?`, mainMenu);
}

// Comando /start con botón
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  showMainMenu(chatId, username);
});

// Mensaje de bienvenida automático cuando alguien abre el bot por primera vez
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text;
  
  // Si es un comando, no procesar aquí
  if (!text || text.startsWith('/')) return;
  
  const state = userStates[chatId];
  
  // Solo mostrar bienvenida si NO hay estado activo
  if (!state) {
    bot.sendMessage(chatId, 
      '👋 ¡Bienvenido a AmazonFlow!\n\nPresiona el botón de abajo para comenzar:',
      {
        reply_markup: {
          keyboard: [[{ text: '/start' }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }
    );
    return;
  }

  switch(state.action) {
    case 'waiting_paypal':
      if (state.step === 1) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
          bot.sendMessage(chatId, '❌ Email inválido.\n\nIntenta de nuevo:');
          return;
        }
        
        if (!db.users[chatId]) {
          db.users[chatId] = { username, registeredAt: new Date().toISOString() };
        }
        
        db.users[chatId].paypal = text;
        userStates[chatId] = { action: 'waiting_paypal', step: 2 };
        bot.sendMessage(chatId, 
          '📝 Paso 2/3\n\n' +
          'Envía tu perfil de Amazon.\n\n' +
          '💡 Si no lo tienes, pincha aquí:\n' +
          'https://www.amazon.es/gp/profile/\n\n' +
          'Luego copia el enlace y pégalo aquí.'
        );
      } else if (state.step === 2) {
        // Acepta cualquier texto como perfil
        
        db.users[chatId].amazonProfile = text;
        userStates[chatId] = { action: 'waiting_paypal', step: 3 };
        bot.sendMessage(chatId, '📝 Paso 3/3\n\nEnvía los nicks de tus intermediarios (separados por espacios).\n\nEjemplo: user1 user2 user3');
      } else if (state.step === 3) {
        const intermediaries = text
          .replace(/\sy\s/gi, ' ')
          .split(/[,\s]+/)
          .map(u => u.replace('@', '').trim())
          .filter(u => u.length > 0);
        
        db.users[chatId].intermediaries = intermediaries;
        await saveDB();
        
        await bot.sendMessage(chatId, 
          `✅ ¡Registro completado!\n\n` +
          `👤 @${username}\n` +
          `💳 ${db.users[chatId].paypal}\n` +
          `🔄 ${intermediaries.length} intermediarios\n\n` +
          `Ya puedes hacer pedidos.`
        );
        
        delete userStates[chatId];
        showMainMenu(chatId, username);
      }
      break;

    case 'waiting_order_id':
      const orderIdRegex = /^\d{3}-\d{7}-\d{7}$/;
      if (!orderIdRegex.test(text)) {
        bot.sendMessage(chatId, '❌ Formato incorrecto.\n\nEjemplo: 111-2233445-6677889\n\nIntenta de nuevo:', {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel' }]]
          }
        });
        return;
      }

      const newOrder = {
        id: Date.now().toString(),
        chatId,
        username,
        paypal: db.users[chatId].paypal,
        amazonProfile: db.users[chatId].amazonProfile,
        intermediaries: db.users[chatId].intermediaries,
        orderId: text,
        timestamp: new Date().toISOString(),
        status: 'pending',
        orderStatus: 'new',
        orderDate: new Date().toISOString().split('T')[0],
        productType: '',
        amount: 15,
        reviewSubmitted: false
      };
      
      db.orders.push(newOrder);
      await saveDB();
      
      bot.sendMessage(chatId,
        `✅ ¡Pedido registrado!\n\n` +
        `📦 Order ID: ${text}\n` +
        `💰 Pago: $15\n\n` +
        `Ahora:\n` +
        `1️⃣ Compra en Amazon\n` +
        `2️⃣ Recibe el producto\n` +
        `3️⃣ Envía tu review`
      );
      delete userStates[chatId];
      showMainMenu(chatId, username);
      break;

    case 'waiting_review_link':
      if (!text.includes('amazon.com/review') && !text.includes('amzn.to')) {
        bot.sendMessage(chatId, '❌ Link inválido.\n\nIntenta de nuevo:', {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel' }]]
          }
        });
        return;
      }

      const orderToUpdate = db.orders.find(o => o.chatId === chatId && o.status === 'pending');
      if (orderToUpdate) {
        orderToUpdate.reviewSubmitted = true;
        orderToUpdate.reviewLink = text;
        orderToUpdate.status = 'reviewed';
        await saveDB();
        
        bot.sendMessage(chatId,
          `✅ ¡Review recibido!\n\n` +
          `💰 Procesaremos tu pago en 24-48h.\n\n` +
          `Gracias.`
        );
      }
      delete userStates[chatId];
      showMainMenu(chatId, username);
      break;
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (data === 'cancel') {
    delete userStates[chatId];
    bot.sendMessage(chatId, '❌ Operación cancelada.');
    showMainMenu(chatId, username);
    return;
  }

  switch(data) {
    case 'register':
      userStates[chatId] = { action: 'waiting_paypal', step: 1 };
      bot.sendMessage(chatId, '📝 Paso 1/3\n\nEnvía tu email de PayPal:');
      break;

    case 'new_order':
      if (!db.users[chatId]) {
        bot.sendMessage(chatId, '⚠️ Regístrate primero.');
        showMainMenu(chatId, username);
        return;
      }
      userStates[chatId] = { action: 'waiting_order_id' };
      bot.sendMessage(chatId, '🛍️ Nuevo Pedido\n\nEnvía el Order ID de Amazon.\n\nEjemplo: 111-2233445-6677889');
      break;

    case 'send_review':
      if (!db.users[chatId]) {
        bot.sendMessage(chatId, '⚠️ Regístrate primero.');
        showMainMenu(chatId, username);
        return;
      }
      const userOrders = db.orders.filter(o => o.chatId === chatId && o.status === 'pending');
      if (userOrders.length === 0) {
        bot.sendMessage(chatId, '⚠️ No tienes pedidos pendientes.');
        showMainMenu(chatId, username);
        return;
      }
      userStates[chatId] = { action: 'waiting_review_link' };
      bot.sendMessage(chatId, '⭐ Enviar Review\n\nEnvía el link de tu review.\n\nEjemplo: https://www.amazon.com/review/...');
      break;

    case 'my_status':
      const userOrdersList = db.orders.filter(o => o.chatId === chatId);
      if (userOrdersList.length === 0) {
        bot.sendMessage(chatId, '📊 Sin pedidos aún.\n\nUsa el menú para crear uno.');
      } else {
        const pending = userOrdersList.filter(o => o.status === 'pending').length;
        const reviewed = userOrdersList.filter(o => o.reviewSubmitted).length;
        const paid = userOrdersList.filter(o => o.status === 'paid').length;
        const total = userOrdersList.reduce((sum, o) => sum + o.amount, 0);
        
        const user = db.users[chatId];
        let statusMsg = `📊 Tu Estado\n\n` +
          `📦 Pedidos: ${userOrdersList.length}\n` +
          `⏳ Pendientes: ${pending}\n` +
          `✅ Reviews: ${reviewed}\n` +
          `💰 Pagados: ${paid}\n` +
          `💵 Total: $${total}`;
        
        if (user.intermediaries && user.intermediaries.length > 0) {
          statusMsg += `\n\n🔄 Intermediarios:\n${user.intermediaries.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`;
        }
        
        bot.sendMessage(chatId, statusMsg);
      }
      showMainMenu(chatId, username);
      break;
  }
});

// API REST
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    message: 'AmazonFlow Backend',
    endpoints: {
      orders: '/api/orders',
      users: '/api/users'
    }
  });
});

app.get('/api/orders', (req, res) => {
  res.json(db.orders);
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(db.users));
});

app.get('/api/intermediaries', (req, res) => {
  const allIntermediaries = new Map();
  
  Object.values(db.users).forEach(user => {
    if (user.intermediaries) {
      user.intermediaries.forEach(intermediary => {
        const count = allIntermediaries.get(intermediary) || 0;
        allIntermediaries.set(intermediary, count + 1);
      });
    }
  });
  
  const intermediariesArray = Array.from(allIntermediaries.entries())
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json(intermediariesArray);
});

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const order = db.orders.find(o => o.id === id);
  if (order) {
    Object.assign(order, updates);
    await saveDB();
    res.json({ success: true, order });
  } else {
    res.status(404).json({ error: 'Pedido no encontrado' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const index = db.orders.findIndex(o => o.id === id);
  
  if (index !== -1) {
    db.orders.splice(index, 1);
    await saveDB();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Pedido no encontrado' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`🤖 Bot activo`);
});