# 🚀 Guía de Migración - Bot de Telegram a Railway/Fly.io

## 📋 Requisitos Previos

1. **Cuenta en GitHub** (gratuita)
2. **Cuenta en Railway** o **Fly.io** (ambas gratuitas)
3. **Archivo .env** con tus variables de entorno

---

## 🎯 Opción 1: Railway (RECOMENDADO - Más Fácil)

### Paso 1: Preparar el código

1. Renombra el archivo `IDEX SOLO FALTA COLOR AMARILLO.txt` a `bot.js`
2. Asegúrate de tener todos los archivos en el directorio:
   - `bot.js` (tu código principal)
   - `package.json`
   - `.env` (con tus variables de entorno)
   - `railway.json`

### Paso 2: Subir a GitHub

```bash
# Inicializar repositorio (si no lo tienes)
git init
git add .
git commit -m "Initial commit - Bot Telegram AmazonFlow"
git branch -M main

# Crear repositorio en GitHub y luego:
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

### Paso 3: Conectar con Railway

1. Ve a [railway.app](https://railway.app)
2. Inicia sesión con GitHub
3. Click en **"New Project"**
4. Selecciona **"Deploy from GitHub repo"**
5. Elige tu repositorio
6. Railway detectará automáticamente Node.js

### Paso 4: Configurar Variables de Entorno

En Railway:
1. Ve a tu proyecto
2. Click en **"Variables"**
3. Añade todas las variables de tu `.env`:
   - `TELEGRAM_TOKEN`
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_SHEET_ID`
   - `PORT` (opcional, Railway lo asigna automáticamente)

### Paso 5: Desplegar

Railway desplegará automáticamente. Verás los logs en tiempo real.

**✅ Ventajas de Railway:**
- $5 gratis al mes
- Sin límites estrictos de tiempo
- Muy fácil de usar
- Despliegue automático desde GitHub

---

## 🎯 Opción 2: Fly.io

### Paso 1: Instalar Fly CLI

**Windows (PowerShell):**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

**O descarga desde:** https://fly.io/docs/getting-started/installing-flyctl/

### Paso 2: Preparar el código

1. Renombra `IDEX SOLO FALTA COLOR AMARILLO.txt` a `bot.js`
2. Asegúrate de tener `fly.toml` en el directorio

### Paso 3: Iniciar sesión en Fly.io

```bash
fly auth login
```

### Paso 4: Crear la aplicación

```bash
fly launch
```

Sigue las instrucciones:
- Nombre de la app: `telegram-bot-amazonflow` (o el que prefieras)
- Región: elige la más cercana (ej: `iad` para Virginia, `mad` para Madrid)
- No crear Postgres (no lo necesitas)
- No crear Redis (no lo necesitas)

### Paso 5: Configurar Variables de Entorno

```bash
fly secrets set TELEGRAM_TOKEN="tu_token_aqui"
fly secrets set GOOGLE_CLIENT_EMAIL="tu_email_aqui"
fly secrets set GOOGLE_PRIVATE_KEY="tu_private_key_aqui"
fly secrets set GOOGLE_SHEET_ID="tu_sheet_id_aqui"
```

**⚠️ IMPORTANTE:** Para `GOOGLE_PRIVATE_KEY`, necesitas escapar los saltos de línea:
```bash
fly secrets set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTU_KEY_AQUI\n-----END PRIVATE KEY-----"
```

### Paso 6: Desplegar

```bash
fly deploy
```

**✅ Ventajas de Fly.io:**
- Plan gratuito generoso
- Control total
- Múltiples regiones

---

## 🔧 Configuración Adicional

### Cambiar el nombre del archivo principal

Si tu archivo se llama diferente a `bot.js`, actualiza `package.json`:

```json
"main": "TU_ARCHIVO.js",
"scripts": {
  "start": "node TU_ARCHIVO.js"
}
```

### Variables de Entorno Necesarias

Asegúrate de tener estas variables en tu `.env` o en el panel de Railway/Fly.io:

```
TELEGRAM_TOKEN=tu_token_de_telegram
GOOGLE_CLIENT_EMAIL=tu_email_del_service_account
GOOGLE_PRIVATE_KEY=tu_private_key_completa
GOOGLE_SHEET_ID=id_de_tu_google_sheet
PORT=10000
```

### Para Railway: Configurar el puerto

Railway asigna el puerto automáticamente. Tu código ya está preparado con:
```javascript
const PORT = process.env.PORT || 10000;
```

### Para Fly.io: Mantener el bot activo

El archivo `fly.toml` ya está configurado con:
- `auto_stop_machines = false` - No se detiene automáticamente
- `min_machines_running = 1` - Siempre hay 1 máquina corriendo

---

## 🐛 Solución de Problemas

### El bot se detiene después de 15 minutos (Render)

✅ **Solución:** Migra a Railway o Fly.io (ambos mantienen el bot activo 24/7)

### Error: "Cannot find module"

✅ **Solución:** Asegúrate de que `package.json` tiene todas las dependencias y ejecuta `npm install` localmente antes de subir.

### Error con GOOGLE_PRIVATE_KEY

✅ **Solución:** En Railway/Fly.io, pega la clave completa incluyendo `\n` o usa comillas dobles.

### El bot no responde

✅ **Solución:** 
1. Verifica los logs en Railway/Fly.io
2. Asegúrate de que todas las variables de entorno están configuradas
3. Verifica que el token de Telegram es correcto

---

## 📊 Comparación de Servicios

| Característica | Railway | Fly.io | Render (Actual) |
|---------------|---------|--------|-----------------|
| Plan Gratuito | $5/mes | Generoso | Muy limitado |
| Tiempo Activo | 24/7 | 24/7 | 15 min timeout |
| Facilidad | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Control | Medio | Alto | Medio |

---

## ✅ Checklist Final

- [ ] Archivo renombrado a `bot.js`
- [ ] `package.json` creado
- [ ] Código subido a GitHub
- [ ] Variables de entorno configuradas
- [ ] Bot desplegado y funcionando
- [ ] Logs verificados (sin errores)

---

## 🆘 ¿Necesitas Ayuda?

Si tienes problemas:
1. Revisa los logs en Railway/Fly.io
2. Verifica que todas las variables de entorno están correctas
3. Asegúrate de que el código funciona localmente primero

¡Buena suerte con la migración! 🚀

