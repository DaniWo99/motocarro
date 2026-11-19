# Mi Motocarro — Sistema de Gestión Financiera (PWA)

Aplicación web progresiva (PWA) gratuita, privada y responsive diseñada para administrar tu negocio de alquiler de motocarro y controlar el préstamo de Rappi (36 cuotas) desde tu **iPhone** y tu **PC**, con funcionamiento sin conexión y sincronización automática en la nube.

---

## Arquitectura elegida: GitHub Pages + Supabase + IndexedDB

| Criterio | Alternativa A (GitHub Pages + Supabase + IndexedDB) | Alternativa B (GitHub Pages + Apps Script + Sheets) |
| --- | --- | --- |
| **Costo** | 100% gratis (plan Free: 500 MB DB, 50.000 usuarios) | 100% gratis (con cuotas diarias de ejecución) |
| **Facilidad de configuración** | **Muy alta**: 1 solo archivo SQL + copiar 2 datos | Media-baja: crear hojas exactas, publicar Web App y gestionar versiones |
| **Seguridad y privacidad** | **Real**: Supabase Auth + Row Level Security (`auth.uid() = user_id`) | Frágil: requiere publicar Web App como "Cualquier persona" y programar seguridad manual |
| **Sincronización iPhone ↔ PC** | Rápida (<200 ms), sin problemas de CORS en Safari iOS | Lenta (1–3 s) y propensa a bloqueos CORS / redirecciones 302 en Safari |
| **Prevención de duplicados** | Nativa con claves únicas (`upsert` por `id` y fecha) | Requiere lógica manual propensa a colisiones |

**Conclusión:** Se eligió la **Alternativa A** porque ofrece seguridad real (solo tú puedes leer o modificar tus registros), funciona sin fallos en Safari de iPhone, evita duplicados al sincronizar desde modo sin conexión y se configura en menos de 10 minutos.

---

## Estructura del proyecto

```text
mi-motocarro/
├── index.html               # Aplicación principal (PWA)
├── manifest.webmanifest     # Manifiesto instalable en iPhone y PC
├── sw.js                    # Service Worker (funcionamiento sin conexión)
├── .nojekyll                # Evita interferencias de Jekyll en GitHub Pages
├── css/
│   └── styles.css           # Modo oscuro permanente sin gradientes, responsive
├── js/
│   ├── config.js            # URL y clave pública (anon key) de Supabase
│   ├── loan-data.js         # Calendario oficial exacto de las 36 cuotas de Rappi
│   ├── utils.js             # Formato COP, hora America/Bogota, regla 8:30 p. m.
│   ├── db.js                # Almacenamiento local IndexedDB + cola offline + respaldos
│   ├── sync.js              # Autenticación Supabase Auth + sincronización bidireccional
│   ├── finance.js           # Motor financiero (KPIs, flujo de caja vs utilidad, proyecciones)
│   ├── charts.js            # Gráficos planos en Canvas nativo (sin librerías de pago)
│   └── app.js               # Controlador de interfaz
├── assets/
│   ├── icon-192.png         # Icono PWA 192x192
│   └── icon-512.png         # Icono PWA 512x512
├── supabase/
│   └── schema.sql           # Script SQL único de tablas y políticas de seguridad RLS
└── README.md                # Esta guía
```

---

## Guía de configuración paso a paso (para principiantes)

No necesitas instalar programas de programación ni pagar servidores. Solo sigue estos pasos en orden desde tu computador:

