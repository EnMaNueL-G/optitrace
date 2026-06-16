'use strict';
/*
 * OptiTrace — tipado y normalizacion de entidades.
 * El detector convierte texto suelto en una entidad tipada para que el motor sepa
 * que transforms aplicar. El orden importa: lo mas especifico primero.
 */

const RE = {
  email: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
  ipv6: /^(?:[a-f0-9]{1,4}:){2,7}[a-f0-9]{0,4}$/i,
  url: /^https?:\/\/\S+$/i,
  domain: /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,24}$/i,
  phone: /^\+?[0-9][0-9\s().-]{6,18}[0-9]$/,
  md5: /^[a-f0-9]{32}$/i,
  sha1: /^[a-f0-9]{40}$/i,
  sha256: /^[a-f0-9]{64}$/i,
  btc: /^(?:bc1[a-z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  eth: /^0x[a-f0-9]{40}$/i,
  username: /^@?[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/i,
};

/** Iconos/etiquetas legibles por tipo (para la UI y los informes). */
const META = {
  username: { label: 'Usuario', icon: '👤', color: '#7c5cff' },
  email: { label: 'Email', icon: '✉️', color: '#19c37d' },
  domain: { label: 'Dominio', icon: '🌐', color: '#3b82f6' },
  subdomain: { label: 'Subdominio', icon: '🔗', color: '#60a5fa' },
  url: { label: 'URL', icon: '📄', color: '#38bdf8' },
  ip: { label: 'IP', icon: '📡', color: '#f59e0b' },
  phone: { label: 'Teléfono', icon: '📞', color: '#ec4899' },
  person: { label: 'Persona', icon: '🧑', color: '#a78bfa' },
  account: { label: 'Cuenta', icon: '🆔', color: '#22d3ee' },
  org: { label: 'Organización', icon: '🏢', color: '#94a3b8' },
  location: { label: 'Ubicación', icon: '📍', color: '#ef4444' },
  image: { label: 'Imagen', icon: '🖼️', color: '#f472b6' },
  hash: { label: 'Hash', icon: '#️⃣', color: '#cbd5e1' },
  wallet: { label: 'Wallet', icon: '🪙', color: '#eab308' },
  breach: { label: 'Brecha', icon: '🔓', color: '#dc2626' },
  asn: { label: 'ASN/Red', icon: '🛰️', color: '#fb923c' },
  dns: { label: 'Registro DNS', icon: '🧭', color: '#64748b' },
  note: { label: 'Nota', icon: '📝', color: '#94a3b8' },
};

/** Detecta el tipo de una cadena. Devuelve {type, value} normalizado. */
function detect(raw) {
  let v = String(raw || '').trim();
  if (!v) return null;
  // Imagen: URL o ruta local con extensión de imagen.
  if (/\.(jpe?g|png|gif|webp|tiff?|heic|bmp)$/i.test(v) && (RE.url.test(v) || /[\\/]/.test(v))) return { type: 'image', value: v };
  if (RE.url.test(v)) return { type: 'url', value: v };
  if (RE.email.test(v)) return { type: 'email', value: v.toLowerCase() };
  if (RE.ipv4.test(v) || RE.ipv6.test(v)) return { type: 'ip', value: v };
  if (RE.eth.test(v) || RE.btc.test(v)) return { type: 'wallet', value: v };
  if (RE.md5.test(v) || RE.sha1.test(v) || RE.sha256.test(v)) return { type: 'hash', value: v.toLowerCase() };
  // Telefono: requiere que parezca numero (al quitar separadores quedan 7-15 digitos).
  const digits = v.replace(/[\s().-]/g, '');
  if (RE.phone.test(v) && /^\+?\d{7,15}$/.test(digits)) return { type: 'phone', value: digits.startsWith('+') ? digits : v.startsWith('+') ? '+' + digits : digits };
  if (RE.domain.test(v)) return { type: 'domain', value: v.toLowerCase() };
  if (RE.username.test(v)) return { type: 'username', value: v.replace(/^@/, '') };
  // Por defecto: persona (texto libre con espacios) o usuario.
  if (/\s/.test(v)) return { type: 'person', value: v };
  return { type: 'username', value: v };
}

/** id estable de un nodo del grafo. */
function nodeId(type, value) { return `${type}:${String(value).toLowerCase()}`; }

module.exports = { detect, nodeId, META, RE };
