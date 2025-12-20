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
  bot.sendMessage(chatId, `👋 ¡Hola @${username}!\n\n🎯 Bienvenido a AmazonFlow Pro\n\n¿Qué deseas hacer hoy?`, mainMenu);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  showMainMenu(chatId, username);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  switch(data) {
    case 'register':
      userStates[chatId] = { action: 'waiting_paypal', step: 1 };
      bot.sendMessage(chatId, '📝 REGISTRO DE NUEVO CLIENTE - Paso 1/4\n\nPor favor, envíame tu email de PayPal:');
      break;

    case 'new_order':
      if (!db.users[chatId]) {
        bot.sendMessage(chatId, '⚠️ Primero debes registrarte.\n\nUsa el botón "👤 Registrarme" del menú principal.');
        showMainMenu(chatId, username);
        return;
      }
      userStates[chatId] = { action: 'waiting_order_id' };
      bot.sendMessage(chatId, '🛍️ NUEVO PEDIDO\n\nPor favor, envíame el Order ID de Amazon.\n\nEjemplo: 111-2233445-6677889');
      break;

    case 'send_review':
      if (!db.users[chatId]) {
        bot.sendMessage(chatId, '⚠️ Primero debes registrarte.');
        showMainMenu(chatId, username);
        return;
      }
      const userOrders = db.orders.filter(o => o.chatId === chatId && o.status === 'pending');
      if (userOrders.length === 0) {
        bot.sendMessage(chatId, '⚠️ No tienes pedidos pendientes de review.');
        showMainMenu(chatId, username);
        return;
      }
      userStates[chatId] = { action: 'waiting_review_link' };
      bot.sendMessage(chatId, '⭐ ENVIAR REVIEW\n\nPor favor, envíame el link de tu review de Amazon.\n\nEjemplo: https://www.amazon.com/review/...');
      break;

    case 'my_status':
      const userOrdersList = db.orders.filter(o => o.chatId === chatId);
      if (userOrdersList.length === 0) {
        bot.sendMessage(chatId, '📊 TU ESTADO\n\nNo tienes pedidos registrados aún.\n\nUsa el menú para crear tu primer pedido.');
      } else {
        const pending = userOrdersList.filter(o => o.status === 'pending').length;
        const reviewed = userOrdersList.filter(o => o.reviewSubmitted).length;
        const paid = userOrdersList.filter(o => o.status === 'paid').length;
        const total = userOrdersList.reduce((sum, o) => sum + o.amount, 0);
        
        const user = db.users[chatId];
        let statusMsg = `📊 TU ESTADO\n\n` +
          `📦 Total Pedidos: ${userOrdersList.length}\n` +
          `⏳ Pendientes: ${pending}\n` +
          `✅ Reviews Enviados: ${reviewed}\n` +
          `💰 Pagados: ${paid}\n` +
          `💵 Total Ganado: $${total}\n\n` +
          `👤 Perfil Amazon: ${user.amazonProfile || 'No registrado'}`;
        
        if (user.intermediaries && user.intermediaries.length > 0) {
          statusMsg += `\n\n🔄 Intermediarios:\n${user.intermediaries.map((i, idx) => `${idx + 1}. @${i}`).join('\n')}`;
        }
        
        bot.sendMessage(chatId, statusMsg);
      }
      showMainMenu(chatId, username);
      break;
  }
});

bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text;
  const state = userStates[chatId];

  if (!state) return;

  switch(state.action) {
    case 'waiting_paypal':
      if (state.step === 1) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
          bot.sendMessage(chatId, '❌ Email inválido. Por favor, envía un email válido de PayPal:');
          return;
        }
        
        if (!db.users[chatId]) {
          db.users[chatId] = {
            username,
            registeredAt: new Date().toISOString()
          };
        }
        
        db.users[chatId].paypal = text;
        userStates[chatId] = { action: 'waiting_paypal', step: 2 };
        bot.sendMessage(chatId, '📝 REGISTRO - Paso 2/4\n\nAhora envíame el enlace de tu perfil de Amazon.\n\nEjemplo: https://www.amazon.com/gp/profile/...');
      } else if (state.step === 2) {
        if (!text.includes('amazon.com') && !text.includes('amzn.')) {
          bot.sendMessage(chatId, '❌ Enlace inválido. Debe ser un enlace de perfil de Amazon.\n\nIntenta de nuevo:');
          return;
        }
        
        db.users[chatId].amazonProfile = text;
        userStates[chatId] = { action: 'waiting_paypal', step: 3, intermediaries: [] };
        bot.sendMessage(chatId, '📝 REGISTRO - Paso 3/4\n\nAhora envíame el @ del primer intermediario con pedidos reembolsados.\n\nEjemplo: username (sin el @)');
      } else if (state.step === 3 || state.step === 4 || state.step === 5) {
        const cleanUsername = text.trim();
        if (cleanUsername.length < 3) {
          bot.sendMessage(chatId, '❌ Username muy corto. Debe tener al menos 3 caracteres.\n\nIntenta de nuevo:');
          return;
        }
        
        if (!state.intermediaries) state.intermediaries = [];
        state.intermediaries.push(cleanUsername);
        
        if (state.step === 3) {
          userStates[chatId].step = 4;
          bot.sendMessage(chatId, '📝 REGISTRO - Paso 3/4 (2 de 3)\n\nEnvíame el @ del segundo intermediario:');
        } else if (state.step === 4) {
          userStates[chatId].step = 5;
          bot.sendMessage(chatId, '📝 REGISTRO - Paso 3/4 (3 de 3)\n\nEnvíame el @ del tercer intermediario:');
        } else if (state.step === 5) {
          db.users[chatId].intermediaries = state.intermediaries;
          await saveDB();
          
          bot.sendMessage(chatId, 
            `✅ ¡REGISTRO COMPLETADO!\n\n` +
            `👤 Usuario: @${username}\n` +
            `💳 PayPal: ${db.users[chatId].paypal}\n` +
            `🔗 Perfil Amazon: Registrado\n` +
            `🔄 Intermediarios: ${state.intermediaries.length}\n\n` +
            `Ya estás registrado en el sistema.\n` +
            `Ahora puedes hacer pedidos y enviar reviews.`
          );
          delete userStates[chatId];
          showMainMenu(chatId, username);
        }
      }
      break;

    case 'waiting_order_id':
      const orderIdRegex = /^\d{3}-\d{7}-\d{7}$/;
      if (!orderIdRegex.test(text)) {
        bot.sendMessage(chatId, '❌ Order ID inválido.\n\nFormato correcto: 111-2233445-6677889\n\nIntenta de nuevo:');
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
        amount: 15,
        reviewSubmitted: false
      };
      
      db.orders.push(newOrder);
      await saveDB();
      
      bot.sendMessage(chatId,
        `✅ ¡PEDIDO REGISTRADO!\n\n` +
        `📦 Order ID: ${text}\n` +
        `💰 Pago al completar: $15\n\n` +
        `Ahora debes:\n` +
        `1️⃣ Comprar el producto en Amazon\n` +
        `2️⃣ Recibir el producto\n` +
        `3️⃣ Enviar tu review usando el botón "⭐ Enviar Review"`
      );
      delete userStates[chatId];
      showMainMenu(chatId, username);
      break;

    case 'waiting_review_link':
      if (!text.includes('amazon.com/review') && !text.includes('amzn.to')) {
        bot.sendMessage(chatId, '❌ Link inválido.\n\nDebe ser un link de review de Amazon.\n\nIntenta de nuevo:');
        return;
      }

      const orderToUpdate = db.orders.find(o => o.chatId === chatId && o.status === 'pending');
      if (orderToUpdate) {
        orderToUpdate.reviewSubmitted = true;
        orderToUpdate.reviewLink = text;
        orderToUpdate.status = 'reviewed';
        await saveDB();
        
        bot.sendMessage(chatId,
          `✅ ¡REVIEW RECIBIDO!\n\n` +
          `Tu review ha sido registrado correctamente.\n\n` +
          `💰 Procesaremos tu pago de $15 en las próximas 24-48 horas.\n\n` +
          `Gracias por tu participación.`
        );
      }
      delete userStates[chatId];
      showMainMenu(chatId, username);
      break;
  }
});

// API REST
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    message: 'AmazonFlow Pro Backend',
    endpoints: {
      orders: '/api/orders',
      users: '/api/users',
      intermediaries: '/api/intermediaries'
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
  const { status } = req.body;
  
  const order = db.orders.find(o => o.id === id);
  if (order) {
    order.status = status;
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
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🤖 Bot de Telegram activo`);
});