### Paso 1: Crear tus dos cuentas gratuitas
1. **GitHub** (para publicar la app): entra a [github.com](https://github.com), pulsa **Sign up** y crea tu cuenta gratuita.
2. **Supabase** (para guardar tus datos en la nube): entra a [supabase.com](https://supabase.com), pulsa **Start your project** y regístrate (puedes usar tu cuenta de GitHub o tu correo).

### Paso 2: Crear la base de datos en Supabase
1. Dentro de Supabase, pulsa el botón verde **New project**.
2. Ponle nombre `mi-motocarro`, elige una contraseña segura para la base de datos (guárdala en un lugar seguro) y selecciona la región más cercana (por ejemplo `East US` o `South America`). Pulsa **Create new project** y espera ~1 minuto.
3. En el menú izquierdo de Supabase, haz clic en **SQL Editor** → **New query**.
4. Abre el archivo `supabase/schema.sql` de este proyecto, copia todo su contenido, pégalo en el editor de Supabase y pulsa **Run** (debe mostrar `Success`).

### Paso 3: Crear tu usuario privado en Supabase
1. En el menú izquierdo de Supabase, entra a **Authentication** → **Users**.
2. Pulsa **Add user** → **Create new user**.
3. Escribe tu correo y la contraseña que usarás para entrar a **Mi Motocarro**, marca **Auto Confirm User** y pulsa **Create user**.
4. *(Opcional pero recomendado)* En **Authentication** → **Sign In / Providers** → **Email**, puedes desactivar **Enable Signups** después de crear tu usuario para que nadie más pueda registrarse.

### Paso 4: Obtener las dos credenciales públicas
1. En el menú izquierdo de Supabase, ve a **Project Settings** (icono de engranaje) → **API** (o **Data API** / **API Keys**).
2. Copia estos dos datos:
   - **Project URL** (ejemplo: `https://abcdefghijk.supabase.co`).
   - **anon / public key** (o *Publishable key*). **Nunca** copies la clave `service_role` / *secret*.
3. Abre el archivo `js/config.js` en tu computador con el Bloc de notas y pega ambos valores entre las comillas:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
     SUPABASE_ANON_KEY: "TU-CLAVE-PUBLICA-ANON"
   };
   ```
   Guarda el archivo. *(Si prefieres, también puedes ingresarlos directamente dentro de la app tocando el botón "Configurar Supabase" en la pantalla de inicio).*

### Paso 5: Subir el proyecto a GitHub y publicar en GitHub Pages
1. Entra a [github.com](https://github.com) y pulsa el botón **+** (arriba a la derecha) → **New repository**.
2. Nombre del repositorio: `mi-motocarro`. Déjalo en **Public** (GitHub Pages gratuito requiere repositorio público; tus datos siguen 100% privados en Supabase gracias a RLS) y pulsa **Create repository**.
3. En la pantalla del repositorio nuevo, haz clic en el enlace **uploading an existing file**.
4. Arrastra **todos los archivos y carpetas que están dentro de `mi-motocarro/`** (asegúrate de que `index.html` quede en la raíz del repositorio) y pulsa el botón verde **Commit changes**.
5. Ahora entra a la pestaña **Settings** del repositorio → menú izquierdo **Pages**.
6. En **Build and deployment** → **Branch**, selecciona `main` y carpeta `/ (root)`, y pulsa **Save**.
7. Espera 1 a 2 minutos y recarga esa misma página: verás tu enlace permanente:
   `https://TU-USUARIO.github.io/mi-motocarro/`

### Paso 6: Abrir e instalar en tu iPhone (Safari)
1. Abre **Safari** en tu iPhone y entra a `https://TU-USUARIO.github.io/mi-motocarro/`.
2. Inicia sesión con el correo y contraseña que creaste en el Paso 3.
3. Para instalarla como app en la pantalla de inicio:
   - Toca el botón **Compartir** (cuadrado con flecha hacia arriba en la barra inferior de Safari).
   - Desliza hacia abajo y toca **Agregar a inicio** (*Add to Home Screen*).
   - Toca **Agregar**. Ahora tendrás el icono de **Mi Motocarro** en tu iPhone y abrirá a pantalla completa.

### Paso 7: Abrir en tu PC y comprobar la sincronización
1. En tu PC (Google Chrome o Edge), abre el mismo enlace `https://TU-USUARIO.github.io/mi-motocarro/` e inicia sesión con el mismo correo y contraseña.
2. En Chrome/Edge puedes instalarla como app de escritorio haciendo clic en el icono de **Instalar** en el lado derecho de la barra de direcciones.
3. **Prueba rápida de sincronización:**
   - En tu **iPhone**, ve a **Ingresos diarios** (o usa *Registrar o corregir otro día* si aún no son las 8:30 p. m.) y registra un ingreso de `$40.000`.
   - Verifica que arriba aparezca la etiqueta verde **Sincronizado**.
   - Abre la app en tu **PC** (o pulsa el botón **Sincronizado** arriba a la derecha): el ingreso de `$40.000` aparecerá automáticamente.
   - Si alguna vez registras un pago sin internet, verás la etiqueta amarilla **Sin conexión (1)**; al recuperar señal, se sincronizará automáticamente sin duplicarse.
