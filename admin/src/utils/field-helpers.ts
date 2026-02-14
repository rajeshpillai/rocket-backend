import type { Field, EntityDefinition } from "../types/entity";

/** Get writable fields for an entity (skip auto-generated timestamps and PKs). */
export function writableFields(entity: EntityDefinition, isCreate: boolean): Field[] {
  return entity.fields.filter((f) => {
    if (f.auto) return false;
    if (
      isCreate &&
      f.name === entity.primary_key.field &&
      entity.primary_key.generated
    ) {
      return false;
    }
    if (!isCreate && f.name === entity.primary_key.field) return false;
    return true;
  });
}

/** Map a field type to an HTML input type. */
export function inputType(fieldType: string): string {
  switch (fieldType) {
    case "int":
    case "bigint":
    case "decimal":
      return "number";
    case "boolean":
      return "checkbox";
    case "timestamp":
      return "datetime-local";
    case "date":
      return "date";
    default:
      return "text";
  }
}

/** Convert a string form value to the correct JS type for a field. */
export function coerceFieldValue(raw: string, field: Field): unknown {
  if (raw === "" && !field.required) return undefined; // skip empty non-required

  switch (field.type) {
    case "int":
    case "bigint":
      return raw ? parseInt(raw, 10) : null;
    case "decimal":
      return raw ? parseFloat(raw) : null;
    case "boolean":
      return raw === "true" || raw === "on";
    case "json":
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return raw;
      }
    case "file":
      return raw || null;
    default:
      return raw || null;
  }
}
