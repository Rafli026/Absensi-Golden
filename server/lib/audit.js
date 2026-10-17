// Audit logging helper.
import { isoUtc } from './time.js';

/**
 * Append an audit log row.
 */
export function writeAudit(db, { actorId = null, actorName = null, action, entity = null, entityId = null, detail = null, ip = null }) {
  db.prepare(
    `INSERT INTO audit_logs (actor_id, actor_name, action, entity, entity_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actorId,
    actorName,
    action,
    entity,
    entityId != null ? String(entityId) : null,
    detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
    ip,
    isoUtc()
  );
}
