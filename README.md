# 🤖 Bot de Telegram - AmazonFlow

Bot de gestión de pedidos de Amazon con integración a Google Sheets.

## 🚀 Inicio Rápido

### Opción 1: Railway (Recomendado)

1. **Sube tu código a GitHub**
2. Ve a [railway.app](https://railway.app) e inicia sesión
3. Click en **"New Project"** → **"Deploy from GitHub repo"**
4. Elige tu repositorio
5. Añade las variables de entorno en Railway:
   - `TELEGRAM_TOKEN`
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_SHEET_ID`
6. ¡Listo! El bot se desplegará automáticamente.

### Opción 2: Fly.io

1. Instala Fly CLI: `iwr https://fly.io/install.ps1 -useb | iex`
2. Inicia sesión: `fly auth login`
3. Crea la app: `fly launch`
4. Configura variables: `fly secrets set VARIABLE="valor"`
5. Despliega: `fly deploy`

## 📋 Variables de Entorno

```
TELEGRAM_TOKEN=tu_token_de_telegram
GOOGLE_CLIENT_EMAIL=tu_email_del_service_account
GOOGLE_PRIVATE_KEY=tu_private_key_completa
GOOGLE_SHEET_ID=id_de_tu_google_sheet
PORT=10000
```

## 📦 Instalación Local

```bash
npm install
node bot.js
```

## 📚 Documentación Completa

Ver `MIGRACION.md` para instrucciones detalladas.

## ✨ Características

- ✅ Gestión de pedidos de Amazon
- ✅ Integración con Google Sheets
- ✅ Sistema de estados con colores
- ✅ Sincronización automática
- ✅ Columna COMISION con desplegable
- ✅ Notificaciones automáticas

---

**Versión:** 2.0.0  
**Última actualización:** 2024

