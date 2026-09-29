# 🔎 OptiTrace

**Búsqueda de información pública (OSINT) de escritorio para Windows — gratis y software libre (GPL-3.0).**

OptiTrace reúne información **pública** sobre un dato (usuario, correo, dominio, web, IP,
teléfono o imagen) y la presenta en una **lista clara** o en un **mapa de conexiones** que
puedes pivotar. Pensado para investigación profesional y defensiva: seguridad, antifraude,
verificación, protección de marca, periodismo o revisar tu propia huella digital.

Parte de la suite [OptiSuite](https://optisuite.app).

---

## ✨ Qué hace

- **Usuario** — busca el nombre de usuario en los **1500 sitios más populares** del conjunto de
  datos de [Maigret](https://github.com/soxoj/maigret) (≈2500 sitios activos; en Ajustes puedes
  elegir revisarlos todos). Los sitios que bloquean la consulta (antibot, captcha) o no responden
  se cuentan aparte como **«sin respuesta clara»**: nunca como «sí» ni como «no».
- **Correo** — MX, perfil público de Gravatar y registro en **Yahoo, Spotify, Duolingo y GitHub**
  (técnica de [Holehe](https://github.com/megadose/holehe)). Además busca la parte anterior a la @
  como alias en los sitios de Maigret; esos resultados se muestran aparte como **«posibles, no
  confirmados con el correo»**, porque otra persona puede usar el mismo nombre.
- **Dominio y web** — DNS, RDAP/WHOIS, subdominios por *certificate transparency* (crt.sh) y
  primera/última captura en **Wayback Machine**.
- **IP** — ubicación aproximada y ASN (ipwho.is), titular del bloque (RDAP), DNS inverso y
  **puertos/CVE conocidos** del escaneo público de Shodan InternetDB (sin clave).
- **Teléfono** — país, tipo de línea (móvil/fijo…) y validez, **sin conexión** (libphonenumber).
  No da la operadora: con la portabilidad, el prefijo no la determina.
- **Imagen** — metadatos EXIF/GPS de un archivo de tu equipo + enlaces de búsqueda inversa
  (Google Lens, Yandex, Bing, TinEye).
- **Filtraciones** — HaveIBeenPwned, con tu propia clave (de pago en haveibeenpwned.com).
- **Informe** exportable en **HTML o PDF**, botón **Cancelar**, progreso en vivo y aviso de
  versión nueva.

### Categorías sensibles (desactivadas por defecto)

Comprobar si un correo o usuario existe en **sitios para adultos o de citas** revela datos sobre la
vida sexual de una persona, especialmente protegidos por la ley (RGPD art. 9, Ley 1581 de 2012
art. 5). Por eso esas consultas **no se hacen** salvo que las actives en Ajustes (con aviso), y
se excluyen del informe salvo que lo marques.

## 🔒 Privacidad

- Sin telemetría, sin anuncios, sin cuenta y sin servidor propio.
- **Lo que buscas sí sale de tu equipo**: se envía directamente a las fuentes consultadas (DNS,
  rdap.org, crt.sh, archive.org, ipwho.is, Shodan InternetDB, Gravatar y los sitios revisados),
  nunca a OptiSuite. El análisis de teléfono y el EXIF de un archivo local no usan la red.
- Proxy de salida opcional (http/https) para las consultas web. Si el proxy no funciona, las
  búsquedas **fallan** en lugar de salir directas. Las consultas DNS no pasan por el proxy.
- La clave de HaveIBeenPwned y el proxy se guardan **cifrados** con el almacén seguro de Windows.

---

## 📥 Descarga

[**OptiTrace-Portable.zip**](https://github.com/EnMaNueL-G/optitrace/releases/latest/download/OptiTrace-Portable.zip)
(Windows 10/11, 64 bits). Extrae el ZIP y abre `OptiTrace.exe`; no hace falta instalar.

## 🚀 Desarrollo

```bash
npm install
npm start                        # abrir la app
npm run selftest                 # comprueba motor y módulos (usa la red)
npx electron . --probe "github"  # expande una entidad y vuelca resultados
npm run build                    # portable verificado → dist/OptiTrace-Portable-v<versión>.zip
```

## 🧱 Arquitectura

Motor de *transforms* (`src/main/engine.js`): cada módulo de `src/main/modules/` acepta un tipo
de entidad y produce **nodos + relaciones** que se integran en un grafo deduplicado y pivotable.
El renderer (`src/renderer/`) pinta la lista y el mapa. Ventana aislada: `contextIsolation`,
`sandbox`, sin `nodeIntegration`, sin navegación, IPC solo desde la propia página y CSP estricta.

---

## ⚖️ Uso responsable

OptiTrace consulta **solo fuentes abiertas y endpoints públicos**: no inicia sesión, no accede a
datos privados y no rompe protecciones. Úsalo con una finalidad legítima y conforme a la ley de tu
país. Está prohibido usarlo para acosar, extorsionar, exponer o intimidar a nadie. El responsable
del uso es quien lo opera.

## 🙏 Créditos y licencias de terceros

- [Maigret](https://github.com/soxoj/maigret) — conjunto de datos de sitios por usuario (MIT, ver `data/MAIGRET-LICENSE.txt`).
- [Holehe](https://github.com/megadose/holehe) — técnicas de verificación por correo (GPL-3.0).
- [exifr](https://github.com/MikeKovarik/exifr), [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) y [undici](https://github.com/nodejs/undici) (MIT).

## 📄 Licencia

**GPL-3.0-or-later** — ver [LICENSE](LICENSE). Software libre; se distribuye sin garantía.
© 2026 Enmanuel Gil · OptiSuite.
