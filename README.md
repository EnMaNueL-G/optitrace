# 🔎 OptiTrace

**Inteligencia de Fuentes Abiertas (OSINT) de escritorio — gratis y de código abierto.**

OptiTrace reúne información **pública y legal** sobre un dato (usuario, correo, dominio, IP,
teléfono o imagen) y la presenta en una **lista clara** o en un **mapa de conexiones** que
puedes pivotar. Pensado para investigación profesional y defensiva: antifraude, *due
diligence*, RRHH, protección de marca y periodismo.

Parte de la suite [OptiSuite](https://optisuite.app).

---

## ✨ Características

- **Cuentas por usuario** — busca el handle en **~3000 sitios** (motor de [Maigret](https://github.com/soxoj/maigret)).
- **Cuentas por email** — comprueba registro en servicios (Yahoo, Xvideos, Spotify, Twitter/X, GitHub…) con la técnica de [Holehe](https://github.com/megadose/holehe), y barre además los ~3000 sitios con la parte del correo.
- **Dominio** — DNS completo, RDAP/WHOIS y subdominios vía *certificate transparency* (crt.sh).
- **IP** — geolocalización, ASN/ISP y DNS inverso.
- **Teléfono** — país, operadora y validez (100% local, sin enviar el número).
- **Imagen** — EXIF/GPS local + búsqueda inversa (Google Lens, Yandex, Bing, TinEye).
- **Brechas** — HaveIBeenPwned (con clave gratuita propia, opcional).
- **Interfaz simple** en lista, tema *glass* adaptativo (claro/oscuro), e **informe exportable**.
- **Privacidad** — todo corre en tu equipo; claves API opcionales (BYOK) y proxy de salida.

---

## 🚀 Uso (desarrollo)

```bash
npm install
npm start
```

Verificación rápida sin abrir ventana:

```bash
npm run selftest                 # comprueba motor y módulos
npx electron . --probe "github"  # expande una entidad y vuelca resultados
```

---

## 🧱 Arquitectura

Motor de *transforms* (`src/main/engine.js`): cada módulo en `src/main/modules/` acepta un
tipo de entidad y produce **nodos + relaciones** que se integran en un grafo deduplicado y
pivotable. El renderer (`src/renderer/`) pinta la lista y el mapa; la ventana es segura
(contextIsolation, sin nodeIntegration).

---

## ⚖️ Uso responsable

OptiTrace consulta **solo fuentes abiertas y endpoints públicos**. No accede a datos privados,
no inicia sesión y no rompe protecciones. Úsalo con base legítima y conforme a la legislación
aplicable de tu jurisdicción (p. ej. RGPD). El responsable del uso es quien lo opera.

---

## 🙏 Créditos y licencias de terceros

- [Maigret](https://github.com/soxoj/maigret) — dataset de sitios por usuario (MIT).
- [Holehe](https://github.com/megadose/holehe) — técnicas de verificación por email (GPL-3.0).
- [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) — referencia de enumeración.
- [exifr](https://github.com/MikeKovarik/exifr) y [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js).

## 📄 Licencia

**GPL-3.0** — ver [LICENSE](LICENSE). Software libre; se distribuye sin garantía.
© 2026 OptiSuite.
