import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const entitiesTable = pgTable("_entities", {
  name: text("name").primaryKey(),
  tableName: text("table_name").notNull().unique(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const relationsTable = pgTable("_relations", {
  name: text("name").primaryKey(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
