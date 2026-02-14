import type { Field } from "../types/entity";

export interface FieldTemplate {
  label: string;
  description: string;
  fields: Field[];
}

export const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    label: "Timestamps",
    description: "created_at + updated_at",
    fields: [
      { name: "created_at", type: "timestamp", required: true, auto: "create" },
      { name: "updated_at", type: "timestamp", required: true, auto: "update" },
    ],
  },
  {
    label: "Name",
    description: "first_name + last_name",
    fields: [
      { name: "first_name", type: "string", required: true },
      { name: "last_name", type: "string", required: true },
    ],
  },
  {
    label: "Contact",
    description: "email + phone",
    fields: [
      { name: "email", type: "string", required: true, unique: true },
      { name: "phone", type: "string" },
    ],
  },
  {
    label: "Address",
    description: "street, city, state, zip, country",
    fields: [
      { name: "street", type: "string" },
      { name: "city", type: "string" },
      { name: "state", type: "string" },
      { name: "zip", type: "string" },
      { name: "country", type: "string" },
    ],
  },
  {
    label: "Status",
    description: "status enum (active / inactive / archived)",
    fields: [
      { name: "status", type: "string", required: true, default: "active", enum: ["active", "inactive", "archived"] },
    ],
  },
  {
    label: "Money",
    description: "amount + currency",
    fields: [
      { name: "amount", type: "decimal", required: true, precision: 2 },
      { name: "currency", type: "string", required: true, default: "USD" },
    ],
  },
  {
    label: "Description",
    description: "title + description",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "description", type: "text" },
    ],
  },
  {
    label: "SEO",
    description: "title + slug + meta_description",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "slug", type: "string", required: true, unique: true },
      { name: "meta_description", type: "text" },
    ],
  },
  {
    label: "Notes",
    description: "notes text field",
    fields: [
      { name: "notes", type: "text" },
    ],
  },
  {
    label: "Metadata",
    description: "metadata JSON field",
    fields: [
      { name: "metadata", type: "json" },
    ],
  },
  {
    label: "Active Flag",
    description: "active boolean",
    fields: [
      { name: "active", type: "boolean", required: true, default: true },
    ],
  },
  {
    label: "Sort Order",
    description: "sort_order integer",
    fields: [
      { name: "sort_order", type: "int", default: 0 },
    ],
  },
];
