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

// 1. Estructura mejorada para incluir 'sessions' (el estado del usuario)
let db = {
  users: {},
  orders: [],
  reviews: [],
  sessions: {} // Aquí guardaremos el userStates para que sobreviva a reinicios
};

// Mantenemos userStates en memoria para acceso rápido, pero lo sincronizamos con DB
let userStates = {};

async function loadDB() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    db = JSON.parse(data);
    
    // Aseguramos que existan las sesiones si el JSON es antiguo
    if (!db.sessions) db.sessions = {};
    
    // Recuperamos el estado de la memoria desde el disco
    userStates = { ...db.sessions };
    
    console.log(`💾 Base de datos cargada: ${DB_FILE}`);
    console.log(`📊 Pedidos: ${db.orders.length}`);
    console.log(`🔄 Sesiones activas recuperadas: ${Object.keys(userStates).length}`);
  } catch (error) {
    console.log('⚠️ Creando nueva base de datos...');
    await saveDB();
  }
}

async function saveDB() {
  // Antes de guardar, sincronizamos el estado actual al objeto db
  db.sessions = { ...userStates };
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

// Cargamos la DB al iniciar
loadDB();

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

async function showMainMenu(chatId, username) {
  await bot.sendMessage(chatId, `👋 ¡Hola @${username}!\n\n¿Qué quieres hacer?`, mainMenu);
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  // Limpiamos estado al reiniciar para evitar bucles
  if (userStates[chatId]) {
    delete userStates[chatId];
    await saveDB();
  }
  await showMainMenu(chatId, username);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'Usuario';
  const text = msg.text;
  
  if (text && text.startsWith('/')) return;
  
  const state = userStates[chatId];
  if (!state) return; // Si no hay estado, ignoramos el mensaje (o podrías mostrar el menú)

  try {
    switch(state.action) {
      case 'waiting_paypal':
        if (state.step === 1) {
          // Validación básica de email
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!text || !emailRegex.test(text)) {
            await bot.sendMessage(chatId, '❌ Email inválido. Por favor, envía un email correcto:');
            return;
          }
          
          if (!db.users[chatId]) {
            db.users[chatId] = { username, registeredAt: new Date().toISOString() };
          }
          
          db.users[chatId].paypal = text;
          
          // Avanzamos paso y GUARDAMOS para no perder datos si crashea
          userStates[chatId] = { action: 'waiting_paypal', step: 2 };
          await saveDB(); 

          await bot.sendMessage(chatId, 
            '📝 Paso 2/3\n\n' +
            'Envía tu perfil de Amazon.\n\n' +
            '💡 Si no lo tienes, pincha aquí:\n' +
            'https://www.amazon.es/gp/profile/\n\n' +
            'Luego copia el enlace y pégalo aquí.'
          );

        } else if (state.step === 2) {
          if (!text) {
             await bot.sendMessage(chatId, '❌ Necesito el enlace de texto de tu perfil.');
             return;
          }

          db.users[chatId].amazonProfile = text;
          
          // Avanzamos paso y GUARDAMOS
          userStates[chatId] = { action: 'waiting_paypal', step: 3 };
          await saveDB();

          await bot.sendMessage(chatId, '📝 Paso 3/3\n\nEnvía los nicks de tus intermediarios (separados por espacios).\n\nEjemplo: user1 user2 user3');

        } else if (state.step === 3) {
          // FIX: Protección contra mensajes sin texto (fotos, stickers)
          if (!text) {
            await bot.sendMessage(chatId, '❌ Por favor, envía los nicks en formato texto.');
            return;
          }

          const intermediaries = text
            .replace(/\sy\s/gi, ' ')
            .split(/[,\s]+/)
            .map(u => u.replace('@', '').trim())
            .filter(u => u.length > 0);
          
          // Aseguramos que el usuario existe (por si se borró la DB parcialmente)
          if (!db.users[chatId]) {
             db.users[chatId] = { username, registeredAt: new Date().toISOString() };
          }

          db.users[chatId].intermediaries = intermediaries;
          
          // Borramos el estado ANTES de guardar, para indicar que terminó
          delete userStates[chatId];
          await saveDB();
          
          await bot.sendMessage(chatId, 
            `✅ ¡Registro completado!\n\n` +
            `👤 @${username}\n` +
            `💳 ${db.users[chatId].paypal || 'No guardado'}\n` +
            `🔄 ${intermediaries.length} intermediarios\n\n` +
            `Ya puedes hacer pedidos.`
          );
          
          await showMainMenu(chatId, username);
        }
        break;

      case 'new_order_flow':
        if (state.step === 1) {
          const orderIdRegex = /^\d{3}-\d{7}-\d{7}$/;
          if (!text || !orderIdRegex.test(text)) {
            await bot.sendMessage(chatId, '❌ Formato incorrecto.\n\nEjemplo: 111-2233445-6677889\n\nIntenta de nuevo:', {
              reply_markup: {
                inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel' }]]
              }
            });
            return;
          }
          
          userStates[chatId] = { action: 'new_order_flow', step: 2, orderId: text };
          await saveDB(); // Guardamos estado
          await bot.sendMessage(chatId, '📸 Paso 2/3\n\nEnvía una captura del pedido donde se vea:\n• Tienda\n• PayPal\n• Importe');

        } else if (state.step === 2) {
          if (!msg.photo || msg.photo.length === 0) {
            await bot.sendMessage(chatId, '❌ Debes enviar una foto (comprimida, no como archivo).\n\nIntenta de nuevo:', {
              reply_markup: {
                inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel' }]]
              }
            });
            return;
          }
          
          const photo = msg.photo[msg.photo.length - 1];
          userStates[chatId] = { 
            action: 'new_order_flow', 
            step: 3, 
            orderId: state.orderId,
            photoId: photo.file_id 
          };
          await saveDB(); // Guardamos estado
          await bot.sendMessage(chatId, '💳 Paso 3/3\n\nEnvía tu correo de PayPal para este pedido:');

        } else if (state.step === 3) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!text || !emailRegex.test(text)) {
            await bot.sendMessage(chatId, '❌ Email inválido.\n\nIntenta de nuevo:');
            return;
          }
          
          // Recuperamos datos del usuario de forma segura
          const userProfile = db.users[chatId] || {};

          const newOrder = {
            id: Date.now().toString(),
            chatId,
            username,
            paypal: text,
            amazonProfile: userProfile.amazonProfile || 'No registrado',
            intermediaries: userProfile.intermediaries || [],
            orderId: state.orderId,
            screenshotId: state.photoId,
            timestamp: new Date().toISOString(),
            status: 'pending',
            orderStatus: 'new',
            orderDate: new Date().toISOString().split('T')[0],
            productType: '',
            amount: 15,
            reviewSubmitted: false
          };
          
          db.orders.push(newOrder);
          
          delete userStates[chatId];
          await saveDB();
          
          await bot.sendMessage(chatId,
            `✅ ¡Pedido registrado!\n\n` +
            `📦 Order ID: ${state.orderId}\n` +
            `💳 PayPal: ${text}\n` +
            `💰 Pago: $15\n\n` +
            `Ahora:\n` +
            `1️⃣ Compra en Amazon\n` +
            `2️⃣ Recibe el producto\n` +
            `3️⃣ Envía tu review`
          );
          await showMainMenu(chatId, username);
        }
        break;

      case 'waiting_review_link':
        if (!text || (!text.includes('amazon.com/review') && !text.includes('amzn.to'))) {
          await bot.sendMessage(chatId, '❌ Link inválido.\n\nIntenta de nuevo:', {
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
          
          delete userStates[chatId];
          await saveDB();
          
          await bot.sendMessage(chatId,
            `✅ ¡Review recibido!\n\n` +
            `💰 Procesaremos tu pago en 24-48h.\n\n` +
            `Gracias.`
          );
        } else {
            // Caso raro: no encuentra el pedido
            delete userStates[chatId];
            await saveDB();
            await bot.sendMessage(chatId, '⚠️ No se encontró el pedido pendiente asociado.');
        }
        
        await showMainMenu(chatId, username);
        break;
    }
  } catch (error) {
    console.error('Error en mensaje:', error);
    await bot.sendMessage(chatId, '❌ Ha ocurrido un error interno. Por favor escribe /start para reiniciar.');
    // Limpiamos estado corrupto
    if (userStates[chatId]) {
        delete userStates[chatId];
        await saveDB();
    }
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name;
  const data = query.data;

  // Siempre responder al callback para que deje de cargar el relojito en Telegram
  try {
      await bot.answerCallbackQuery(query.id);
  } catch (e) {
      // Ignorar error si el mensaje es muy viejo
  }

  try {
    if (data === 'cancel') {
      delete userStates[chatId];
      await saveDB(); // Guardamos el borrado
      await bot.sendMessage(chatId, '❌ Operación cancelada.');
      await showMainMenu(chatId, username);
      return;
    }

    switch(data) {
      case 'register':
        userStates[chatId] = { action: 'waiting_paypal', step: 1 };
        await saveDB(); // Guardamos que el usuario empezó el registro
        await bot.sendMessage(chatId, '📝 Paso 1/3\n\nEnvía tu email de PayPal:');
        break;

      case 'new_order':
        if (!db.users[chatId]) {
          await bot.sendMessage(chatId, '⚠️ No estás registrado. Usa la opción "Registrarme" primero.');
          // Pequeño fix: mostrar menú de nuevo
          await showMainMenu(chatId, username);
          return;
        }
        userStates[chatId] = { action: 'new_order_flow', step: 1 };
        await saveDB();
        await bot.sendMessage(chatId, '🛍️ Nuevo Pedido - Paso 1/3\n\nEnvía el Order ID de Amazon.\n\nEjemplo: 111-2233445-6677889');
        break;

      case 'send_review':
        if (!db.users[chatId]) {
          await bot.sendMessage(chatId, '⚠️ Regístrate primero.');
          await showMainMenu(chatId, username);
          return;
        }
        const userOrders = db.orders.filter(o => o.chatId === chatId && o.status === 'pending');
        if (userOrders.length === 0) {
          await bot.sendMessage(chatId, '⚠️ No tienes pedidos pendientes de review.');
          await showMainMenu(chatId, username);
          return;
        }
        userStates[chatId] = { action: 'waiting_review_link' };
        await saveDB();
        await bot.sendMessage(chatId, '⭐ Enviar Review\n\nEnvía el link de tu review.\n\nEjemplo: https://www.amazon.com/review/...');
        break;

      case 'my_status':
        const userOrdersList = db.orders.filter(o => o.chatId === chatId);
        if (userOrdersList.length === 0) {
          await bot.sendMessage(chatId, '📊 Sin pedidos aún.\n\nUsa el menú para crear uno.');
        } else {
          const pending = userOrdersList.filter(o => o.status === 'pending').length;
          const reviewed = userOrdersList.filter(o => o.reviewSubmitted).length;
          const paid = userOrdersList.filter(o => o.status === 'paid').length;
          const total = userOrdersList.reduce((sum, o) => sum + o.amount, 0);
          
          const user = db.users[chatId] || {};
          let statusMsg = `📊 Tu Estado\n\n` +
            `📦 Pedidos: ${userOrdersList.length}\n` +
            `⏳ Pendientes: ${pending}\n` +
            `✅ Reviews: ${reviewed}\n` +
            `💰 Pagados: ${paid}\n` +
            `💵 Total: $${total}`;
          
          if (user.intermediaries && user.intermediaries.length > 0) {
            statusMsg += `\n\n🔄 Intermediarios:\n${user.intermediaries.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`;
          }
          
          await bot.sendMessage(chatId, statusMsg);
        }
        await showMainMenu(chatId, username);
        break;
    }
  } catch (error) {
    console.error('Error en callback:', error);
    await bot.sendMessage(chatId, '❌ Ha ocurrido un error. Intenta de nuevo.');
    await showMainMenu(chatId, username);
  }
});

// ... resto del servidor express igual ...
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