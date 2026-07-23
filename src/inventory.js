import { encryptJson, decryptJson } from './crypto.js';
import { query, transaction } from './db.js';

function normalizePayload(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  const delimiter = raw.includes('|') ? '|' : raw.includes('\t') ? '\t' : raw.includes(',') ? ',' : raw.includes(';') ? ';' : raw.includes(':') ? ':' : null;
  const parts = delimiter ? raw.split(delimiter).map((part) => part.trim()) : [raw];
  if (parts.length >= 3) return { email: parts[0], password: parts[1], two_factor: parts.slice(2).join(delimiter) };
  if (parts.length === 2) return { email: parts[0], password: parts[1] };
  return { email: parts[0] };
}

export function parseInventoryText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(normalizePayload)
    .filter(Boolean);
}

export async function addInventory({ variantId, stockMode, text, capacity = 5, expiresAt = null }) {
  const payloads = parseInventoryText(text);
  if (!payloads.length) throw new Error('EMPTY_INVENTORY');

  return transaction(async (client) => {
    let created = 0;
    for (const payload of payloads) {
      const label = payload.email || payload.username || payload.code || `Item ${created + 1}`;
      if (stockMode === 'SHARED_SLOT') {
        const group = await client.query(
          `INSERT INTO inventory_groups(variant_id,label,encrypted_credentials,capacity,expires_at)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [variantId, label, encryptJson(payload), Number(capacity), expiresAt || null],
        );
        for (let index = 1; index <= Number(capacity); index += 1) {
          await client.query(
            `INSERT INTO inventory_slots(group_id,slot_name,encrypted_pin,metadata)
             VALUES($1,$2,$3,$4::jsonb)`,
            [group.rows[0].id, `Slot ${index}`, null, JSON.stringify({ position: index })],
          );
        }
      } else {
        await client.query(
          `INSERT INTO inventory_items(variant_id,label,encrypted_payload,expires_at)
           VALUES($1,$2,$3,$4)`,
          [variantId, label, encryptJson(payload), expiresAt || null],
        );
      }
      created += 1;
    }
    return created;
  });
}

export async function getVariantStock(variantId) {
  const result = await query(
    `SELECT
       (SELECT COUNT(*) FROM inventory_slots s JOIN inventory_groups g ON g.id=s.group_id WHERE g.variant_id=$1 AND g.active=TRUE AND s.status='AVAILABLE')::int AS shared_available,
       (SELECT COUNT(*) FROM inventory_items i WHERE i.variant_id=$1 AND i.status='AVAILABLE')::int AS item_available`,
    [variantId],
  );
  return result.rows[0];
}

export async function listInventoryForVariant(variantId) {
  const groups = await query(
    `SELECT g.*, COUNT(s.id)::int AS slots_total,
      COUNT(*) FILTER (WHERE s.status='AVAILABLE')::int AS slots_available,
      COUNT(*) FILTER (WHERE s.status='SOLD')::int AS slots_sold
     FROM inventory_groups g LEFT JOIN inventory_slots s ON s.group_id=g.id
     WHERE g.variant_id=$1 GROUP BY g.id ORDER BY g.created_at DESC`, [variantId],
  );
  const items = await query(
    `SELECT id,label,status,expires_at,created_at FROM inventory_items WHERE variant_id=$1 ORDER BY created_at DESC`, [variantId],
  );
  return { groups: groups.rows, items: items.rows };
}

export async function revealGroup(groupId) {
  const result = await query(`SELECT encrypted_credentials FROM inventory_groups WHERE id=$1`, [groupId]);
  return result.rows[0] ? decryptJson(result.rows[0].encrypted_credentials) : null;
}
