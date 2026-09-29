'use strict';
/*
 * OptiTrace — modulo WALLET (cero claves, datos públicos de la cadena).
 *  - Bitcoin: saldo, recibido y nº de transacciones vía Blockstream (esplora).
 *  - Ethereum: saldo, nº de transacciones, nombre ENS y si es contrato vía Blockscout.
 *  - Enlaces a exploradores para seguir el rastro manualmente.
 * Una dirección muestra movimientos públicos; por sí sola no identifica a su dueño.
 */

const fmt = (n, dec) => (Number(n) / 10 ** dec).toLocaleString('es-ES', { maximumFractionDigits: 8 });

const btc = {
  id: 'wallet.btc', label: 'Bitcoin (Blockstream)', accepts: ['wallet'], order: 10,
  async run(entity, ctx) {
    const a = entity.value;
    if (/^0x/i.test(a)) return;
    const j = await ctx.http.getJson(`https://blockstream.info/api/address/${encodeURIComponent(a)}`, { timeout: 15000 });
    if (!j || !j.chain_stats) { ctx.log('  Bitcoin: dirección no válida o sin datos'); return; }
    const c = j.chain_stats, m = j.mempool_stats || {};
    const balance = (c.funded_txo_sum - c.spent_txo_sum) + ((m.funded_txo_sum || 0) - (m.spent_txo_sum || 0));
    ctx.node('fact', `${a.slice(0, 8)}… · BTC: saldo ${fmt(balance, 8)} · ${c.tx_count} transacciones`, {
      rel: 'saldo', source: 'Blockstream',
      data: { saldo_btc: fmt(balance, 8), recibido_btc: fmt(c.funded_txo_sum, 8), enviado_btc: fmt(c.spent_txo_sum, 8), transacciones: c.tx_count, pendientes: m.tx_count || 0 },
    });
    ctx.node('url', `https://mempool.space/address/${a}`, { rel: 'explorador', source: 'wallet', label: 'mempool.space (movimientos)' });
    ctx.node('url', `https://www.walletexplorer.com/address/${a}`, { rel: 'explorador', source: 'wallet', label: 'WalletExplorer (agrupación de direcciones)' });
    ctx.log(`  Bitcoin: saldo ${fmt(balance, 8)} BTC · ${c.tx_count} transacciones`);
  },
};

const eth = {
  id: 'wallet.eth', label: 'Ethereum (Blockscout)', accepts: ['wallet'], order: 11,
  async run(entity, ctx) {
    const a = entity.value;
    if (!/^0x[a-f0-9]{40}$/i.test(a)) return;
    const [j, cnt] = await Promise.all([
      ctx.http.getJson(`https://eth.blockscout.com/api/v2/addresses/${a}`, { timeout: 15000 }),
      ctx.http.getJson(`https://eth.blockscout.com/api/v2/addresses/${a}/counters`, { timeout: 15000 }),
    ]);
    if (!j) { ctx.log('  Ethereum: sin datos para esta dirección'); return; }
    const txs = (cnt && cnt.transactions_count) || '?';
    ctx.node('fact', `${a.slice(0, 8)}… · ETH: saldo ${fmt(j.coin_balance || 0, 18)} · ${txs} transacciones`, {
      rel: 'saldo', source: 'Blockscout',
      data: { saldo_eth: fmt(j.coin_balance || 0, 18), transacciones: txs, transferencias_tokens: (cnt && cnt.token_transfers_count) || '?', contrato: j.is_contract ? 'sí' : 'no', nombre: j.name || '' },
    });
    if (j.ens_domain_name) ctx.node('fact', `ENS: ${j.ens_domain_name}`, { rel: 'nombre ENS', source: 'Blockscout' });
    ctx.node('url', `https://etherscan.io/address/${a}`, { rel: 'explorador', source: 'wallet', label: 'Etherscan (movimientos)' });
    ctx.node('url', `https://eth.blockscout.com/address/${a}`, { rel: 'explorador', source: 'wallet', label: 'Blockscout' });
    ctx.log(`  Ethereum: saldo ${fmt(j.coin_balance || 0, 18)} ETH · ${txs} transacciones${j.ens_domain_name ? ' · ENS ' + j.ens_domain_name : ''}`);
  },
};

module.exports = [btc, eth];
