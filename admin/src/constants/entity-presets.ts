import type { Field } from "../types/entity";
import type { RelationType, Ownership, OnDelete } from "../types/relation";

export interface EntityPreset {
  name: string;
  displayName: string;
  description: string;
  fields: Field[];
  sampleRecords: Record<string, unknown>[];
  relatedEntity?: {
    name: string;
    fields: Field[];
    sampleRecords: Record<string, unknown>[];
  };
  relation?: {
    name: string;
    type: RelationType;
    sourceKey: string;
    targetKey: string;
    ownership: Ownership;
    onDelete: OnDelete;
  };
}

export const ENTITY_PRESETS: EntityPreset[] = [
  {
    name: "task",
    displayName: "Task Tracker",
    description: "A simple task list with priorities and status tracking",
    fields: [
      { name: "id", type: "uuid", required: true },
      { name: "title", type: "string", required: true },
      { name: "description", type: "text" },
      { name: "priority", type: "string", required: true, default: "medium", enum: ["low", "medium", "high"] },
      { name: "done", type: "boolean", required: true, default: false },
      { name: "created_at", type: "timestamp", required: true, auto: "create" },
      { name: "updated_at", type: "timestamp", required: true, auto: "update" },
    ],
    sampleRecords: [
      { title: "Set up project structure", priority: "high", done: false },
      { title: "Write documentation", priority: "medium", done: false },
      { title: "Configure deployment", priority: "low", done: false },
    ],
  },
  {
    name: "customer",
    displayName: "Customer Management",
    description: "Customers with orders — demonstrates entity relations",
    fields: [
      { name: "id", type: "uuid", required: true },
      { name: "first_name", type: "string", required: true },
      { name: "last_name", type: "string", required: true },
      { name: "email", type: "string", required: true, unique: true },
      { name: "phone", type: "string" },
      { name: "created_at", type: "timestamp", required: true, auto: "create" },
      { name: "updated_at", type: "timestamp", required: true, auto: "update" },
    ],
    sampleRecords: [
      { first_name: "Alice", last_name: "Johnson", email: "alice@example.com", phone: "+1-555-0101" },
      { first_name: "Bob", last_name: "Smith", email: "bob@example.com", phone: "+1-555-0102" },
    ],
    relatedEntity: {
      name: "order",
      fields: [
        { name: "id", type: "uuid", required: true },
        { name: "customer_id", type: "uuid", required: true },
        { name: "total", type: "decimal", required: true, precision: 2 },
        { name: "status", type: "string", required: true, default: "pending", enum: ["pending", "confirmed", "shipped", "delivered"] },
        { name: "created_at", type: "timestamp", required: true, auto: "create" },
      ],
      sampleRecords: [
        { total: 99.99, status: "confirmed" },
        { total: 249.50, status: "pending" },
      ],
    },
    relation: {
      name: "orders",
      type: "one_to_many",
      sourceKey: "id",
      targetKey: "customer_id",
      ownership: "source",
      onDelete: "cascade",
    },
  },
  {
    name: "product",
    displayName: "Product Catalog",
    description: "Products with pricing, SKU codes, and stock tracking",
    fields: [
      { name: "id", type: "uuid", required: true },
      { name: "name", type: "string", required: true },
      { name: "description", type: "text" },
      { name: "price", type: "decimal", required: true, precision: 2 },
      { name: "currency", type: "string", required: true, default: "USD" },
      { name: "sku", type: "string", unique: true },
      { name: "in_stock", type: "boolean", required: true, default: true },
      { name: "created_at", type: "timestamp", required: true, auto: "create" },
      { name: "updated_at", type: "timestamp", required: true, auto: "update" },
    ],
    sampleRecords: [
      { name: "Widget Pro", price: 29.99, currency: "USD", sku: "WGT-001", in_stock: true },
      { name: "Gadget Plus", price: 49.99, currency: "USD", sku: "GDG-001", in_stock: true },
      { name: "Gizmo Basic", price: 9.99, currency: "USD", sku: "GZM-001", in_stock: false },
    ],
  },
];

export const CUSTOM_PRESET_KEY = "__custom__";
